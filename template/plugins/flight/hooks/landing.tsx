// 评审回收与落地（spec flight-findings-intake · design D5）：submit_findings 的处理、评审员 / 修复 agent 收口、
// 以及 drive 交来的 dispatch(reviewer|fixer) / final / land / halt。不注册 hook、不碰 $：副作用全经调用方造的 Ctx 闭包。
// 账本只经 io.appendEvent 写入；本模块不写 approve。
import { agentOf, currentAttempt, closeoutLists, ev, reduce, routingFindings, stopVerdict } from './core'
import type { Action, Ctx, Flight, FlightEvent, Found, GateJson, Io, RunResult, State } from './core'
import { appendEvent, ensureWorktree, judge, readLedger } from './io'
import { closeout, commitRecords, validateFindings } from './land'
import { fixerPrompt, reviewerPrompt } from './prompts'

const FIX = 'fix'
const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''
const errLine = (err: unknown) => firstLine(err instanceof Error ? err.message : String(err))
const GATE_TIMEOUT_MS = 600000
const DENY_OTHERS = '只有本次飞行派发的评审员可以提交 findings'
const REMIND =
  'flight：你还没有提交评审结论。请调用 submit_findings 提交 findings（severity / file / line / summary / fix）；没有问题也提交空列表，然后再结束。'
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    file: { type: 'string' },
    line: { type: 'integer' },
    summary: { type: 'string' },
    fix: { type: 'string' },
  },
  required: ['severity', 'file', 'line', 'summary', 'fix'],
}

export const FINDINGS_TOOL: { name: 'submit_findings'; description: string; inputSchema: Record<string, unknown> } = {
  name: 'submit_findings',
  description:
    '提交本次评审的 findings。只有 flight 本次飞行派发的评审员能用；没有问题也提交空列表。每项含 severity（CRITICAL/HIGH/MEDIUM/LOW）、file、line、summary、fix。',
  inputSchema: { type: 'object', properties: { findings: { type: 'array', items: FINDING_SCHEMA } }, required: ['findings'] },
}

// 已提醒过一次的评审员（进程内；重载后至多再提醒一次）
const reminded = new Set<string>()

async function base(ctx: Ctx, f: Flight) {
  return { change: f.change, at: new Date(await ctx.now()).toISOString(), session: f.session }
}

/** 门禁 JSON；stdout 不是 JSON 时按红记。 */
function parseGate(r: RunResult, slice: string): GateJson {
  try {
    const j = JSON.parse(r.stdout) as Partial<GateJson>
    if (typeof j.ok === 'boolean') return { ...j, slice: String(j.slice ?? slice), ok: j.ok, commit: String(j.commit ?? ''), failed: Array.isArray(j.failed) ? j.failed : [] }
  } catch {
    // 落到下方按红记
  }
  return { slice, ok: false, commit: '', failed: [`G? 门禁输出无法解析：${r.stderr.trim().split('\n')[0] ?? ''}`] }
}

async function runFinal(io: Io, f: Flight, cwd: string): Promise<GateJson> {
  return parseGate(await judge(io, f, 'slice-gate', ['final', '--change-dir', f.changeDir], cwd, GATE_TIMEOUT_MS), 'final')
}

/** 飞行记录（铁律 8）：首行标题 + timeline report + 路由对账。report 失败只写一行原因，不拖垮落地 / 停飞。 */
async function flightRecord(io: Io, f: Flight, state: State, title: string): Promise<string> {
  let body: string
  try {
    const r = await judge(io, f, 'timeline', ['report', '--change-dir', f.changeDir], f.changeTree)
    body = r.exitCode === 0 ? r.stdout.trimEnd() : `（timeline report 失败：${firstLine(r.stderr) || `exit ${r.exitCode}`}）`
  } catch (err) {
    body = `（timeline report 失败：${errLine(err)}）`
  }
  const routing = routingFindings(state)
  const tail = routing.length ? [`路由对账：${routing.length} 条不符`, ...routing.map(x => x.summary)] : ['路由对账：一致']
  return [title, body, ...tail].join('\n')
}

/** submit_findings 的处理：只认当前 attempt 里 role 为 reviewer 的调用者；校验通过就追加 review 事件 */
export async function onFindings(ctx: Ctx, found: Found | undefined, agentId: string | undefined, input: unknown): Promise<{ result: string } | { deny: string }> {
  const state = found && reduce(found.events)
  const a = state && agentId ? agentOf(state, agentId) : undefined
  if (!found || !state || !agentId || !a || a.role !== 'reviewer' || a.attempt !== currentAttempt(state)) return { deny: DENY_OTHERS }
  const v = validateFindings(input)
  if (!v.ok) return { deny: `校验失败：${v.error}` }
  const review = ev.review(await base(ctx, found.flight), { attempt: a.attempt, slice: a.slice, agent: agentId, findings: v.findings })
  if (!(await appendEvent(ctx.io, found.flight, review))) return { deny: 'flight：账本写入失败，findings 未记录，请重试' }
  return { result: `findings 已记录：${v.findings.length} 条` }
}

/** 评审员 / 修复 agent 收口；其他 role 返回 undefined（交给调用方放行） */
export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined> {
  const a = agentOf(reduce(found.events), agentId)
  if (!a) return undefined
  if (a.role === 'reviewer') {
    const reviewed = found.events.some(x => x.ev === 'review' && x.agent === agentId)
    if (reviewed || reminded.has(agentId)) return undefined
    reminded.add(agentId)
    return { block: REMIND }
  }
  if (a.role !== 'fixer') return undefined
  const gate = await runFinal(ctx.io, found.flight, a.worktree)
  const g = ev.gate(await base(ctx, found.flight), { attempt: a.attempt, agent: agentId, ...gate, slice: FIX })
  await appendEvent(ctx.io, found.flight, g)
  const v = stopVerdict(reduce([...found.events, g]), agentId, gate)
  return v.kind === 'block' ? { block: v.text } : undefined
}

/** drive 交来的 dispatch reviewer / fixer、final、land、halt；其他动作直接返回 */
export async function runLandingAction(ctx: Ctx, f: Flight, action: Action): Promise<void> {
  const io = ctx.io
  const ledger = await readLedger(io, f)
  // fail-closed：读不到账本就不以空状态派发 / final / 收口（空状态会让 closeout 用空列表覆盖评审结论）
  if ('error' in ledger) {
    await ctx.toast(`flight：${f.change} 账本读取失败，未执行 ${action.kind}：${ledger.error.trim().split('\n')[0] ?? ''}`)
    return
  }
  const state = reduce(ledger.events)
  const attempt = currentAttempt(state)
  const b = await base(ctx, f)
  const append = (x: FlightEvent) => appendEvent(io, f, x)

  if (action.kind === 'dispatch' && action.role === 'reviewer') {
    const prompt = reviewerPrompt({ change: f.change, changeDir: f.changeDir, slice: action.slice, commit: action.commit })
    const r = await ctx.spawn({ f, role: 'reviewer', cwd: f.changeTree, prompt, description: `评审 ${action.slice}` })
    if (r.agentId) await append(ev.dispatch(b, { attempt, slice: action.slice, role: 'reviewer', agent: r.agentId, model: f.model, worktree: f.changeTree }))
    else await append(ev.blocked(b, { attempt, slice: `review:${action.slice}`, kind: 'infra', reason: `评审员派发被拒：${r.deny ?? '未知原因'}` }))
    return
  }
  if (action.kind === 'dispatch' && action.role === 'fixer') {
    // 先提交飞行记录：修复 worktree 从分支尖端切出，未提交的记录会在合回时冲突
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) {
      await append(ev.blocked(b, { attempt, slice: FIX, kind: 'infra', reason: `提交飞行记录失败：${err}` }))
      return
    }
    const wt = await ensureWorktree(io, f, FIX)
    if ('error' in wt) {
      await append(ev.blocked(b, { attempt, slice: FIX, kind: 'infra', reason: `修复 worktree 创建失败：${wt.error}` }))
      return
    }
    const prompt = fixerPrompt({ change: f.change, changeDir: f.changeDir, findings: action.findings })
    const r = await ctx.spawn({ f, role: 'fixer', cwd: wt.path, prompt, description: '批量修复' })
    if (r.agentId) await append(ev.dispatch(b, { attempt, slice: FIX, role: 'fixer', agent: r.agentId, model: f.model, worktree: wt.path }))
    else await append(ev.blocked(b, { attempt, slice: FIX, kind: 'infra', reason: `修复 agent 派发被拒：${r.deny ?? '未知原因'}` }))
    return
  }
  if (action.kind === 'final') {
    // 先提交飞行记录，否则收口时 ship 会判「final 过期」
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) {
      await append(ev.final(b, { attempt, ok: false, commit: '', failed: [err] }))
      return
    }
    const g = await runFinal(io, f, f.changeTree)
    await append(ev.final(b, { attempt, ok: g.ok, commit: g.commit, failed: g.failed }))
    return
  }
  if (action.kind === 'land') {
    const merged = [...new Set(state.events.filter(x => x.ev === 'merge' && x.ok === true && x.slice !== FIX).map(x => String(x.slice)))]
    const { verdict } = await closeout(io, f, closeoutLists(state), merged)
    await append(ev.land(b, { attempt, verdict }))
    await ctx.status(undefined)
    await ctx.log(await flightRecord(io, f, state, `飞行记录 · ${f.change}`))
    // $.prompt.submit 不能提交斜杠命令（X10），故由调用方以 command.run 跑
    // 交接失败不停飞：已落地，不向上抛（否则 drive 会补记 halt），只提示人手动接
    try {
      await ctx.runCommand('pr-ship', f.change)
    } catch (err) {
      const why = errLine(err)
      await ctx.log(`落地完成，但接 /pr-ship 失败：${why}`)
      await ctx.toast(`flight：${f.change} 已落地，但接 /pr-ship 失败：${why}；请手动运行 /pr-ship`)
    }
    return
  }
  if (action.kind === 'halt') {
    await append(ev.halt(b, { attempt, reason: action.reason }))
    await ctx.status(undefined)
    await ctx.toast(`flight：${f.change} 停飞：${action.reason}`)
    await ctx.log(await flightRecord(io, f, state, `停飞 · ${f.change}：${action.reason}`))
  }
}
