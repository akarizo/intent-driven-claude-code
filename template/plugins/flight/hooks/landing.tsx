// 评审回收与落地（spec flight-findings-intake · design D5）：submit_findings 的处理、评审员 / 修复 agent 收口、
// 以及 drive 交来的 dispatch(reviewer|fixer) / final / land / halt。不注册 hook、不碰 $：副作用全经调用方造的 Ctx 闭包。
// 账本只经 io.appendEvent 写入；本模块不写 approve。
import { INTEG, PREMERGE, agentOf, currentAttempt, ev, reduce, routingFindings, stopVerdict } from './core'
import type { Action, Ctx, Finding, Flight, FlightEvent, Found, GateJson, Io, RunResult, State } from './core'
import { appendEvent, freshWorktree, judge, readLedger, stoppedNow } from './io'
import { closeout, commitRecords, premergeTarget, renderRecords, validateFindings } from './land'
import { fixerPrompt, followupReviewPrompt, integFixerPrompt, integReviewPrompt, reviewerPrompt, wholeReviewPrompt } from './prompts'

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

/** 终端通知（design D5）：ctx.notify 缺席或抛错都不影响飞行。 */
async function notify(ctx: Ctx, text: string): Promise<void> {
  try {
    await ctx.notify?.(text)
  } catch {
    // 吞掉：通知只是提醒，失败不改变落地 / 停飞
  }
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

/**
 * reuseFix：final 动作请求复用修复体收口门禁的结果（是否可复用由 slice-gate.py final --reuse-fix 判定，design D3）；修复体自己的收口不传。
 * integBase：整合修复体收口时另判 G9 整合护栏的起点（design D4）；其它修复体不传。
 */
async function runFinal(io: Io, f: Flight, cwd: string, opts?: { reuseFix?: boolean; integBase?: string }): Promise<GateJson> {
  const argv = ['final', '--change-dir', f.changeDir, ...(opts?.reuseFix ? ['--reuse-fix'] : []), ...(opts?.integBase ? ['--integ-base', opts.integBase] : [])]
  return parseGate(await judge(io, f, 'slice-gate', argv, cwd, GATE_TIMEOUT_MS), 'final')
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

/** 评审员动作；mode / base / prior 是 S2 在 core.ts 的 Action 上新增的字段（_interfaces.md），这里按约定读取。 */
type ReviewAction = { slice: string; commit: string; mode?: 'whole' | 'followup' | 'integ'; base?: string; prior?: Finding[] }
type ReviewPlan = { prompt: string; description: string; range?: { commit: string; base: string } }

/**
 * 全量评审的起点（design D3）：本 attempt 最新 ok 的 premerge 有非空 target 就用它；否则 git merge-base <commit> <主 worktree HEAD>。
 * 任一步失败、输出为空或等于 commit 时返回原因。
 */
async function wholeBase(io: Io, f: Flight, state: State, commit: string): Promise<{ base: string } | { error: string }> {
  const pm = state.events.filter(e => e.ev === 'premerge' && Number(e.attempt) === state.attempt).at(-1)
  if (pm && pm.ok === true && typeof pm.target === 'string' && pm.target !== '') {
    if (pm.target === commit) return { error: `分叉点就是 ${commit}，没有可审的改动` }
    return { base: pm.target }
  }
  const m = await io.run(['git', '-C', f.mainTree, 'rev-parse', 'HEAD'])
  const head = m.stdout.trim()
  if (m.exitCode !== 0 || head === '') return { error: `git rev-parse HEAD 失败：${firstLine(m.stderr) || `exit ${m.exitCode}`}` }
  const mb = await io.run(['git', '-C', f.changeTree, 'merge-base', commit, head])
  const base = mb.stdout.trim()
  if (mb.exitCode !== 0 || base === '') return { error: `git merge-base 失败：${firstLine(mb.stderr) || `exit ${mb.exitCode}`}` }
  if (base === commit) return { error: `分叉点就是 ${commit}，没有可审的改动` }
  return { base }
}

/** 按 mode 选提示词：whole 先算起点，followup / integ 用动作给的范围，不带 mode 为切片评审。 */
async function reviewPlan(io: Io, f: Flight, state: State, x: ReviewAction): Promise<ReviewPlan | { error: string }> {
  const prior = x.prior ?? []
  if (x.mode === 'integ') {
    const base = x.base ?? ''
    if (base === '' || base === x.commit) return { error: `专审范围缺 base：base 为「${base}」，commit 为 ${x.commit}` }
    const prompt = integReviewPrompt({ change: f.change, changeDir: f.changeDir, base, commit: x.commit })
    return { prompt, description: '专审整合修复', range: { commit: x.commit, base } }
  }
  if (x.mode === 'whole') {
    const wb = await wholeBase(io, f, state, x.commit)
    if ('error' in wb) return { error: `算不出全量评审的起点：${wb.error}` }
    const prompt = wholeReviewPrompt({ change: f.change, changeDir: f.changeDir, hooksDir: f.hooksDir, base: wb.base, commit: x.commit, prior })
    return { prompt, description: '全量评审', range: { commit: x.commit, base: wb.base } }
  }
  if (x.mode === 'followup') {
    const round = Number(/^whole-r(\d+)$/.exec(x.slice)?.[1] ?? 0)
    const base = x.base ?? ''
    if (base === '' || base === x.commit) return { error: `复核范围缺 base：base 为「${base}」，commit 为 ${x.commit}` }
    const prompt = followupReviewPrompt({ change: f.change, changeDir: f.changeDir, round, base, commit: x.commit, prior })
    return { prompt, description: `复核 第 ${round} 轮`, range: { commit: x.commit, base } }
  }
  return { prompt: reviewerPrompt({ change: f.change, changeDir: f.changeDir, slice: x.slice, commit: x.commit }), description: `评审 ${x.slice}` }
}

/** 评审员 / 修复 agent / 预合并解冲突 agent 收口；其他 role 返回 undefined（交给调用方放行） */
export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined> {
  const a = agentOf(reduce(found.events), agentId)
  if (!a) return undefined
  if (a.role === 'reviewer') {
    const reviewed = found.events.some(x => x.ev === 'review' && x.agent === agentId)
    if (reviewed || reminded.has(agentId)) return undefined
    reminded.add(agentId)
    return { block: REMIND }
  }
  // 预合并解冲突 agent 收口跑全量 final（design D4），不跑切片门禁；其余同修复 agent
  const pmResolver = a.role === 'resolver' && a.slice === PREMERGE
  if (a.role !== 'fixer' && !pmResolver) return undefined
  const gate = await runFinal(ctx.io, found.flight, a.worktree, a.slice === INTEG ? { integBase: a.base } : undefined)
  const g = ev.gate(await base(ctx, found.flight), { attempt: a.attempt, agent: agentId, ...gate, slice: a.slice || FIX })
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
    const x = action as ReviewAction
    // 派发前查停飞（design D8）：动作算出后人可能已停飞或已落地；此时不派发、不追加事件
    if ((await stoppedNow(io, f)) !== undefined) return
    const plan = await reviewPlan(io, f, state, x)
    if ('error' in plan) {
      await append(ev.blocked(b, { attempt, slice: `review:${x.slice}`, kind: 'infra', reason: plan.error }))
      return
    }
    const r = await ctx.spawn({ f, role: 'reviewer', cwd: f.changeTree, prompt: plan.prompt, description: plan.description })
    // 全量评审与复核的 dispatch 另记这一轮审到的 commit 与 base（_interfaces.md）；ev.dispatch 的类型由 S2 补 commit
    if (r.agentId) {
      const d = { attempt, slice: x.slice, role: 'reviewer' as const, agent: r.agentId, model: f.model, worktree: f.changeTree, ...plan.range }
      await append(ev.dispatch(b, d))
    } else await append(ev.blocked(b, { attempt, slice: `review:${x.slice}`, kind: 'infra', reason: `评审员派发被拒：${r.deny ?? '未知原因'}` }))
    return
  }
  if (action.kind === 'dispatch' && action.role === 'fixer') {
    const slice = (action as { slice?: string }).slice ?? FIX
    // 先提交飞行记录：修复 worktree 从分支尖端切出，未提交的记录会在合回时冲突
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) {
      await append(ev.blocked(b, { attempt, slice, kind: 'infra', reason: `提交飞行记录失败：${err}` }))
      return
    }
    // 每个 attempt 另起修复 worktree：flight-<change>-<slice> 已在则用 <slice>-a<attempt>，从不复用旧树
    const wt = await freshWorktree(io, f, slice, attempt)
    if ('error' in wt) {
      await append(ev.blocked(b, { attempt, slice, kind: 'infra', reason: `修复 worktree 创建失败：${wt.error}` }))
      return
    }
    // 整合修复体（design D4）：派发前 change worktree 的 HEAD 作 G9 整合护栏的起点，记进 dispatch
    let integBase: { base: string } | undefined
    if (slice === INTEG) {
      const h = await io.run(['git', '-C', f.changeTree, 'rev-parse', 'HEAD'])
      const head = h.stdout.trim()
      if (h.exitCode !== 0 || head === '') {
        await append(ev.blocked(b, { attempt, slice, kind: 'infra', reason: `取整合修复起点失败：git rev-parse HEAD：${firstLine(h.stderr) || `exit ${h.exitCode}`}` }))
        return
      }
      integBase = { base: head }
    }
    const prompt = integBase
      ? integFixerPrompt({ change: f.change, changeDir: f.changeDir, failed: action.failed ?? [], base: integBase.base })
      : fixerPrompt({ change: f.change, changeDir: f.changeDir, findings: action.findings })
    if ((await stoppedNow(io, f)) !== undefined) return
    const r = await ctx.spawn({ f, role: 'fixer', cwd: wt.path, prompt, description: `修复 ${slice}` })
    if (r.agentId) await append(ev.dispatch(b, { attempt, slice, role: 'fixer', agent: r.agentId, model: f.model, worktree: wt.path, branch: wt.branch, ...integBase }))
    else await append(ev.blocked(b, { attempt, slice, kind: 'infra', reason: `修复 agent 派发被拒：${r.deny ?? '未知原因'}` }))
    return
  }
  if (action.kind === 'premerge') {
    // 预合并会改 change 分支：先查停飞（design D8）；停飞由下一轮 next() 按事件给出，这里只记事件
    if ((await stoppedNow(io, f)) !== undefined) return
    await append(ev.premerge(b, { attempt, ...(await premergeTarget(io, f)) }))
    return
  }
  if (action.kind === 'final') {
    // 先提交飞行记录，否则收口时 ship 会判「final 过期」
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) {
      await append(ev.final(b, { attempt, ok: false, commit: '', failed: [err] }))
      return
    }
    const g = await runFinal(io, f, f.changeTree, { reuseFix: true })
    await append(ev.final(b, { attempt, ok: g.ok, commit: g.commit, failed: g.failed, ...(g.warnings ? { warnings: g.warnings } : {}) }))
    return
  }
  if (action.kind === 'land') {
    // 修复合回（fix 与 fix-r<k>）与预合并解冲突的合回不是 tasks.md 里的切片
    const isFix = (s: unknown) => s === FIX || s === PREMERGE || /^fix-r\d+$/.test(String(s))
    const merged = [...new Set(state.events.filter(x => x.ev === 'merge' && x.ok === true && !isFix(x.slice)).map(x => String(x.slice)))]
    // 落地顺序（design D3）：收口 → land 事件 → 从账本生成并提交记录 → 飞行记录 → 交接 pr-ship
    const { verdict, reasons } = await closeout(io, f, merged)
    await append(ev.land(b, { attempt, verdict }))
    // 记录只给人看、裁决以账本为准：生成失败不改裁决，照常交接
    const recErr = await renderRecords(io, f)
    if (recErr !== undefined) {
      await ctx.log(`落地记录生成失败：${recErr}`)
      await ctx.toast(`flight：${f.change} 落地记录生成失败：${recErr}`)
    }
    await ctx.status(undefined)
    const record = await flightRecord(io, f, state, `飞行记录 · ${f.change}`)
    await ctx.log(verdict === 'draft' && reasons ? `${record}\ndraft 原因：${reasons}` : record)
    // 交接给插件自带命令 /flight:pr-ship（design D4）；$.prompt.submit 不能提交斜杠命令（X10），故由调用方以 command.run 跑
    // 交接失败不停飞：已落地，不向上抛（否则 drive 会补记 halt），只提示人带同样参数手动接
    const args = `--worktree ${f.changeTree} --change-dir ${f.changeDir} --judges ${f.hooksDir}`
    try {
      await ctx.runCommand('flight:pr-ship', args)
    } catch (err) {
      const why = errLine(err)
      await ctx.log(`落地完成，但接 /flight:pr-ship 失败：${why}`)
      await ctx.toast(`flight：${f.change} 已落地，但接 /flight:pr-ship 失败：${why}；请手动运行 /flight:pr-ship ${args}`)
      await notify(ctx, `${f.change}：已落地，接 /flight:pr-ship 失败，请手动运行 /flight:pr-ship`)
    }
    return
  }
  if (action.kind === 'halt') {
    await append(ev.halt(b, { attempt, reason: action.reason, kind: action.haltKind }))
    await ctx.status(undefined)
    await ctx.toast(`flight：${f.change} 停飞：${action.reason}`)
    await ctx.log(await flightRecord(io, f, state, `停飞 · ${f.change}：${action.reason}`))
    // 人工中止不通知（人就在场）
    if (action.haltKind !== 'abort') await notify(ctx, `${f.change}：停飞（${action.haltKind}）：${firstLine(action.reason)}`)
  }
}
