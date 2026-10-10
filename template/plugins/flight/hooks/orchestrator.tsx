// 飞行编排（spec flight-orchestrator · design D3 / D4 / D6）：接管 /opsx-apply、收口现跑门禁、结束兜底、合回与解冲突、状态行、类型隐藏。
// 状态只来自账本：每轮 drive 重读账本，经 core.next 得出动作再执行。
import type { EngineInterface, On } from 'claude-code'
import { agentOf, ev, next as nextActions, reduce, stopVerdict } from './core'
import type { Action, Ctx, Flight, FlightEvent, GateJson, Io, State } from './core'
import { bashUpgradable, bashVerdict, inWorktree, mainSessionVerdict, normalizePath, readUpgradable, spawnVerdict, writeTarget, writeVerdict } from './envelope'
import type { Deny, Who } from './envelope'
import { active, agentType, appendEvent, ensureWorktree, flightOfAgent, flights, judge, judgesDir, markPending, ownership, owners, readLedger, trees } from './io'
import { RECORD_FILES, commitRecords, finishResolve, mergeFix, mergeSlice, prepareResolve } from './land'
import { FINDINGS_TOOL, onFindings, onLandingStop, runLandingAction } from './landing'
import { executorPrompt, resolverPrompt, worktreeNote } from './prompts'

type Engine = EngineInterface
type Ev = State['events'][number]

// 与批准带（register.tsx）同一下限；register.tsx 未导出该常量，这里同值另立
const VERSION_FLOOR = '2.1.295'
const HIDDEN = ['flight:executor', 'flight:reviewer', 'flight:fixer']
const PASS_THROUGH = ['--engine=workflow', '--gate=per-task']
const LIVE = ['pending', 'running', 'waiting']
const GATE_TIMEOUT_MS = 600000
/** 合回用 git merge-tree --write-tree，需要 git 2.38+ */
const GIT_FLOOR = [2, 38]
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
      // $.fs.read 对不存在的文件抛 ENOENT；Io.read 的契约是「不存在 → undefined」，其他错误照常抛出
      if (!(await $.fs.exists(path))) return undefined
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
      const r = await $.agent.spawn({ prompt: `${worktreeNote(cwd)}\n${prompt}`, description, subagentType: agentType(role), model: f.model, cwd })
      if ('deny' in r) return { deny: r.deny }
      // dispatch 写入账本之前先登记：这段时间里它的工具调用一律拒绝（design D6）
      markPending(r.agentId, f.change)
      return { agentId: r.agentId }
    },
    async status(text) {
      await $.ui.status(text)
    },
    async toast(text) {
      await $.ui.toast(text)
    },
    runCommand: (command, args) => $.command.run({ command, args }).then(() => undefined),
    log: async text => { try { await $.ui.log(text) } catch { /* 打印失败不影响飞行 */ } },
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

// ---------------------------------------------------------------- 能力包络接线（design D5–D9；策略全在 envelope.ts）

type Envelope = { owns: Record<string, string[]>; commands: string[] }
/** 按 change 缓存 slices.json 里的 owns 与门禁 / verify 命令；起飞时作废 */
const envelopes: Map<string, Envelope> = new Map()

async function envelopeOf(io: Io, f: Flight): Promise<Envelope> {
  const hit = envelopes.get(f.change)
  if (hit !== undefined) return hit
  // 读不出或解析失败照常抛出：tool.call 的 .catch 对飞行 agent 拒绝，tool.check 原样交回引擎判定
  type Plan = { gate?: Record<string, unknown>; slices?: { id: string; owns?: string[]; verify?: unknown }[] }
  const plan = JSON.parse((await io.read(`${absChangeDir(f)}/slices.json`)) ?? '') as Plan
  const slices = plan.slices ?? []
  const commands = [plan.gate?.test, plan.gate?.lint, plan.gate?.typecheck, ...slices.map(s => s.verify)]
  const env: Envelope = {
    owns: Object.fromEntries(slices.map(s => [s.id, s.owns ?? []])),
    commands: commands.filter((c): c is string => typeof c === 'string' && c.trim() !== ''),
  }
  envelopes.set(f.change, env)
  return env
}

type Flying = { who: Who; commands: string[]; mainTree: string }

/** agentId 属于在飞飞行时，给出它的包络（角色、worktree、owns）、可免询问的命令与主 worktree；已派发、dispatch 未写入的为登记中。 */
async function flyingWho(io: Io, agentId: string): Promise<Flying | { pending: true } | undefined> {
  // 没有在飞飞行就不必查归属：非飞行 subagent 的每次工具调用都会走到这里
  if (active.size === 0) return undefined
  const owner = await ownership(io, agentId)
  if (owner !== undefined && 'pending' in owner) return active.has(owner.change) ? { pending: true } : undefined
  const f = owner && active.has(owner.change) ? flights.get(owner.change) : undefined
  if (owner === undefined || f === undefined) return undefined
  const env = await envelopeOf(io, f)
  const owns = owner.role === 'executor' ? env.owns[owner.slice] ?? [] : owner.role === 'reviewer' ? [] : Object.values(env.owns).flat()
  return { who: { role: owner.role, worktree: owner.worktree, owns }, commands: env.commands, mainTree: f.mainTree }
}

const commandOf = (input: unknown) => {
  const c = typeof input === 'object' && input !== null ? (input as { command?: unknown }).command : undefined
  return typeof c === 'string' ? c : ''
}

function envelopeVerdict({ who, mainTree }: Flying, tool: string, input: unknown): Deny | undefined {
  if (tool === 'Bash') return bashVerdict(who.role, commandOf(input), who.worktree, mainTree)
  const target = writeTarget(tool, input)
  return target === undefined ? undefined : writeVerdict(who, normalizePath(target))
}

/** D7：可把引擎的 ask 改答 allow 的包络内操作。 */
function inEnvelope({ who, commands, mainTree }: Flying, tool: string, input: unknown): boolean {
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return readUpgradable(tool, input, who.worktree, mainTree)
  if (tool === 'Bash') return bashUpgradable(who.role, commandOf(input), commands, who.worktree, mainTree)
  const target = writeTarget(tool, input)
  if (target !== undefined) return writeVerdict(who, normalizePath(target)) === undefined
  return who.role === 'reviewer' && tool === `mcp__flight__${FINDINGS_TOOL.name}`
}

/** 跑切片门禁并解析 JSON；stdout 不是门禁 JSON 时按红记。 */
async function runGate(io: Io, f: Flight, slice: string, worktree: string, base?: string): Promise<GateJson> {
  const args = ['gate', slice, '--change-dir', f.changeDir, ...(base ? ['--base', base] : [])]
  const r = await judge(io, f, 'slice-gate', args, worktree, GATE_TIMEOUT_MS)
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

  if (a.kind === 'regate') {
    // 切片 worktree 已不在：无从补跑，按全新派发处理
    if (!(await io.exists(a.worktree))) return perform(ctx, f, state, { kind: 'dispatch', role: 'executor', slice: a.slice }, slices)
    const gate = await runGate(io, f, a.slice, a.worktree, a.base)
    return record(ev.gate(b, { attempt: A, agent: 'regate', ...gate }))
  }
  if (a.kind === 'dispatch' && a.role === 'executor') {
    // 先提交飞行记录：切片 worktree 从分支尖端切出，未提交的记录（如刚刷新的接口摘要）会在合回时冲突
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) return blocked(a.slice, `提交飞行记录失败：${err}`)
    const wt = await ensureWorktree(io, f, a.slice)
    if ('error' in wt) return blocked(a.slice, `建切片 worktree 失败：${firstLine(wt.error)}`)
    // 续接（worktree 已存在）不带 --expect-branch：change 分支可能已前移
    // 续飞带原 base：worktree 里已有上一 attempt 的提交，以当前 HEAD 为起点会把它们判出区间
    const args = ['start', a.slice, '--change-dir', f.changeDir, ...(wt.created ? ['--expect-branch', f.branch] : []), ...(a.base ? ['--base', a.base] : [])]
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
    // 本 attempt 已 land / halt：残留 agent 结束不再算指纹，避免重复停飞（PR #40 评审 MEDIUM）
    if (state.events.some(e => (e.ev === 'land' || e.ev === 'halt') && Number(e.attempt) === state.attempt)) return
    showStatus($, f, state)
    const slices = await slicesOf(io, f)
    const deps = Object.fromEntries(Object.entries(slices).map(([id, s]) => [id, s.deps]))
    const fpRun = await judge(io, f, 'plan_fp', ['--change-dir', absChangeDir(f)], f.changeTree)
    const fpNow = fpRun.stdout.trim()
    if (fpRun.exitCode !== 0 || !/^[0-9a-f]{64}$/.test(fpNow)) {
      // 算不出指纹 ≠ 计划已变：如实停飞，不交给 nextActions 去比对
      const why = firstLine(fpRun.stderr) || firstLine(fpRun.stdout) || '无输出'
      await runLandingAction(ctx, f, { kind: 'halt', reason: `计算计划指纹失败：${why}` })
      return
    }
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
  const git = await io.run(['git', '--version'])
  const gv = /(\d+)\.(\d+)/.exec(git.stdout)
  const [major, minor] = gv ? [Number(gv[1]), Number(gv[2])] : [-1, -1]
  if (git.exitCode !== 0 || major < GIT_FLOOR[0] || (major === GIT_FLOOR[0] && minor < GIT_FLOOR[1])) {
    return `flight：需要 git ≥ 2.38（合回用 merge-tree --write-tree），当前 ${firstLine(git.stdout || git.stderr)}，不起飞`
  }
  const st = await io.run(['git', '-C', tree.path, 'status', '--porcelain', '--untracked-files=all'])
  if (st.exitCode !== 0) return `flight：工作区不干净，不起飞：\n${st.stderr.trim()}`
  // porcelain 的 XY 列可能以空格开头，不能先 trim
  const dirty = st.stdout.split('\n').filter(l => l.length > 3).map(l => l.slice(3))
  if (dirty.length) {
    const records = new Set(RECORD_FILES.map(r => `${changeDir}/${r}`))
    if (!dirty.every(p => records.has(p))) return `flight：工作区不干净，不起飞：\n${st.stdout.trim()}`
    // 只剩上一次飞行遗留的记录（停飞 / 会话中断不提交它们）：先提交再起飞
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) return `flight：提交遗留飞行记录失败，不起飞：${err}`
  }
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
  // 已 land / halt 的飞行也查：停飞不会收回已派出的 agent，它们还在写切片 worktree
  if (state.takeoff !== undefined) {
    const mine = new Set(ledger.events.filter(e => e.ev === 'dispatch' && ofA(e)).map(e => String(e.agent)))
    const live = (await $.agent.list()).some(x => mine.has(x.id) && LIVE.includes(String(x.status)))
    if (live) return `flight：${name} 上一次飞行派出的 agent 仍在运行（attempt ${state.attempt}），等它们结束再起飞`
  }

  // 先算计划指纹再记任何东西：空 fp 写进 takeoff 事件会让整条账本判损坏（PR #39 评审 HIGH）
  const fpRun = await judge(io, flight, 'plan_fp', ['--change-dir', abs], tree.path)
  const fp = fpRun.stdout.trim()
  if (fpRun.exitCode !== 0 || !/^[0-9a-f]{64}$/.test(fp)) {
    return `flight：计算计划指纹失败，不起飞（${firstLine(fpRun.stderr) || firstLine(fpRun.stdout) || '无输出'}）`
  }

  flights.set(name, flight)
  envelopes.delete(name)
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

  // 能力包络（D5 / D6 / D8）：飞行 agent 按角色限写与限 git；主会话对在飞树只读
  on('tool.call', { tool: ['Write', 'Edit', 'NotebookEdit', 'Bash'] }, async ($, e, next) => {
    const tool = String(e.tool)
    const agentId = (e as unknown as { agentId?: string }).agentId
    if (!agentId) return mainSessionVerdict([...active.values()], tool, e) ?? next(e)
    const flying = await flyingWho(ctxOf($).io, agentId)
    if (flying === undefined) return next(e)
    if ('pending' in flying) return { deny: 'flight：派发登记中，稍后重试' }
    const deny = envelopeVerdict(flying, tool, e)
    if (deny) return deny
    // D1：飞行 agent 的 Bash 固定在自己的 worktree 里执行
    return tool === 'Bash' ? next({ ...e, command: inWorktree(commandOf(e), flying.who.worktree) }) : next(e)
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const agentId = (e as unknown as { agentId?: string }).agentId
    return agentId && owners.has(agentId) ? { deny: 'flight：包络判定出错' } : next(e)
  })

  // D7：只把飞行 agent 包络内的 ask 改答 allow；不推翻 deny、不收回 allow、不越过组织上限 ceiling=ask
  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    const x = e as unknown as { tool: string; input?: unknown; agentId?: string; ceiling?: string }
    if (!x.agentId || v.decision !== 'ask' || x.ceiling === 'ask') return v
    try {
      const flying = await flyingWho(ctxOf($).io, x.agentId)
      if (flying === undefined || 'pending' in flying || !inEnvelope(flying, x.tool, x.input)) return v
      return { decision: 'allow', reason: 'flight 包络内' }
    } catch {
      return v
    }
  }).catch(() => ({ decision: 'ask' }))

  // D9：flight:* 只能由本插件带显式 model 派发；飞行 agent 不得再派发子 agent
  on('agent.spawn', async ($, e, next) => {
    const x = e as unknown as { subagentType?: string; model?: string; parentAgentId?: string }
    const parentInFlight = x.parentAgentId ? (await flyingWho(ctxOf($).io, x.parentAgentId)) !== undefined : false
    const origin = (next as unknown as { origin?: { plugin?: string } }).origin?.plugin
    return spawnVerdict({ subagentType: x.subagentType ?? '', originPlugin: origin, model: x.model, parentInFlight }) ?? next(e)
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const type = (e as unknown as { subagentType?: string }).subagentType ?? ''
    return type.startsWith('flight:') ? { deny: 'flight：派发守卫出错，flight:* 一律拒绝' } : next(e)
  })

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
