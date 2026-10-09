// 飞行编排（spec flight-orchestrator · design D3 / D4 / D6）：接管 /opsx-apply、收口现跑门禁、结束兜底、合回与解冲突、状态行、类型隐藏。
// 状态只来自账本：每轮 drive 重读账本，经 core.next 得出动作再执行。
import type { EngineInterface, On } from 'claude-code'
import { agentOf, ev, next as nextActions, reduce, stopVerdict } from './core'
import type { Action, Ctx, Flight, FlightEvent, GateJson, Io, State } from './core'
import { agentType, appendEvent, ensureWorktree, flightOfAgent, flights, judge, judgesDir, readLedger, trees } from './io'
import { finishResolve, mergeFix, mergeSlice, prepareResolve } from './land'
import { FINDINGS_TOOL, onFindings, onLandingStop, runLandingAction } from './landing'
import { executorPrompt, resolverPrompt } from './prompts'

type Engine = EngineInterface
type Ev = State['events'][number]

// 与批准带（register.tsx）同一下限；register.tsx 未导出该常量，这里同值另立
const VERSION_FLOOR = '2.1.295'
const HIDDEN = ['flight:executor', 'flight:reviewer', 'flight:fixer']
const PASS_THROUGH = ['--engine=workflow', '--gate=per-task']
const LIVE = ['pending', 'running', 'waiting']
const GATE_TIMEOUT_MS = 600000
const MAX_ROUNDS = 50

function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0)
  const pb = b.split('.').map(s => parseInt(s, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''
const argsOf = (raw: string | undefined) => (raw ?? '').split(/\s+/).filter(Boolean)
const absChangeDir = (f: Flight) => `${f.changeTree}/${f.changeDir}`

// 引擎规则（实测 X12）：$ 只能传进本文件声明的函数，不能跨 import；其他模块只收这里由 $ 造的闭包（Io / Ctx）。
const IO_TIMEOUT_MS = 30000

function ioHere($: Engine): Io {
  return {
    async run(argv, opts = {}) {
      const { timeoutMs = IO_TIMEOUT_MS, ...rest } = opts
      const r = await $.process.run([...argv], { ...rest, timeoutMs })
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
    async read(path) {
      const text = await $.fs.read(path)
      return typeof text === 'string' ? text : undefined
    },
    async write(path, text) {
      await $.fs.write(path, text)
    },
    exists: path => $.fs.exists(path),
  }
}

function ctxOf($: Engine): Ctx {
  return {
    io: ioHere($),
    now: () => $.clock.now(),
    async spawn({ f, role, cwd, prompt, description }) {
      const r = await $.agent.spawn({ prompt, description, subagentType: agentType(role), model: f.model, cwd })
      return 'deny' in r ? { deny: r.deny } : { agentId: r.agentId }
    },
    async status(text) {
      await $.ui.status(text)
    },
    async toast(text) {
      await $.ui.toast(text)
    },
    runCommand: (command, args) => $.command.run({ command, args }).then(() => undefined),
  }
}

async function base(ctx: Ctx, f: Flight) {
  return { change: f.change, at: new Date(await ctx.now()).toISOString(), session: f.session }
}

type SliceInfo = { deps: string[]; owns: string[] }

async function slicesOf(io: Io, f: Flight): Promise<Record<string, SliceInfo>> {
  const text = await io.read(`${absChangeDir(f)}/slices.json`)
  const out: Record<string, SliceInfo> = {}
  try {
    for (const s of (JSON.parse(text ?? '{}') as { slices?: { id: string; deps?: string[]; owns?: string[] }[] }).slices ?? []) {
      out[s.id] = { deps: s.deps ?? [], owns: s.owns ?? [] }
    }
  } catch {
    // slices.json 读不出 → 无依赖、无 owns；起飞前 lint / preflight 已校验过它
  }
  return out
}

/** 跑切片门禁并解析 JSON；stdout 不是门禁 JSON 时按红记。 */
async function runGate(io: Io, f: Flight, slice: string, worktree: string): Promise<GateJson> {
  const r = await judge(io, f, 'slice-gate', ['gate', slice, '--change-dir', f.changeDir], worktree, GATE_TIMEOUT_MS)
  try {
    const g = JSON.parse(r.stdout) as Partial<GateJson>
    if (g !== null && typeof g === 'object' && typeof g.ok === 'boolean') {
      return { ...g, slice: g.slice ?? slice, ok: g.ok, commit: g.commit ?? '', failed: Array.isArray(g.failed) ? g.failed : [] }
    }
  } catch {
    // 落到下方按红记
  }
  return { slice, ok: false, commit: '', failed: [`G? 门禁输出无法解析：${firstLine(r.stderr)}`] }
}

/** gate 事件还原为门禁 JSON（去掉事件外壳）。 */
function gateJsonOf(e: Ev): GateJson {
  const { v, ev: kind, change, at, by, attempt, agent, seq, ...g } = e
  return g as unknown as GateJson
}

function lastOkGate(state: State, slice: string): GateJson | undefined {
  const gates = state.events.filter(e => e.ev === 'gate' && e.slice === slice && e.ok === true && Number(e.attempt) === state.attempt)
  const g = gates[gates.length - 1]
  return g && gateJsonOf(g)
}

function showStatus($: Engine, f: Flight, state: State): void {
  const A = state.attempt
  const waves = (state.takeoff?.waves as string[][] | undefined) ?? []
  const inA = (e: Ev) => Number(e.attempt) === A
  const blocked = state.events.filter(e => e.ev === 'blocked' && inA(e))
  const done = (s: string) => state.events.some(e => e.ev === 'merge' && e.slice === s && e.ok === true) || blocked.some(b => b.slice === s)
  const at = waves.findIndex(w => w.some(s => !done(s)))
  const ended = new Set(state.events.filter(e => e.ev === 'ended').map(e => String(e.agent)))
  const running = state.events.filter(e => e.ev === 'dispatch' && inA(e) && !ended.has(String(e.agent))).length
  $.ui.status(`✈ ${f.change} · W${at < 0 ? waves.length : at + 1}/${waves.length} · 运行 ${running} · 阻断 ${blocked.length}`)
}

/** 执行一个动作；账本写入失败返回 false（drive 随即停下，避免同一动作重复执行）。 */
async function perform(ctx: Ctx, f: Flight, state: State, a: Action, slices: Record<string, SliceInfo>): Promise<boolean> {
  const A = state.attempt
  const io = ctx.io
  const record = async (event: FlightEvent) => appendEvent(io, f, event)
  const b = await base(ctx, f)
  const blocked = (slice: string, reason: string) => record(ev.blocked(b, { attempt: A, slice, kind: 'infra', reason }))
  const merged = (slice: string, r: { ok: true; commit: string } | { ok: false; failed: string[] }) =>
    record(ev.merge(b, { attempt: A, slice, ok: r.ok, commit: r.ok ? r.commit : '', failed: r.ok ? [] : r.failed }))
  const owns = (slice: string) => slices[slice]?.owns ?? []

  if (a.kind === 'dispatch' && a.role === 'executor') {
    const wt = await ensureWorktree(io, f, a.slice)
    if ('error' in wt) return blocked(a.slice, `建切片 worktree 失败：${firstLine(wt.error)}`)
    // 续接（worktree 已存在）不带 --expect-branch：change 分支可能已前移
    const args = ['start', a.slice, '--change-dir', f.changeDir, ...(wt.created ? ['--expect-branch', f.branch] : [])]
    const st = await judge(io, f, 'slice-gate', args, wt.path)
    if (st.exitCode !== 0) return blocked(a.slice, `slice-gate start 失败：${st.stdout.trim() || firstLine(st.stderr)}`)
    const prompt = executorPrompt({ change: f.change, changeDir: f.changeDir, slice: a.slice, continuation: a.continuation })
    const r = await ctx.spawn({ f, role: 'executor', cwd: wt.path, prompt, description: `${f.change} ${a.slice}` })
    if (r.agentId === undefined) return blocked(a.slice, `派发执行体被拒：${r.deny ?? '没有 agentId'}`)
    return record(ev.dispatch(b, { attempt: A, slice: a.slice, role: 'executor', agent: r.agentId, model: f.model, worktree: wt.path }))
  }
  if (a.kind === 'dispatch' && a.role === 'resolver') {
    const p = await prepareResolve(io, f, a.slice)
    if ('error' in p) return blocked(a.slice, p.error)
    const st = await judge(io, f, 'slice-gate', ['start', a.slice, '--change-dir', f.changeDir], p.path)
    if (st.exitCode !== 0) return blocked(a.slice, `slice-gate start 失败：${st.stdout.trim() || firstLine(st.stderr)}`)
    const conflicts = p.conflicts.length ? p.conflicts : a.conflicts
    const prompt = resolverPrompt({ change: f.change, changeDir: f.changeDir, slice: a.slice, conflicts })
    const r = await ctx.spawn({ f, role: 'resolver', cwd: p.path, prompt, description: `${f.change} ${a.slice} 解冲突` })
    if (r.agentId === undefined) return blocked(a.slice, `派发解冲突 agent 被拒：${r.deny ?? '没有 agentId'}`)
    return record(ev.dispatch(b, { attempt: A, slice: a.slice, role: 'resolver', agent: r.agentId, model: f.model, worktree: p.path }))
  }
  if (a.kind === 'gate') {
    const who = agentOf(state, a.agent)
    const gate = await runGate(io, f, a.slice, who?.worktree ?? '')
    return record(ev.gate(b, { attempt: A, agent: a.agent, ...gate }))
  }
  if (a.kind === 'merge' && a.via !== 'fix') {
    const gate = lastOkGate(state, a.slice)
    if (gate === undefined) return blocked(a.slice, '合回前找不到本 attempt 的绿门禁')
    if (a.via === 'branch') {
      const r = await mergeSlice(io, f, a.slice, gate, owns(a.slice))
      return merged(a.slice, r)
    }
    return merged(a.slice, await finishResolve(io, f, a.slice, gate, owns(a.slice)))
  }
  if (a.kind === 'merge') {
    const blocking = state.events
      .filter(e => e.ev === 'review')
      .flatMap(e => (Array.isArray(e.findings) ? (e.findings as { severity: string }[]) : []))
      .filter(x => x.severity === 'CRITICAL' || x.severity === 'HIGH').length
    return merged('fix', await mergeFix(io, f, `blocking=${blocking}`))
  }
  if (a.kind === 'blocked') return record(ev.blocked(b, { attempt: A, slice: a.slice, kind: a.blockKind, reason: a.reason }))
  // dispatch reviewer / fixer、final、land、halt
  await runLandingAction(ctx, f, a)
  return true
}

async function driveNow($: Engine, f: Flight): Promise<void> {
  const ctx = ctxOf($)
  const io = ctx.io
  let seen = -1
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const ledger = await readLedger(io, f)
    if ('error' in ledger) {
      await runLandingAction(ctx, f, { kind: 'halt', reason: `账本读取失败：${firstLine(ledger.error)}` })
      return
    }
    // 防空转：上一轮的动作没让账本多出事件（如写入总失败）→ 停下，不重复执行同一批动作
    if (ledger.events.length === seen) return
    seen = ledger.events.length
    const state = reduce(ledger.events)
    if (state.takeoff === undefined) return
    showStatus($, f, state)
    const slices = await slicesOf(io, f)
    const deps = Object.fromEntries(Object.entries(slices).map(([id, s]) => [id, s.deps]))
    const fpNow = (await judge(io, f, 'plan_fp', ['--change-dir', absChangeDir(f)], f.changeTree)).stdout.trim()
    const actions = nextActions(state, { waves: state.takeoff.waves as string[][], deps }, fpNow)
    if (!actions.length) return
    for (const a of actions) {
      let progressed: boolean
      try {
        progressed = await perform(ctx, f, state, a, slices)
      } catch (err) {
        // 任一触发路径（起飞 / turn.complete / SubagentStop）的动作异常都先尽力停飞留痕，再抛给调用方
        const msg = firstLine(err instanceof Error ? err.message : String(err))
        await runLandingAction(ctx, f, { kind: 'halt', reason: `动作异常：${msg}` }).catch(() => undefined)
        throw err
      }
      if (!progressed) return
    }
  }
}

// drive 经模块内单一 Promise 队列串行，避免同一时刻两次合回
let queue: Promise<unknown> = Promise.resolve()
function drive($: Engine, f: Flight): Promise<void> {
  const run = queue.then(
    () => driveNow($, f),
    () => driveNow($, f),
  )
  queue = run.catch(() => undefined)
  return run
}

/** 起飞：版本 → 参数 → 定位 → 起飞检查 → 正在飞 → 写账本并 drive。返回回复文本。 */
async function takeoff($: Engine, args: string[]): Promise<string> {
  let version: string
  try {
    version = (await $.session.version()).version
  } catch {
    return 'flight：无法确认 Claude Code 版本，不起飞'
  }
  if (isOlder(version, VERSION_FLOOR)) return `flight：Claude Code ${version} 低于 ${VERSION_FLOOR}，不起飞`

  const ctx = ctxOf($)
  const io = ctx.io
  const cwd = await $.session.cwd()
  const all = await trees(io, cwd)
  const main = all[0]
  if (main === undefined) return `flight：在 ${cwd} 读不到 git worktree 列表，不起飞`
  let name = args.find(a => !a.startsWith('--'))
  if (name === undefined) {
    const here = all.filter(t => cwd === t.path || cwd.startsWith(`${t.path}/`)).sort((x, y) => y.path.length - x.path.length)[0]
    if (here?.branch.startsWith('worktree-')) name = here.branch.slice('worktree-'.length)
  }
  if (name === undefined) return 'flight：没有给出 change 名，会话所在 worktree 的分支也不是 worktree-<name>'
  const tree = all.find(t => t.branch === `worktree-${name}`)
  if (tree === undefined) return `flight：找不到分支为 worktree-${name} 的 worktree`
  let changeDir = ''
  for (const rel of [`template/openspec/changes/${name}`, `openspec/changes/${name}`]) {
    if (await io.exists(`${tree.path}/${rel}`)) {
      changeDir = rel
      break
    }
  }
  if (changeDir === '') return `flight：${tree.path} 下找不到 change 目录 ${name}`
  const hooksDir = await judgesDir(io, main.path)
  if (hooksDir === '') return `flight：主 worktree ${main.path} 下找不到判定器（slice-gate.py）`
  const session = await $.session.id()
  const f: Flight = { change: name, mainTree: main.path, changeTree: tree.path, changeDir, branch: tree.branch, hooksDir, model: '', session }
  const abs = absChangeDir(f)

  const gate = await judge(io, f, 'takeoff-gate', ['--change-dir', abs], tree.path)
  if (gate.exitCode !== 0) return `flight：起飞守卫未通过：${gate.stderr.trim()}\n审阅并批准计划：${abs}/spec.html`
  const st = await io.run(['git', '-C', tree.path, 'status', '--porcelain'])
  if (st.exitCode !== 0 || st.stdout.trim() !== '') return `flight：工作区不干净，不起飞：\n${st.stdout.trim() || st.stderr.trim()}`
  // slice-gate lint 的 argparse 要求 --change-dir
  const lint = await judge(io, f, 'slice-gate', ['lint', '--change-dir', changeDir], tree.path)
  if (lint.exitCode !== 0) return `flight：slice-gate lint 未通过：${lint.stderr.trim()}`
  const pre = await judge(io, f, 'slice-gate', ['preflight', '--change-dir', changeDir], tree.path)
  if (pre.exitCode !== 0) return `flight：slice-gate preflight 未通过：${pre.stderr.trim()}`
  let waves: string[][]
  try {
    waves = JSON.parse(pre.stdout) as string[][]
  } catch {
    return `flight：preflight 输出不是 waves JSON：${firstLine(pre.stdout)}`
  }
  let model = args.find(a => a.startsWith('--model='))?.slice('--model='.length) ?? ''
  if (model === '') {
    const m = await io.run(['python3', `${hooksDir}/session-model.py`], { env: { CLAUDE_CODE_SESSION_ID: session } })
    if (m.exitCode !== 0 || m.stdout.trim() === '') return `flight：判不出主模型，用 --model= 指定（${firstLine(m.stderr)}）`
    model = m.stdout.trim()
  }
  const flight: Flight = { ...f, model }

  const ledger = await readLedger(io, flight)
  if ('error' in ledger) return `flight：账本读取失败：${firstLine(ledger.error)}`
  const state = reduce(ledger.events)
  const ofA = (e: FlightEvent) => Number(e.attempt) === state.attempt
  if (state.takeoff !== undefined && !ledger.events.some(e => (e.ev === 'land' || e.ev === 'halt') && ofA(e))) {
    const mine = new Set(ledger.events.filter(e => e.ev === 'dispatch' && ofA(e)).map(e => String(e.agent)))
    const live = (await $.agent.list()).some(x => mine.has(x.id) && LIVE.includes(String(x.status)))
    if (live) return `flight：${name} 正在飞（attempt ${state.attempt}），不重复起飞`
  }

  flights.set(name, flight)
  const attempt = ledger.events.filter(e => e.ev === 'takeoff').length + 1
  if (attempt === 1) {
    const t = await judge(io, flight, 'timeline', ['record', 'approve', '--change-dir', changeDir, '--note', gate.stdout.trim()], tree.path)
    if (t.exitCode !== 0) return `flight：timeline record approve 失败：${firstLine(t.stderr)}`
    const timeline = `${abs}/timeline.md`
    const add = await io.run(['git', '-C', tree.path, 'add', '--', timeline])
    if (add.exitCode !== 0) return `flight：git add timeline.md 失败：${firstLine(add.stderr)}`
    const commit = await io.run(['git', '-C', tree.path, 'commit', '-m', 'chore(flight): approve', '--', timeline])
    if (commit.exitCode !== 0) return `flight：提交 approve 记录失败：${firstLine(commit.stderr || commit.stdout)}`
  }
  const fp = (await judge(io, flight, 'plan_fp', ['--change-dir', abs], tree.path)).stdout.trim()
  const b = await base(ctx, flight)
  if (!(await appendEvent(io, flight, ev.takeoff(b, { attempt, fp, branch: tree.branch, waves, model })))) return 'flight：写 takeoff 事件失败，不起飞'
  await drive($, flight)
  return `✈ 起飞 ${name}：${waves.flat().length} 片 / ${waves.length} 个 wave · 主模型 ${model} · attempt ${attempt}`
}

export function registerOrchestrator(on: On): void {
  on('agent.offer', ($, e, next) => (HIDDEN.includes(e.agent) ? { isOffered: false } : next(e)))

  // 起飞异常一律留在地面作答，不把命令交给模型；只有 PASS_THROUGH 参数才 next(e)
  on('command.run', { command: 'opsx-apply' }, async ($, e, next) => {
    const args = argsOf(e.args)
    if (args.some(a => PASS_THROUGH.includes(a))) return next(e)
    try {
      return { text: await takeoff($, args) }
    } catch (err) {
      return { text: `flight：起飞异常，不起飞（${firstLine(err instanceof Error ? err.message : String(err))}）` }
    }
  }).catch(($, e, next) => (argsOf(e.args).some(a => PASS_THROUGH.includes(a)) && !next.called ? next(e) : { text: 'flight：起飞异常，不起飞' }))

  // register.tsx 已有无 matcher 的 session.start；同事件第二个 hook 须带 matcher（3a S8 实测），用恒真的 cwd matcher
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    try {
      await $.tool.register({ ...FINDINGS_TOOL, isDeferred: false })
    } catch {
      // 注册不了时评审员收口被提醒一次后放行，结束时状态机记 review:<S> 阻断，不拖住飞行
    }
    return next(e)
  })

  on('tool.call', { tool: `mcp__flight__${FINDINGS_TOOL.name}` }, async ($, e) => {
    const ctx = ctxOf($)
    const agentId = (e as unknown as { agentId?: string }).agentId
    return onFindings(ctx, agentId ? await flightOfAgent(ctx.io, agentId) : undefined, agentId, e)
  }).catch(() => ({ deny: 'flight：评审回收失败' }))

  on('classic.SubagentStop', async ($, e, next) => {
    const ctx = ctxOf($)
    const io = ctx.io
    const found = await flightOfAgent(io, e.agent_id)
    if (found === undefined) return next(e)
    const who = agentOf(reduce(found.events), e.agent_id)
    if (who === undefined) return next(e)
    if (who.role !== 'executor' && who.role !== 'resolver') {
      const r = await onLandingStop(ctx, found, e.agent_id)
      return r?.block ? { ...(await next(e)), block: r.block } : next(e)
    }
    const f = found.flight
    const gate = await runGate(io, f, who.slice, who.worktree)
    const event = ev.gate(await base(ctx, f), { attempt: who.attempt, agent: e.agent_id, ...gate })
    await appendEvent(io, f, event)
    const verdict = stopVerdict(reduce([...found.events, event]), e.agent_id, gate)
    if (verdict.kind === 'block') return { ...(await next(e)), block: verdict.text }
    return next(e)
  })

  // register.tsx 已有无 matcher 的 turn.complete（主会话刷新批准带）；同事件第二个 hook 须带 matcher，这里只接子 agent 的结束
  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    if (!e.agentId) return next(e)
    const ctx = ctxOf($)
    const found = await flightOfAgent(ctx.io, e.agentId)
    if (found === undefined) return next(e)
    const r = await next(e)
    const f = found.flight
    const who = agentOf(reduce(found.events), e.agentId)
    const model = (e.usage as { model?: string } | undefined)?.model ?? null
    await appendEvent(ctx.io, f, ev.ended(await base(ctx, f), { attempt: who?.attempt ?? 0, agent: e.agentId, reason: String(e.reason), model }))
    await drive($, f)
    return r
  }).catch(($, e, next) => next(e))
}
