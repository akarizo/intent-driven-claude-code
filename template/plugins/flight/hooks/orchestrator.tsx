// 飞行编排（spec flight-orchestrator · design D3 / D4 / D6）：接管 /opsx-apply、收口现跑门禁、结束兜底、合回与解冲突、状态行、类型隐藏。
// 状态只来自账本：每轮 drive 重读账本，经 core.next 得出动作再执行。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { FlightArmed, FlightPanel } from '../types'
import { abortFlight } from './abort'
import { armOf, armedLine, beforeRetry, classifyRefusal, giveUpText, humanText, nextStep, refusedAgain } from './armed'
import type { Arm, ArmEvent, ArmStep } from './armed'
import { agentOf, ev, healVerdict, next as nextActions, reduce, stopVerdict, summarize, summaryLines } from './core'
import type { Action, Ctx, Flight, FlightEvent, GateJson, HaltKind, Io, Role, State } from './core'
import { bashUpgradable, bashVerdict, bashWritesVerdict, inWorktree, mainSessionVerdict, normalizePath, readUpgradable, spawnVerdict, writeTarget, writeVerdict } from './envelope'
import type { Deny, Who } from './envelope'
import { intentVerdict, toolTargets } from './intent'
import { EVENT_TYPES, active, agentType, appendEvent, flightOfAgent, freshWorktree, flights, judge, judgesDir, markPending, ownership, owners, readLedger, stoppedNow, terminals, trees } from './io'
import { classifyDirty, commitArtifacts, commitRecords, finishResolve, mergeFix, mergeSlice, prepareResolve } from './land'
import { FINDINGS_TOOL, onFindings, onLandingStop, runLandingAction } from './landing'
import { MEASURE_TOOL, measureSlice, onMeasure } from './measure'
import { executorPrompt, resolverPrompt, triagePrompt, worktreeNote } from './prompts'
import { SHIP_TOOL, shipPr } from './ship'
import { checkJudges, checkPluginCopy } from './versions'
import { StepTracker } from './watchdog'

type Engine = EngineInterface
type Ev = State['events'][number]

// 与批准带（register.tsx）同一下限；register.tsx 未导出该常量，这里同值另立
const VERSION_FLOOR = '2.1.295'
const DIAGNOSTICIAN = 'flight:diagnostician'
const HIDDEN = ['flight:executor', 'flight:reviewer', 'flight:fixer', DIAGNOSTICIAN]
/** 停飞后派诊断员（design D6）：人工中止与计划指纹已变不派 */
const NO_TRIAGE: readonly HaltKind[] = ['abort', 'fingerprint']
const TRIAGE_MAX = 4000
const PASS_THROUGH = ['--gate=per-task']
/** 旧 Workflow 引擎已删除（design D8）：带这个参数直接作答，不交给模型、不写事件、不派发 */
const RETIRED_ENGINE = '--engine=workflow'
const RETIRED_ENGINE_TEXT = 'flight：旧 Workflow 引擎已删除（DRAFT-flight-single-implementation），飞行只由 flight 插件执行；去掉 --engine=workflow 再发 /opsx-apply <change>'
const LIVE = ['pending', 'running', 'waiting']
/** 看门狗 tick 周期 */
const TICK_MS = 60000
const GATE_TIMEOUT_MS = 600000
/** 合回用 git merge-tree --write-tree，需要 git 2.38+ */
const GIT_FLOOR = [2, 38]
/** 主模型别名：模型 id 按子串（不区分大小写）归入其一，同 session-model.py 的 ALIASES */
const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable']
const MAX_ROUNDS = 50
/** 起飞时授权插件提交本 change 工件的词（design D1） */
const AUTHORIZE = '授权提交'
/** 起飞时接管另一个会话未落地 / 停飞的飞行（design D5）；不是 change 名、不透传 */
const TAKEOVER = '--takeover'
const MEASURE_RETRY = 'flight：暂时无法判定你的归属（账本读取失败），稍后重试测量'
const FLIGHT_USAGE = '用法：/flight status|panel|abort [<change>] · /flight resume <change> [--takeover]'
/** 写账本的入口（/opsx-apply、/flight abort、/flight resume）只认人或宿主程序发出的来源：终端、Remote Control、SDK */
const HOST_ORIGINS = ['composer', 'bridge', 'sdk']
// 不变量（design D6）：模型可调用的工具恰为三个（measure、submit_findings、ship）；ship 只认主会话（带 agentId 一律拒绝）；ship 只写 ship 事件。
const SHIP_MAIN_ONLY = 'flight：ship 只接受主会话调用'
/** --gate=per-task 且 /opsx-apply 由本插件登记（项目没有命令文件）时的回复：无从透传给模型，指给 legacy skill */
const PER_TASK_GUIDANCE =
  'flight：本项目没有 /opsx-apply 命令文件（/opsx-apply 由 flight 插件登记，只接管飞行），--gate=per-task 无从交给模型。' +
  '要走 legacy 逐 task 守门：让模型读 .claude/skills/legacy/openspec-subagent-apply-change/SKILL.md，按它逐 task 守门执行该 change'
/** 本进程最近一次 session.start 里 opsx-apply 是否由本插件登记成功（成功 = 项目没有同名命令文件） */
let opsxRegistered = false

/** 来源不在 HOST_ORIGINS 时的统一拒绝文案 */
function originRefusal(cmd: string, kind: string | undefined): string {
  return `flight：${cmd} 会写账本，只接受人或宿主程序发出（终端、Remote Control、SDK；本次来源：${kind ?? '未标明'}）`
}

function originOf(e: unknown): string | undefined {
  return (e as { origin?: { kind?: string } }).origin?.kind
}

// 飞行面板（Pane flight）的内容：showStatus 与 /flight panel 刷新，ui.render 绘制
const panel = atom({ plugin: 'flight', key: 'panel' } as const, { change: '', lines: [] } as FlightPanel)

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
  const log = async (text: string) => { try { await $.ui.log(text) } catch { /* 打印失败不影响飞行 */ } }
  return {
    io: ioHere($),
    now: () => $.clock.now(),
    async spawn({ f, role, cwd, prompt, description }) {
      // io.ts 的 agentType 不认 diagnostician（缺省落到 flight:fixer），这里单列
      const subagentType = role === 'diagnostician' ? DIAGNOSTICIAN : agentType(role)
      const r = await $.agent.spawn({ prompt: `${worktreeNote(cwd)}\n${prompt}`, description, subagentType, model: f.model, cwd })
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
    log,
    // 终端通知（design D5）：走用户的通知通道；未发出或抛错只记一行，不抛
    async notify(text) {
      try {
        const r = (await $.ui.notify(text, { title: 'flight' })) as { isSent?: boolean; reason?: string } | undefined
        if (r?.isSent === false) await log(`flight 通知未发出：${r.reason ?? '未知原因'}`)
      } catch (err) {
        await log(`flight 通知未发出：${firstLine(err instanceof Error ? err.message : String(err))}`)
      }
    },
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

/** 在诊断的 change：停飞后派诊断员前加入、诊断员结束（或派发失败）时移除。halt 已把 change 移出 active，诊断员的包络靠它生效（design D6） */
const diagnosing: Set<string> = new Set()

/** agentId 属于在飞飞行（或在诊断 change 的诊断员）时，给出它的包络（角色、worktree、owns）、可免询问的命令与主 worktree；已派发、dispatch 未写入的为登记中；在飞飞行的账本读不出时为判不出。 */
async function flyingWho(io: Io, agentId: string): Promise<Flying | { pending: true } | { unknown: true; error: string } | undefined> {
  // 没有在飞 / 在诊断的飞行就不必查归属：非飞行 subagent 的每次工具调用都会走到这里
  if (active.size === 0 && diagnosing.size === 0) return undefined
  const owner = await ownership(io, agentId)
  if (owner !== undefined && 'unknown' in owner) return active.has(owner.change) ? { unknown: true, error: firstLine(owner.error) } : undefined
  if (owner !== undefined && 'pending' in owner) return active.has(owner.change) || diagnosing.has(owner.change) ? { pending: true } : undefined
  const live = owner !== undefined && (active.has(owner.change) || (owner.role === 'diagnostician' && diagnosing.has(owner.change)))
  const f = live ? flights.get(owner.change) : undefined
  if (owner === undefined || f === undefined) return undefined
  const env = await envelopeOf(io, f)
  const readOnly = owner.role === 'reviewer' || owner.role === 'diagnostician'
  const owns = owner.role === 'executor' ? env.owns[owner.slice] ?? [] : readOnly ? [] : Object.values(env.owns).flat()
  const commands = owner.role === 'diagnostician' ? [...env.commands, ...triageCommands(f)] : env.commands
  return { who: { role: owner.role, worktree: owner.worktree, owns }, commands, mainTree: f.mainTree }
}

/** 诊断员提示词（prompts.ts 的 triagePrompt）里写给它的两条查看命令，原样同拼法 */
const triageCommands = (f: Flight) => [
  `python3 ${f.hooksDir}/ledger.py show --change-dir ${f.changeDir}`,
  `python3 ${f.hooksDir}/timeline.py report --change-dir ${f.changeDir}`,
]

const commandOf = (input: unknown) => {
  const c = typeof input === 'object' && input !== null ? (input as { command?: unknown }).command : undefined
  return typeof c === 'string' ? c : ''
}

function envelopeVerdict({ who, mainTree }: Flying, tool: string, input: unknown): Deny | undefined {
  if (tool === 'Bash') return bashVerdict(who.role, commandOf(input), who.worktree, mainTree) ?? bashWritesVerdict(who, commandOf(input))
  const target = writeTarget(tool, input)
  return target === undefined ? undefined : writeVerdict(who, normalizePath(target))
}

// ---------------------------------------------------------------- 意图门禁接线（design D6；判定在 intent.ts 与 intent-gate.py）

/** 按会话缓存意图门禁的判定器目录；求不出不缓存 */
const intentHooks: Map<string, string> = new Map()

/** git common dir 的父目录（主 worktree）下的判定器目录；求不出为空串 */
async function intentHooksDir(io: Io, session: string, cwd: string): Promise<string> {
  const hit = intentHooks.get(session)
  if (hit !== undefined) return hit
  const r = await io.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  const common = r.exitCode === 0 ? firstLine(r.stdout).replace(/\/+$/, '') : ''
  if (!common.startsWith('/')) return ''
  const dir = await judgesDir(io, common.slice(0, common.lastIndexOf('/')) || '/')
  if (dir !== '') intentHooks.set(session, dir)
  return dir
}

/** 主会话与非飞行 agent 的写入走意图门禁；没有写入目标或找不到判定器时放行 */
async function intentCheck($: Engine, tool: string, e: unknown): Promise<Deny | undefined> {
  const io = ioHere($)
  const cwd = await $.session.cwd()
  const targets = toolTargets(tool, e as Record<string, unknown>, cwd)
  if (targets.length === 0) return undefined
  const hooksDir = await intentHooksDir(io, await $.session.id(), cwd)
  return hooksDir === '' ? undefined : intentVerdict(io, hooksDir, cwd, targets)
}

/** D7：可把引擎的 ask 改答 allow 的包络内操作。 */
function inEnvelope({ who, commands, mainTree }: Flying, tool: string, input: unknown): boolean {
  // 诊断员与评审员同规则：只读操作升级，写入经 writeVerdict 判只读而不升级
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return readUpgradable(tool, input, who.worktree, mainTree)
  if (tool === 'Bash') return bashUpgradable(who.role, commandOf(input), commands, who.worktree, mainTree)
  const target = writeTarget(tool, input)
  if (target !== undefined) return writeVerdict(who, normalizePath(target)) === undefined
  if (who.role === 'executor' && tool === `mcp__flight__${MEASURE_TOOL.name}`) return true
  return who.role === 'reviewer' && tool === `mcp__flight__${FINDINGS_TOOL.name}`
}

type GateBases = { base?: string; measureBase?: string }

/** 本片最后一个某角色的 dispatch（不限 attempt，或限定 attempt）。 */
function lastDispatch(state: State, slice: string, role: Role, attempt?: number): Ev | undefined {
  return state.events.filter(e => e.ev === 'dispatch' && e.role === role && e.slice === slice && (attempt === undefined || Number(e.attempt) === attempt)).pop()
}

/** 一条 dispatch 事件自身的 worktree / 分支 / attempt：不按 agentId 回查（同一 id 以最后一条 dispatch 为准，可能不是这一条） */
const dispatchOf = (d: Ev | undefined) => (d === undefined ? undefined : agentOf(reduce([d]), String(d.agent)))

/** 本片要合回的分支：本 attempt 最后一次门禁绿的执行体的分支；绿门禁来自补跑（regate）时取本片最后一个执行体的分支。推不出时为 undefined（land 沿用旧拼法）。 */
function sliceBranch(state: State, slice: string): string | undefined {
  const g = state.events.filter(e => e.ev === 'gate' && e.slice === slice && e.ok === true && Number(e.attempt) === state.attempt).pop()
  const who = g ? agentOf(state, String(g.agent)) : undefined
  const exec = who?.role === 'executor' && who.slice === slice ? who : dispatchOf(lastDispatch(state, slice, 'executor'))
  return exec?.branch || undefined
}

/** 执行体 / 解冲突 agent 收口门禁的 base：取其 dispatch 的 base；解冲突另带本片最后一个执行体 dispatch 的 base 作测量 base。旧账本没有 base 时不带。 */
function gateBases(state: State, agent: string): GateBases {
  const who = agentOf(state, agent)
  if (who === undefined) return {}
  if (who.role !== 'resolver') return { base: who.base }
  const exec = lastDispatch(state, who.slice, 'executor')
  const measureBase = exec && typeof exec.base === 'string' && exec.base !== '' ? exec.base : undefined
  return { base: who.base, measureBase }
}

/** 跑切片门禁（一律带 --evidence ledger）并解析 JSON；stdout 不是门禁 JSON 时按红记。 */
async function runGate(io: Io, f: Flight, slice: string, worktree: string, bases: GateBases = {}): Promise<GateJson> {
  const { base, measureBase } = bases
  const args = ['gate', slice, '--change-dir', f.changeDir, '--evidence', 'ledger', ...(base ? ['--base', base] : []), ...(base && measureBase ? ['--measure-base', measureBase] : [])]
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
  refreshPanel($, f, state)
}

/** 按账本归约刷新飞行面板，不动状态行。 */
function refreshPanel($: Engine, f: Flight, state: State): void {
  void update($, panel, () => ({ change: f.change, lines: summaryLines(summarize(state)) }))
}

/** 停飞 / 落地之后按最新账本刷新面板；账本读不出时不动面板。 */
async function refreshFromLedger($: Engine, io: Io, f: Flight): Promise<void> {
  const after = await readLedger(io, f)
  if ('events' in after) refreshPanel($, f, reduce(after.events))
}

/** slice-gate base（基点校验，不写任何文件），从打印的 JSON 取 base；失败或取不到 base 返回原因。 */
async function sliceBase(io: Io, f: Flight, slice: string, extra: string[], cwd: string): Promise<{ base: string } | { error: string }> {
  const st = await judge(io, f, 'slice-gate', ['base', slice, '--change-dir', f.changeDir, ...extra], cwd)
  if (st.exitCode !== 0) return { error: `slice-gate base 失败：${st.stdout.trim() || firstLine(st.stderr)}` }
  try {
    const base = (JSON.parse(st.stdout) as { base?: unknown } | null)?.base
    if (typeof base === 'string' && base !== '') return { base }
  } catch {
    // 落到下方
  }
  return { error: `slice-gate base 没有打印 base：${firstLine(st.stdout) || '无输出'}` }
}

/** 起点测量：账本里没有本片、本 base、changed 为空的 measure 时先测一次（agent 记 dispatch）；失败返回原因。 */
async function startMeasure(ctx: Ctx, f: Flight, attempt: number, slice: string, worktree: string, base: string): Promise<string | undefined> {
  const ledger = await readLedger(ctx.io, f)
  if ('error' in ledger) return `账本读取失败：${firstLine(ledger.error)}`
  const taken = ledger.events.some(e => e.ev === 'measure' && e.slice === slice && e.base === base && Array.isArray(e.changed) && e.changed.length === 0)
  if (taken) return undefined
  const r = await measureSlice(ctx, f, { attempt, slice, agent: 'dispatch', worktree, base })
  return 'error' in r ? r.error : undefined
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
  // 动作算出后可能已停飞或已落地（design D8）：派发 / 合回前查账本，停了就不做、不追加事件，drive 随即停下
  const stopped = async () => (await stoppedNow(io, f)) !== undefined

  if (a.kind === 'regate') {
    // 切片 worktree 已不在：无从补跑，按全新派发处理
    if (!(await io.exists(a.worktree))) return perform(ctx, f, state, { kind: 'dispatch', role: 'executor', slice: a.slice }, slices)
    const gate = await runGate(io, f, a.slice, a.worktree, { base: a.base })
    return record(ev.gate(b, { attempt: A, agent: 'regate', ...gate }))
  }
  if (a.kind === 'dispatch' && a.role === 'executor') {
    // 先提交飞行记录：切片 worktree 从分支尖端切出，未提交的记录（如刚刷新的接口摘要）会在合回时冲突
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) return blocked(a.slice, `提交飞行记录失败：${err}`)
    // 续接复用上一个执行体的 worktree 与分支；新派发（或旧现场已不在）另起一棵，从不复用旧树（design D2–D4）
    const prev = dispatchOf(lastDispatch(state, a.slice, 'executor'))
    const kept = a.continuation !== undefined && prev !== undefined && (await io.exists(prev.worktree)) ? prev : undefined
    let wt: { path: string; branch: string }
    if (kept !== undefined) {
      wt = { path: kept.worktree, branch: kept.branch }
    } else {
      const fresh = await freshWorktree(io, f, a.slice, A)
      if ('error' in fresh) return blocked(a.slice, `建切片 worktree 失败：${firstLine(fresh.error)}`)
      wt = fresh
    }
    // 续接不带 --expect-branch：change 分支可能已前移
    // 续接带原 base：worktree 里已有上一 attempt 的提交，以当前 HEAD 为起点会把它们判出区间
    const st = await sliceBase(io, f, a.slice, kept ? (a.base ? ['--base', a.base] : []) : ['--expect-branch', f.branch], wt.path)
    if ('error' in st) return blocked(a.slice, st.error)
    const m = await startMeasure(ctx, f, A, a.slice, wt.path, st.base)
    if (m) return blocked(a.slice, `起点测量失败：${m}`)
    const previous = !kept && prev !== undefined && prev.branch !== '' && prev.worktree !== wt.path ? { branch: prev.branch, attempt: prev.attempt } : undefined
    const prompt = executorPrompt({ change: f.change, changeDir: f.changeDir, slice: a.slice, continuation: kept ? a.continuation : undefined, previous })
    if (await stopped()) return false
    const r = await ctx.spawn({ f, role: 'executor', cwd: wt.path, prompt, description: `${f.change} ${a.slice}` })
    if (r.agentId === undefined) return blocked(a.slice, `派发执行体被拒：${r.deny ?? '没有 agentId'}`)
    return record(ev.dispatch(b, { attempt: A, slice: a.slice, role: 'executor', agent: r.agentId, model: f.model, worktree: wt.path, base: st.base, branch: wt.branch }))
  }
  if (a.kind === 'dispatch' && a.role === 'resolver') {
    const p = await prepareResolve(io, f, a.slice, { branch: sliceBranch(state, a.slice), attempt: A })
    if ('error' in p) return blocked(a.slice, p.error)
    const st = await sliceBase(io, f, a.slice, [], p.path)
    if ('error' in st) return blocked(a.slice, st.error)
    const conflicts = p.conflicts.length ? p.conflicts : a.conflicts
    const prompt = resolverPrompt({ change: f.change, changeDir: f.changeDir, slice: a.slice, conflicts })
    if (await stopped()) return false
    const r = await ctx.spawn({ f, role: 'resolver', cwd: p.path, prompt, description: `${f.change} ${a.slice} 解冲突` })
    if (r.agentId === undefined) return blocked(a.slice, `派发解冲突 agent 被拒：${r.deny ?? '没有 agentId'}`)
    return record(ev.dispatch(b, { attempt: A, slice: a.slice, role: 'resolver', agent: r.agentId, model: f.model, worktree: p.path, base: st.base, branch: p.branch }))
  }
  if (a.kind === 'gate') {
    const who = agentOf(state, a.agent)
    const gate = await runGate(io, f, a.slice, who?.worktree ?? '', gateBases(state, a.agent))
    return record(ev.gate(b, { attempt: A, agent: a.agent, ...gate }))
  }
  // 三种合回（切片、解冲突、修复）之前查停飞
  if (a.kind === 'merge' && (await stopped())) return false
  if (a.kind === 'merge' && a.via !== 'fix') {
    const gate = lastOkGate(state, a.slice)
    if (gate === undefined) return blocked(a.slice, '合回前找不到本 attempt 的绿门禁')
    if (a.via === 'branch') {
      const r = await mergeSlice(io, f, a.slice, gate, owns(a.slice), sliceBranch(state, a.slice))
      return merged(a.slice, r)
    }
    const resolver = dispatchOf(lastDispatch(state, a.slice, 'resolver', A))
    const resolve = resolver && resolver.branch !== '' ? { path: resolver.worktree, branch: resolver.branch } : undefined
    return merged(a.slice, await finishResolve(io, f, a.slice, gate, owns(a.slice), resolve))
  }
  if (a.kind === 'merge') {
    const blocking = state.events
      .filter(e => e.ev === 'review')
      .flatMap(e => (Array.isArray(e.findings) ? (e.findings as { severity: string }[]) : []))
      .filter(x => x.severity === 'CRITICAL' || x.severity === 'HIGH').length
    // 切片级修复（fix）与修复轮（fix-r<k>）都按动作的 slice 合回：分支取该 slice 本 attempt 最后一个修复体的
    const fixer = dispatchOf(lastDispatch(state, a.slice, 'fixer', A))
    return merged(a.slice, await mergeFix(io, f, `blocking=${blocking}`, fixer?.branch || undefined, a.slice))
  }
  if (a.kind === 'blocked') return record(ev.blocked(b, { attempt: A, slice: a.slice, kind: a.blockKind, reason: a.reason }))
  // 自愈只记 heal：重派由下一轮 next 给出（合回重试为全新派发，另起 worktree）
  if (a.kind === 'heal') return record(ev.heal(b, { attempt: A, kind: a.heal, slice: a.slice, reason: a.reason, ...(a.agent ? { agent: a.agent } : {}) }))
  // dispatch reviewer / fixer、final、land、halt
  await runLandingAction(ctx, f, a)
  return true
}

/** 停飞之后在 change worktree 派诊断员（design D6）：本 attempt 已记 halt、尚未派过诊断员，且停飞不是人工中止 / 指纹已变。失败只记一行，不抛。 */
async function triage(ctx: Ctx, f: Flight, haltKind: HaltKind, reason: string): Promise<void> {
  if (NO_TRIAGE.includes(haltKind)) return
  try {
    const ledger = await readLedger(ctx.io, f)
    if ('error' in ledger) return
    const state = reduce(ledger.events)
    const ofA = (e: Ev) => Number(e.attempt) === state.attempt
    if (!state.events.some(e => e.ev === 'halt' && ofA(e))) return
    if (state.events.some(e => e.ev === 'dispatch' && e.role === 'diagnostician' && ofA(e))) return
    const prompt = triagePrompt({ change: f.change, changeDir: f.changeDir, hooksDir: f.hooksDir, reason, kind: haltKind })
    // 派发前加入：登记中的诊断员同样受包络约束
    diagnosing.add(f.change)
    const r = await ctx.spawn({ f, role: 'diagnostician', cwd: f.changeTree, prompt, description: `${f.change} 停飞诊断` })
    if (r.agentId === undefined) {
      diagnosing.delete(f.change)
      await ctx.log(`flight：派诊断员被拒：${r.deny ?? '没有 agentId'}`)
      return
    }
    const b = await base(ctx, f)
    await appendEvent(ctx.io, f, ev.dispatch(b, { attempt: state.attempt, slice: 'triage', role: 'diagnostician', agent: r.agentId, model: f.model, worktree: f.changeTree }))
  } catch (err) {
    diagnosing.delete(f.change)
    await ctx.log(`flight：派诊断员失败：${firstLine(err instanceof Error ? err.message : String(err))}`)
  }
}

async function driveNow($: Engine, f: Flight): Promise<void> {
  const ctx = ctxOf($)
  const io = ctx.io
  const session = await $.session.id()
  // 控制面自身的停飞（账本读不出、指纹算不出、动作异常）：做完后按最新账本刷新面板（design D8），再派诊断员
  const terminal = async (reason: string) => {
    await runLandingAction(ctx, f, { kind: 'halt', reason, haltKind: 'control' })
    await refreshFromLedger($, io, f)
    await triage(ctx, f, 'control', reason)
  }
  let seen = -1
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 读账本之前记下本进程的 land / halt 次数：之后变了，说明这批动作执行期间已停飞（如 /flight abort）
    const halts = terminals.get(f.change) ?? 0
    const ledger = await readLedger(io, f)
    if ('error' in ledger) {
      await terminal(`账本读取失败：${firstLine(ledger.error)}`)
      return
    }
    // 防空转：上一轮的动作没让账本多出事件（如写入总失败）→ 停下，不重复执行同一批动作
    if (ledger.events.length === seen) return
    seen = ledger.events.length
    const state = reduce(ledger.events)
    if (state.takeoff === undefined) return
    // 最新 takeoff 不是本会话起飞的（被 --takeover 接管）：残留 agent 结束不再驱动，免得替接管的会话派发、合回或停飞（PR #47 评审 HIGH）。
    // 不能比 f.session：扫描账本拼出的 Flight 取的就是最新 takeoff 的会话
    if (String(state.takeoff.by?.session ?? '') !== session) return
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
      await terminal(`计算计划指纹失败：${why}`)
      return
    }
    const actions = nextActions(state, { waves: state.takeoff.waves as string[][], deps }, fpNow)
    if (!actions.length) return
    for (const a of actions) {
      // 中途停飞：手上的动作已做完，不再开始新动作（PR #50 评审 HIGH）
      if ((terminals.get(f.change) ?? 0) !== halts) return
      let progressed: boolean
      try {
        progressed = await perform(ctx, f, state, a, slices)
      } catch (err) {
        // 任一触发路径（起飞 / turn.complete / SubagentStop）的动作异常都先尽力停飞留痕，再抛给调用方
        const msg = firstLine(err instanceof Error ? err.message : String(err))
        await terminal(`动作异常：${msg}`).catch(() => undefined)
        throw err
      }
      // 停飞 / 落地真写进账本（本进程 land / halt 计数变了）才刷新面板；写入失败时账本没变，不多读一次
      if ((a.kind === 'halt' || a.kind === 'land') && (terminals.get(f.change) ?? 0) !== halts) {
        await refreshFromLedger($, io, f)
        if (a.kind === 'halt') await triage(ctx, f, a.haltKind, a.reason)
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

/** slices.json 的 scenario_tests 映射到的测试文件（`::` 之前，去重）；读不出 / 不是 JSON 时为空，之后的 lint / preflight 会报 */
async function scenarioFiles(io: Io, path: string): Promise<string[]> {
  try {
    const tests = (JSON.parse((await io.read(path)) ?? '') as { scenario_tests?: Record<string, unknown> }).scenario_tests ?? {}
    return [...new Set(Object.values(tests).map(t => String(t).split('::')[0] ?? ''))].filter(Boolean)
  } catch {
    return []
  }
}

type Tree = Awaited<ReturnType<typeof trees>>[number]

/** 解析 change 名（省略时取会话所在 worktree 的分支 worktree-<name>）→ 找 worktree → 找 change 目录 → 找判定器目录 → 构造 Flight（model 为空）。 */
async function locate($: Engine, given: string | undefined): Promise<{ f: Flight; tree: Tree; main: Tree } | { error: string }> {
  const io = ioHere($)
  const cwd = await $.session.cwd()
  const all = await trees(io, cwd)
  const main = all[0]
  if (main === undefined) return { error: `flight：在 ${cwd} 读不到 git worktree 列表，不起飞` }
  let name = given
  if (name === undefined) {
    const here = all.filter(t => cwd === t.path || cwd.startsWith(`${t.path}/`)).sort((x, y) => y.path.length - x.path.length)[0]
    if (here?.branch.startsWith('worktree-')) name = here.branch.slice('worktree-'.length)
  }
  if (name === undefined) return { error: 'flight：没有给出 change 名，会话所在 worktree 的分支也不是 worktree-<name>' }
  const tree = all.find(t => t.branch === `worktree-${name}`)
  if (tree === undefined) return { error: `flight：找不到分支为 worktree-${name} 的 worktree` }
  let changeDir = ''
  for (const rel of [`template/openspec/changes/${name}`, `openspec/changes/${name}`]) {
    if (await io.exists(`${tree.path}/${rel}`)) {
      changeDir = rel
      break
    }
  }
  if (changeDir === '') return { error: `flight：${tree.path} 下找不到 change 目录 ${name}` }
  const hooksDir = await judgesDir(io, main.path)
  if (hooksDir === '') return { error: `flight：主 worktree ${main.path} 下找不到判定器（slice-gate.py）` }
  const session = await $.session.id()
  return { f: { change: name, mainTree: main.path, changeTree: tree.path, changeDir, branch: tree.branch, hooksDir, model: '', session }, tree, main }
}

/** 起飞参数里的 change 名与授权词：「授权提交」单独一个词，或粘在 change 名后面（design D1）；它本身不当 change 名 */
function givenOf(args: string[]): { given: string | undefined; authorized: boolean } {
  let authorized = args.includes(AUTHORIZE)
  let given = args.find(a => !a.startsWith('--') && a !== AUTHORIZE)
  if (given !== undefined && given.endsWith(AUTHORIZE)) {
    given = given.slice(0, -AUTHORIZE.length)
    authorized = true
  }
  return { given, authorized }
}

/** 起飞：版本 → 参数 → 定位 → 起飞检查 → 正在飞 → 写账本并 drive。返回回复文本。resume = /flight resume：只续飞已起飞、未落地的 change。 */
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean } = {}): Promise<string> {
  let version: string
  try {
    version = (await $.session.version()).version
  } catch {
    return 'flight：无法确认 Claude Code 版本，不起飞'
  }
  if (isOlder(version, VERSION_FLOOR)) return `flight：Claude Code ${version} 低于 ${VERSION_FLOOR}，不起飞`

  const ctx = ctxOf($)
  const io = ctx.io
  const { given, authorized } = givenOf(args)
  const at = await locate($, given)
  if ('error' in at) return at.error
  const { f, tree, main } = at
  const { change: name, changeDir, hooksDir, session } = f
  const abs = absChangeDir(f)

  const gate = await judge(io, f, 'takeoff-gate', ['--change-dir', abs], tree.path)
  if (gate.exitCode !== 0) return `flight：起飞守卫未通过：${gate.stderr.trim()}\n审阅并批准计划：${abs}/spec.html`
  const git = await io.run(['git', '--version'])
  const gv = /(\d+)\.(\d+)/.exec(git.stdout)
  const [major, minor] = gv ? [Number(gv[1]), Number(gv[2])] : [-1, -1]
  if (git.exitCode !== 0 || major < GIT_FLOOR[0] || (major === GIT_FLOOR[0] && minor < GIT_FLOOR[1])) {
    return `flight：需要 git ≥ 2.38（合回用 merge-tree --write-tree），当前 ${firstLine(git.stdout || git.stderr)}，不起飞`
  }
  // 版本核对在写任何账本事件或 timeline 之前：插件副本是否为已安装版本、判定器是否认识全部事件
  const home = await $.env.get('HOME')
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : '')
  const copy = await checkPluginCopy(io, { pluginRoot: $.plugin.root, configDir, mainTree: main.path })
  if (!copy.ok) return copy.reason
  const judges = await checkJudges(io, { hooksDir, required: EVENT_TYPES })
  if (!judges.ok) return judges.reason
  // 跨会话起飞（design D5）：读到账本之后、写任何事件或记录之前判断
  const ledger = await readLedger(io, f)
  if ('error' in ledger) return `flight：账本读取失败：${firstLine(ledger.error)}`
  const state = reduce(ledger.events)
  const ofA = (e: FlightEvent) => Number(e.attempt) === state.attempt
  if (opts.resume && state.takeoff === undefined) return `flight：${name} 从未起飞：用 /opsx-apply ${name}`
  if (opts.resume && state.events.some(e => e.ev === 'land' && ofA(e))) return `flight：${name} 已落地（attempt ${state.attempt}），没有可续飞的`
  const settled = state.events.some(e => (e.ev === 'land' || e.ev === 'halt') && ofA(e))
  const owner = String(state.takeoff?.by?.session ?? '')
  const foreign = state.takeoff !== undefined && !settled && owner !== session ? owner : undefined
  if (foreign !== undefined && !args.includes(TAKEOVER)) {
    return `flight：${name} 的 attempt ${state.attempt} 由另一个会话（${foreign.slice(0, 8)}）起飞，尚未落地或停飞；到那个会话里继续，或确认它已结束后用 /opsx-apply ${name} ${TAKEOVER} 接管`
  }
  // 本会话本进程正在驱动这次飞行（账本未结束且 active 已登记）：不在未结束的 attempt 上再写 takeoff（也不让它被归为可等待的拒绝而进入待命）。
  // 本进程未登记的（进程重启后 --resume 回到原会话）照旧走后面的活 agent 检查与续飞
  if (state.takeoff !== undefined && !settled && owner === session && active.has(name)) {
    return `flight：${name} 正在飞（attempt ${state.attempt}），不起飞；需要中止用 /flight abort ${name}`
  }
  const st = await io.run(['git', '-C', tree.path, 'status', '--porcelain', '--untracked-files=all'])
  if (st.exitCode !== 0) return `flight：工作区不干净，不起飞：\n${st.stderr.trim()}`
  // porcelain 的 XY 列可能以空格开头，不能先 trim
  const dirty = classifyDirty(
    st.stdout.split('\n').filter(l => l.length > 3).map(l => l.slice(3)),
    { changeDir, scenarioFiles: await scenarioFiles(io, `${abs}/slices.json`) },
  )
  if (dirty.others.length) return `flight：工作区不干净，不起飞（工件之外的未提交改动）：\n${dirty.others.join('\n')}`
  if (dirty.artifacts.length && !authorized) {
    return `flight：工作区不干净，不起飞：未提交的只有本 change 的工件（${dirty.artifacts.length} 个）。确认无误后发 \`/opsx-apply ${name} ${AUTHORIZE}\`，插件只提交这些文件后起飞`
  }
  if (dirty.records.length) {
    // 上一次飞行遗留的记录（停飞 / 会话中断不提交它们）：先提交再起飞
    const err = await commitRecords(io, f, 'chore(flight): 记录')
    if (err) return `flight：提交遗留飞行记录失败，不起飞：${err}`
  }
  if (dirty.artifacts.length) {
    const err = await commitArtifacts(io, f, dirty.artifacts)
    if (err) return `flight：提交工件失败，不起飞：${err}`
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
    // 主模型取自引擎（design D10），别名规则同 session-model.py 的 ALIASES
    let raw: string
    try {
      raw = String((await $.session.model()) ?? '')
    } catch (err) {
      raw = firstLine(err instanceof Error ? err.message : String(err))
    }
    model = MODEL_ALIASES.find(a => raw.toLowerCase().includes(a)) ?? ''
    if (model === '') return `flight：判不出主模型（${raw || '空'}），用 --model= 指定`
  }
  const flight: Flight = { ...f, model }

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
  const b = await base(ctx, flight)
  const event = { ...ev.takeoff(b, { attempt, fp, branch: tree.branch, waves, model }), ...(foreign !== undefined ? { takeover: foreign } : {}) }
  if (!(await appendEvent(io, flight, event))) return 'flight：写 takeoff 事件失败，不起飞'
  await drive($, flight)
  // 面板打不开不影响起飞
  void $.ui.open({ id: 'flight', title: `✈ ${name}` }).catch(() => undefined)
  const committed = dirty.artifacts.length ? `\n已提交工件 ${dirty.artifacts.length} 个文件` : ''
  const merged = waves.flat().filter(s => state.events.some(e => e.ev === 'merge' && e.slice === s && e.ok === true)).length
  const resumed = opts.resume ? `续飞 attempt ${attempt}：已合回 ${merged} 片跳过\n` : ''
  return `${resumed}✈ 起飞 ${name}：${waves.flat().length} 片 / ${waves.length} 个 wave · 主模型 ${model} · ${copy.line} · attempt ${attempt}${committed}`
}

/** 起飞入口闭包：由本文件带 matcher 的 session.start hook 用该会话的 $ 造好（$ 不出文件） */
let entry: ((args: string[], opts?: { resume?: boolean }) => Promise<string>) | undefined

/** 批准带等其他文件起飞用：不收 $；插件尚未经历 session.start 时如实回复。 */
export function takeoffNow(args: string[], opts?: { resume?: boolean }): Promise<string> {
  return entry === undefined ? Promise.resolve('flight：插件尚未就绪，稍后再按') : entry(args, opts)
}

// ---------------------------------------------------------------- 起飞待命（design D2–D6；判定全在 armed.ts，这里只接线）

/** 待命放会话状态，不进账本（用户定 Q4） */
const armedAtom = atom({ plugin: 'flight', key: 'armed' } as const, { items: {} } as FlightArmed)
/** 正在执行一步的待命：同一 change 的事件（tick / 计时 / agent 结束 / 主会话一轮）在其间到达时跳过 */
const armBusy: Set<string> = new Set()

const isAirborne = (text: string) => text.startsWith('✈ 起飞') || text.startsWith('续飞 attempt')
/** 原因首行：去掉开头「flight：」之后的第一行 */
const reasonHead = (text: string) => firstLine(text.startsWith('flight：') ? text.slice('flight：'.length) : text)
const errText = (err: unknown) => firstLine(err instanceof Error ? err.message : String(err))

async function armOfChange($: Engine, change: string): Promise<Arm | undefined> {
  return (await read($, armedAtom)).items[change] as Arm | undefined
}

async function putArm($: Engine, arm: Arm): Promise<void> {
  await update($, armedAtom, s => ({ items: { ...s.items, [arm.change]: arm } }))
}

async function dropArm($: Engine, change: string): Promise<void> {
  await update($, armedAtom, s => ({ items: Object.fromEntries(Object.entries(s.items).filter(([k]) => k !== change)) }))
}

/** 起飞且不抛：异常按「起飞异常」的拒绝文本交回（分类为 transient） */
async function takeoffSafe($: Engine, args: string[], opts: { resume?: boolean }): Promise<string> {
  try {
    return await takeoff($, args, opts)
  } catch (err) {
    return `flight：起飞异常，不起飞（${errText(err)}）`
  }
}

/** transient 类被拒留证据：change 账本可读才追加 diag where takeoff；attempt 取账本当前 attempt（没有起飞过为 0）。失败吞掉。 */
async function takeoffDiag($: Engine, change: string, text: string): Promise<void> {
  try {
    const at = await locate($, change)
    if ('error' in at) return
    const ctx = ctxOf($)
    const ledger = await readLedger(ctx.io, at.f)
    if ('error' in ledger) return
    // 账本的 attempt 须为正整数（io.ts / ledger.py 的 ATTEMPT），没有起飞过时记 1
    const attempt = Math.max(1, reduce(ledger.events).attempt)
    await appendEvent(ctx.io, at.f, ev.diag(await base(ctx, at.f), { attempt, where: 'takeoff', error: reasonHead(text) }))
  } catch {
    // 留证据失败不影响待命
  }
}

/** 被拒后记下待命（新待命覆盖旧的）并刷新状态行；transient 留证据。 */
async function noteRefusal($: Engine, arm: Arm, text: string): Promise<void> {
  await putArm($, arm)
  if (arm.cls === 'transient') await takeoffDiag($, arm.change, text)
  await $.ui.status(armedLine(arm, await $.clock.now()))
}

/** /opsx-apply、/flight resume、批准带按键共用的起飞：被拒且不是 human / human-key 类时进入待命（design D2）。
 *  与待命自动重试经 armBusy 互斥：该 change 正在自动重试时不起飞；人工起飞期间 advanceArm 跳过。 */
async function takeoffArmed($: Engine, args: string[], opts: { resume?: boolean } = {}): Promise<string> {
  let change = givenOf(args).given
  if (change === undefined) {
    const at = await locate($, undefined)
    change = 'error' in at ? undefined : at.f.change
  }
  if (change === undefined) return takeoffArmedLocked($, args, opts, undefined)
  if (armBusy.has(change)) return `flight：${change} 正在自动重试起飞，稍候`
  armBusy.add(change)
  try {
    return await takeoffArmedLocked($, args, opts, change)
  } finally {
    armBusy.delete(change)
  }
}

async function takeoffArmedLocked($: Engine, args: string[], opts: { resume?: boolean }, change: string | undefined): Promise<string> {
  const text = await takeoffSafe($, args, opts)
  if (isAirborne(text)) {
    if (change !== undefined) await dropArm($, change)
    return text
  }
  const ctx = ctxOf($)
  const cls = classifyRefusal(text)
  if (change === undefined || cls === 'human' || cls === 'human-key') {
    await ctx.notify?.(humanText(change ?? '（未知 change）', text, cls === 'human-key' ? 'human-key' : 'human'))
    return text
  }
  const now = await $.clock.now()
  const arm = armOf({ change, args, resume: opts.resume === true, text, now })
  await noteRefusal($, arm, text)
  await ensureTicker($).catch(() => undefined)
  await ctx.notify?.(`flight：${change} 已进入起飞待命：${reasonHead(text)}`)
  await runStep($, change, nextStep(arm, { kind: 'refused' }, now))
  return `${text}\n已进入起飞待命：${reasonHead(text)}`
}

/** 执行一步；$ 来自触发它的 hook。prompt.submit 只在 clock.after(0) 的回调里调用（command.run 里调用会被引擎拒绝）。 */
async function runStep($: Engine, change: string, step: ArmStep): Promise<void> {
  if (step.do === 'wait') {
    if (step.ms !== undefined) await $.clock.after(step.ms, () => void advanceArm($, change, { kind: 'timer' }))
    return
  }
  const arm = await armOfChange($, change)
  if (arm === undefined) return
  const ctx = ctxOf($)
  if (step.do === 'give-up') {
    await dropArm($, change)
    await ctx.notify?.(giveUpText(arm, step.reason))
    await $.ui.status('')
    return
  }
  if (step.do === 'submit') {
    await putArm($, { ...arm, awaitingModel: true })
    await $.clock.after(0, () => void Promise.resolve($.prompt.submit({ text: step.text })).catch(err => ctx.log(`flight：提交修复请求失败：${errText(err)}`)))
    return
  }
  const tried = beforeRetry(arm)
  await putArm($, tried)
  const text = await takeoffSafe($, tried.args, { resume: tried.resume })
  // 重试期间被 /flight abort 取消，或人另发了起飞（since 变了）：不再接着处理
  if ((await armOfChange($, change))?.since !== tried.since) return
  if (isAirborne(text)) {
    await dropArm($, change)
    await ctx.notify?.(`flight：${change} 已起飞（起飞待命自动重试）：${firstLine(text)}`)
    return
  }
  const again = refusedAgain(tried, text)
  await noteRefusal($, again, text)
  await runStep($, change, nextStep(again, { kind: 'refused' }, await $.clock.now()))
}

/** 以一个事件推进某 change 的待命；没有待命或正在执行一步时跳过。异常只记一行。 */
async function advanceArm($: Engine, change: string, event: ArmEvent): Promise<void> {
  if (armBusy.has(change)) return
  armBusy.add(change)
  try {
    const arm = await armOfChange($, change)
    if (arm !== undefined) await runStep($, change, nextStep(arm, event, await $.clock.now()))
  } catch (err) {
    await ctxOf($).log(`flight：起飞待命推进失败（${change}）：${errText(err)}`)
  } finally {
    armBusy.delete(change)
  }
}

/** 已停飞 / 落地的 attempt 派出的 agent 结束（flightOfAgent 不扫已结束的飞行）：账本里派过它的、等 agent 结束的待命以 agent-ended 推进。 */
async function agentEndedArms($: Engine, agentId: string): Promise<void> {
  const io = ioHere($)
  const items = Object.values((await read($, armedAtom)).items) as Arm[]
  for (const arm of items) {
    if (arm.cls !== 'wait-agents') continue
    const at = await locate($, arm.change)
    if ('error' in at) continue
    const ledger = await readLedger(io, at.f)
    if ('events' in ledger && ledger.events.some(e => e.ev === 'dispatch' && String(e.agent) === agentId)) await advanceArm($, arm.change, { kind: 'agent-ended' })
  }
}

/** 对全部（或满足 pick 的）待命以同一事件推进 */
async function advanceAll($: Engine, event: ArmEvent, pick: (arm: Arm) => boolean = () => true): Promise<void> {
  const items = Object.values((await read($, armedAtom)).items) as Arm[]
  for (const arm of items) if (pick(arm)) await advanceArm($, arm.change, event)
}

/** /flight abort：先在账本记停飞，再停本 attempt 仍在跑的 agent（策略在 abort.ts）；之后只刷新面板（停飞已清空状态行）。 */
async function abortCommand($: Engine, f: Flight, state: State): Promise<string> {
  const ctx = ctxOf($)
  const ofA = (e: Ev) => Number(e.attempt) === state.attempt
  const text = await abortFlight({
    state,
    session: await $.session.id(),
    async halt(reason) {
      await runLandingAction(ctx, f, { kind: 'halt', reason, haltKind: 'abort' })
      const after = await readLedger(ctx.io, f)
      return 'events' in after && after.events.some(e => e.ev === 'halt' && ofA(e))
    },
    // 不等队列：先停在飞 agent，再由 abortFlight 调 drain 等手上这轮 drive 做完、补停中途派出的（design D7）
    drain: () => queue.then(() => undefined),
    live: () => liveAgents($, f, state),
    stop: async id => (await taskStop($, id)).thrown,
  })
  await refreshFromLedger($, ctx.io, f)
  return text
}

/** 本 attempt 派出、未结束且引擎仍在跑的 agent（按派发顺序）；账本读不出时用调用方给的状态。 */
async function liveAgents($: Engine, f: Flight, state: State): Promise<string[]> {
  const now = await readLedger(ioHere($), f)
  const evs = 'events' in now ? now.events : state.events
  const ofA = (e: Ev) => Number(e.attempt) === state.attempt
  const ended = new Set(evs.filter(e => e.ev === 'ended').map(e => String(e.agent)))
  const mine = [...new Set(evs.filter(e => e.ev === 'dispatch' && ofA(e)).map(e => String(e.agent)))].filter(id => !ended.has(id))
  const running = new Set((await $.agent.list()).filter(x => LIVE.includes(String(x.status))).map(x => x.id))
  return mine.filter(id => running.has(id))
}

/** TaskStop 一个 agent：thrown = 抛错的首行；refused = 引擎答 isError 的文本（对已结束的 agent 不抛，2.1.296 实测）。 */
async function taskStop($: Engine, id: string): Promise<{ thrown?: string; refused?: string }> {
  try {
    const r = (await $.tool.call({ tool: 'TaskStop', task_id: id } as never)) as { isError?: boolean; text?: unknown } | undefined
    return r?.isError ? { refused: firstLine(String(r.text ?? '')) || 'isError' } : {}
  } catch (err) {
    return { thrown: firstLine(err instanceof Error ? err.message : String(err)) }
  }
}

// ---------------------------------------------------------------- 看门狗（design D2；跟踪在 watchdog.ts）

/** 在途模型请求的起点；只记属于在飞 change 的 agent。处理过的 agent 立即 forget，每个只处理一次 */
const steps = new StepTracker()
/** 与 steps 同步的请求起点，只供 heal / halt 原因里写等待分钟数 */
const startedAt: Map<string, number> = new Map()
/** 最近一次 tick（或起表）的时刻；-1 = 未起表或计时器已结束 */
let tickedAt = -1
/** 计时器代号：每起一个递增；只有代号最新的计时器处理超时 */
let tickerGen = 0
/** 正在处理（含查归属）的 agent：认领在任何 await 之前，并发的另一次 tick 拿到同一快照也跳过 */
const claimed: Set<string> = new Set()

/** 计时器未起或已停时起一个；幂等。 */
// 「两个周期没 tick（或时钟回拨）即视为已停」是启发式：计时器只是迟到（如机器休眠）时会多起一个，旧计时器之后的 tick 按代号直接返回，不重复处理。
// ceiling: 旧计时器不会被取消，仍按周期空转 -> 引擎给出计时器句柄的存活状态或取消接口后改为按句柄判、取消旧计时器
async function ensureTicker($: Engine): Promise<void> {
  const now = await $.clock.now()
  if (tickedAt >= 0 && now >= tickedAt && now - tickedAt < 2 * TICK_MS) return
  tickedAt = now
  const gen = ++tickerGen
  const h = $.clock.every(TICK_MS, () => watchTick($, gen)) as unknown
  if (h instanceof Promise) h.catch(() => { if (gen === tickerGen) tickedAt = -1 })
}

/** 一次 tick：处理新超时的 agent；不是最新代号的计时器直接返回；任何异常只记 diag，不让计时器因抛错停掉。 */
async function watchTick($: Engine, gen: number): Promise<void> {
  if (gen !== tickerGen) return
  try {
    const now = await $.clock.now()
    if (gen !== tickerGen) return
    tickedAt = now
    for (const id of steps.stale(now)) {
      // 本次 tick 卡住期间可能已起了新计时器，或别的 tick 已认领 / 处理过它（startedAt 已删）
      if (gen !== tickerGen || claimed.has(id) || !startedAt.has(id)) continue
      claimed.add(id)
      try {
        // 仍在登记中：dispatch 还没写入账本、找不到所属飞行，留到下一次 tick 再处理
        const o = await ownership(ioHere($), id)
        if ((o !== undefined && 'pending' in o) || !startedAt.has(id)) continue
        const since = startedAt.get(id) ?? now
        steps.forget(id)
        startedAt.delete(id)
        await watchOne($, id, now - since).catch(err => watchDiag($, id, firstLine(err instanceof Error ? err.message : String(err))))
      } finally {
        claimed.delete(id)
      }
    }
    // 60 秒兜底：起飞待命按 tick 推进（design D3）
    if (gen === tickerGen) await advanceAll($, { kind: 'tick' })
  } catch {
    // 连 clock.now 都失败：等下一次 tick
  }
}

/** 看门狗留证据（diag where watchdog）；找不到所属飞行或写入失败时吞掉。 */
async function watchDiag($: Engine, agent: string, error: string): Promise<void> {
  try {
    const ctx = ctxOf($)
    const found = await flightOfAgent(ctx.io, agent)
    if (found === undefined) return
    const attempt = agentOf(reduce(found.events), agent)?.attempt ?? 0
    await appendEvent(ctx.io, found.flight, ev.diag(await base(ctx, found.flight), { attempt, where: 'watchdog', agent, error }))
  } catch {
    // 留证据失败不影响计时器
  }
}

/** 自愈预算的 key（design D2）：执行体 / 修复体 = 其 slice；评审员 = review:<slice>；解冲突 = resolve:<slice>。 */
function watchKey(role: Role, slice: string): string {
  if (role === 'reviewer') return `review:${slice}`
  if (role === 'resolver') return `resolve:${slice}`
  return slice
}

/** 处理一个超时 agent：attempt 已结束 → 只停；预算允许 → 先记 heal 再停；不允许 → 停飞并停本 attempt 全部在跑的 agent。 */
async function watchOne($: Engine, id: string, waitedMs: number): Promise<void> {
  const ctx = ctxOf($)
  const found = await flightOfAgent(ctx.io, id)
  if (found === undefined) return
  const f = found.flight
  const state = reduce(found.events)
  const who = agentOf(state, id)
  if (who === undefined) return
  const stop = async (agent: string) => {
    const r = await taskStop($, agent)
    const error = r.thrown ?? r.refused
    if (error !== undefined) await watchDiag($, agent, error)
  }
  const settled = who.attempt !== state.attempt || state.events.some(e => (e.ev === 'land' || e.ev === 'halt') && Number(e.attempt) === who.attempt)
  if (settled || who.role === 'diagnostician') {
    await stop(id)
    return
  }
  const key = watchKey(who.role, who.slice)
  const waited = `${id}（${key}）的模型请求已等待 ${Math.round(waitedMs / 60000)} 分钟`
  const v = healVerdict(state, 'watchdog', key)
  if (v.ok) {
    await appendEvent(ctx.io, f, ev.heal(await base(ctx, f), { attempt: state.attempt, kind: 'watchdog', slice: key, reason: `看门狗：${waited}`, agent: id }))
    await stop(id)
    return
  }
  const reason = `看门狗：${waited}，${v.reason}`
  await runLandingAction(ctx, f, { kind: 'halt', reason, haltKind: 'watchdog' })
  // 与 /flight abort 同法（abort.ts）：先停在跑的，再等手上这轮 drive 做完，补停其间派出的
  const seen: Set<string> = new Set()
  const stopLive = async () => {
    for (const agent of await liveAgents($, f, state)) {
      if (seen.has(agent)) continue
      seen.add(agent)
      await stop(agent)
    }
  }
  await stopLive()
  await queue.then(() => undefined)
  await stopLive()
  await refreshFromLedger($, ctx.io, f)
  await triage(ctx, f, 'watchdog', reason)
}

/** agent 属于在飞的 change，或是在诊断 change 的诊断员；登记中（dispatch 尚未写入）也算：新 agent 的首个模型请求几乎都落在这段窗口里 */
async function inFlight(io: Io, id: string): Promise<boolean> {
  const o = await ownership(io, id)
  if (o === undefined || 'unknown' in o) return false
  if (active.has(o.change)) return true
  return 'role' in o && o.role === 'diagnostician' && diagnosing.has(o.change)
}

/** /flight 分派：abort / resume 只认人发出；status / panel / abort 读账本作答，resume 走起飞流程。 */
async function flightCommand($: Engine, args: string[], origin: string | undefined): Promise<string> {
  const [sub, ...rest] = args
  if ((sub === 'abort' || sub === 'resume') && !HOST_ORIGINS.includes(origin ?? '')) return originRefusal(`/flight ${sub}`, origin)
  if (sub === 'resume') return takeoffArmed($, rest, { resume: true })
  if (sub !== 'status' && sub !== 'panel' && sub !== 'abort') return FLIGHT_USAGE
  // 省略 change：本进程只登记了一个 change 且它在飞时取它
  const only = flights.size === 1 ? [...flights.keys()][0] : undefined
  const given = rest[0] ?? (only !== undefined && active.has(only) ? only : undefined)
  if (given === undefined) return `${FLIGHT_USAGE}\n没有唯一在飞的 change，请给出 change 名`
  // 待命中的 change：取消待命即可，不必有在飞飞行、不必定位成功（design D6）
  if (sub === 'abort' && (await armOfChange($, given)) !== undefined) {
    await dropArm($, given)
    await $.ui.status('')
    return `flight：${given} 已取消起飞待命`
  }
  const at = await locate($, given)
  if ('error' in at) return at.error
  const { f } = at
  const ledger = await readLedger(ioHere($), f)
  if ('error' in ledger) return `flight：账本读取失败：${firstLine(ledger.error)}`
  const state = reduce(ledger.events)
  if (sub === 'abort') return abortCommand($, f, state)
  const lines = state.takeoff === undefined ? [] : summaryLines(summarize(state))
  if (sub === 'panel') {
    await update($, panel, () => ({ change: f.change, lines }))
    await $.ui.open({ id: 'flight', title: `✈ ${f.change}` })
    return '已打开飞行面板'
  }
  return lines.length ? lines.join('\n') : `${f.change} 尚未起飞`
}

export function registerOrchestrator(on: On): void {
  on('agent.offer', ($, e, next) => (HIDDEN.includes(e.agent) ? { isOffered: false } : next(e)))

  // 起飞异常一律留在地面作答，不把命令交给模型；只有 PASS_THROUGH 参数才 next(e)
  on('command.run', { command: 'opsx-apply' }, async ($, e, next) => {
    const args = argsOf(e.args)
    if (args.includes(RETIRED_ENGINE)) return { text: RETIRED_ENGINE_TEXT }
    // 命令由本插件登记时项目没有命令文件，透传给模型也无从执行：直接指给 legacy skill
    if (args.some(a => PASS_THROUGH.includes(a))) return opsxRegistered ? { text: PER_TASK_GUIDANCE } : next(e)
    const origin = originOf(e)
    if (!HOST_ORIGINS.includes(origin ?? '')) return { text: originRefusal('/opsx-apply', origin) }
    try {
      return { text: await takeoffArmed($, args) }
    } catch (err) {
      return { text: `flight：起飞异常，不起飞（${firstLine(err instanceof Error ? err.message : String(err))}）` }
    }
  }).catch(($, e, next) => {
    if (!argsOf(e.args).some(a => PASS_THROUGH.includes(a)) || next.called) return { text: 'flight：起飞异常，不起飞' }
    return opsxRegistered ? { text: PER_TASK_GUIDANCE } : next(e)
  })

  // register.tsx 已有无 matcher 的 session.start；同事件第二个 hook 须带 matcher（3a S8 实测），用恒真的 cwd matcher
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    entry = (args, opts) => takeoffArmed($, args, opts ?? {})
    try {
      await $.tool.register({ ...FINDINGS_TOOL, isDeferred: false })
    } catch {
      // 注册不了时评审员收口被提醒一次后放行，结束时状态机记 review:<S> 阻断，不拖住飞行
    }
    try {
      await $.tool.register({ ...MEASURE_TOOL, isDeferred: false })
    } catch {
      // 注册不了时执行体只是无从请求测量：G5 账本判据会判红，不静默放过
    }
    try {
      await $.tool.register({ ...SHIP_TOOL, isDeferred: false })
    } catch {
      // 注册不了时模型调不到 ship：PR 停在 draft，由人决定
    }
    try {
      await $.command.register({ name: 'flight', description: '飞行：status | panel | abort | resume' })
    } catch {
      // 登记不了时 /flight 不出现在补全里；起飞与驱动不受影响
    }
    try {
      await $.command.register({ name: 'opsx-apply', description: '飞行模式 apply：由 flight 插件状态机执行（批准后起飞）', argumentHint: '<change>' })
      opsxRegistered = true
    } catch {
      // 项目已有同名命令文件时引擎拒绝登记；command.run 拦截照旧接管 /opsx-apply，--gate=per-task 照旧透传给它
      opsxRegistered = false
    }
    try {
      await ensureTicker($)
    } catch {
      // 起不了表时下一次 turn.step 再起
    }
    return next(e)
  })

  on('command.run', { command: 'flight' }, async ($, e) => {
    try {
      return { text: await flightCommand($, argsOf(e.args), originOf(e)) }
    } catch (err) {
      return { text: `flight：/flight 出错（${firstLine(err instanceof Error ? err.message : String(err))}）` }
    }
  }).catch(() => ({ text: 'flight：/flight 出错' }))

  on('ui.render', { component: 'Pane', requestId: 'flight' }, async ($, e) => {
    const p = await read($, panel)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {p.lines.length ? p.lines.map((line, i) => <Text key={`l${i}`}>{line}</Text>) : <Text>尚无飞行</Text>}
      </Box>
    )
  })

  on('tool.call', { tool: `mcp__flight__${FINDINGS_TOOL.name}` }, async ($, e) => {
    const ctx = ctxOf($)
    const agentId = (e as unknown as { agentId?: string }).agentId
    return onFindings(ctx, agentId ? await flightOfAgent(ctx.io, agentId) : undefined, agentId, e)
  }).catch(() => ({ deny: 'flight：评审回收失败' }))

  on('tool.call', { tool: `mcp__flight__${MEASURE_TOOL.name}` }, async ($, e) => {
    const ctx = ctxOf($)
    const agentId = (e as unknown as { agentId?: string }).agentId
    // D7：归属判不出（在飞账本读取失败）时提示稍后重试，不给「只有执行体可用」的误导理由
    const owner = agentId ? await ownership(ctx.io, agentId) : undefined
    if (owner !== undefined && 'unknown' in owner) return { deny: MEASURE_RETRY }
    const found = agentId ? await flightOfAgent(ctx.io, agentId) : undefined
    // 归属已缓存、在飞账本却读不出：同样判不出
    if (found === undefined && owner !== undefined && !('pending' in owner) && active.has(owner.change)) return { deny: MEASURE_RETRY }
    return onMeasure(ctx, found, agentId)
  }).catch(() => ({ deny: 'flight：测量请求处理失败' }))

  // ship（design D5 / D6）：只认主会话；核对、裁决、贴评论、切换与写 ship 事件全在 ship.ts
  on('tool.call', { tool: `mcp__flight__${SHIP_TOOL.name}` }, async ($, e) => {
    const x = e as unknown as { agentId?: string; change?: unknown; pr?: unknown }
    if (x.agentId) return { deny: SHIP_MAIN_ONLY }
    if (typeof x.change !== 'string' || x.change === '' || typeof x.pr !== 'string' || x.pr === '') {
      return { deny: 'flight：ship 的输入须为 {change: 非空字符串, pr: 非空字符串}' }
    }
    const at = await locate($, x.change)
    if ('error' in at) return { deny: at.error }
    const ledger = await readLedger(ioHere($), at.f)
    if ('error' in ledger) return { deny: `flight：账本读取失败：${firstLine(ledger.error)}` }
    return shipPr(ctxOf($), at.f, reduce(ledger.events), x.pr)
  }).catch(() => ({ deny: 'flight：ship 处理失败' }))

  // 能力包络（D5 / D6 / D8）：飞行 agent 按角色限写与限 git；主会话对在飞树只读
  on('tool.call', { tool: ['Write', 'Edit', 'NotebookEdit', 'Bash'] }, async ($, e, next) => {
    const tool = String(e.tool)
    const agentId = (e as unknown as { agentId?: string }).agentId
    // 主会话先过只读判定，再与非飞行 agent 一样过意图门禁（design D6）；飞行 agent 只受包络约束
    if (!agentId) return mainSessionVerdict([...active.values()], tool, e) ?? (await intentCheck($, tool, e)) ?? next(e)
    const flying = await flyingWho(ctxOf($).io, agentId)
    if (flying === undefined) return (await intentCheck($, tool, e)) ?? next(e)
    if ('pending' in flying) return { deny: 'flight：派发登记中，稍后重试' }
    if ('unknown' in flying) return { deny: `flight：归属判定失败（${flying.error}），稍后重试` }
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
      if (flying === undefined || !('who' in flying) || !inEnvelope(flying, x.tool, x.input)) return v
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
    const gate = await runGate(io, f, who.slice, who.worktree, gateBases(reduce(found.events), e.agent_id))
    const event = ev.gate(await base(ctx, f), { attempt: who.attempt, agent: e.agent_id, ...gate })
    await appendEvent(io, f, event)
    const verdict = stopVerdict(reduce([...found.events, event]), e.agent_id, gate)
    if (verdict.kind === 'block') return { ...(await next(e)), block: verdict.text }
    return next(e)
  }).catch(async ($, e, next) => {
    // D9：收口失败只留证据（diag），对引擎等同 hook 缺席；追加失败吞掉
    try {
      const ctx = ctxOf($)
      const found = await flightOfAgent(ctx.io, e.agent_id)
      if (found !== undefined) {
        const err = (next as unknown as { error?: { kind?: string; message?: string; budget?: number } }).error
        const attempt = agentOf(reduce(found.events), e.agent_id)?.attempt ?? 0
        const x = { attempt, where: 'SubagentStop', agent: e.agent_id, error: err?.message ?? '', kind: err?.kind, budget: err?.budget }
        await appendEvent(ctx.io, found.flight, ev.diag(await base(ctx, found.flight), x))
      }
    } catch {
      // 留证据失败不影响引擎
    }
    return next(e)
  })

  // register.tsx 已有无 matcher 的 turn.complete（主会话刷新批准带）；同事件第二个 hook 须带 matcher，这里只接子 agent 的结束
  on('turn.complete', { agentId: /./ }, async ($, e, next) => {
    if (!e.agentId) return next(e)
    const ctx = ctxOf($)
    const found = await flightOfAgent(ctx.io, e.agentId)
    if (found === undefined) {
      const r = await next(e)
      await agentEndedArms($, e.agentId)
      return r
    }
    const r = await next(e)
    const f = found.flight
    const who = agentOf(reduce(found.events), e.agentId)
    const model = (e.usage as { model?: string } | undefined)?.model ?? null
    const b = await base(ctx, f)
    await appendEvent(ctx.io, f, ev.ended(b, { attempt: who?.attempt ?? 0, agent: e.agentId, reason: String(e.reason), model }))
    if (who?.role === 'diagnostician') {
      diagnosing.delete(f.change)
      // 诊断员的最终回答只供展示（design D6）；attempt 已停飞，不必 drive
      const answer = String((r as { text?: unknown } | undefined)?.text ?? '').trim()
      const text = answer === '' ? '（无回答）' : answer.slice(0, TRIAGE_MAX)
      await appendEvent(ctx.io, f, ev.triage(b, { attempt: who.attempt, agent: e.agentId, text }))
      await ctx.notify?.(`${f.change} 停飞诊断：${firstLine(text)}`)
      await refreshFromLedger($, ctx.io, f)
      return r
    }
    await drive($, f)
    // 本 change 处于起飞待命（如等上一次的 agent 结束）：以 agent-ended 推进
    await advanceArm($, f.change, { kind: 'agent-ended' })
    return r
  }).catch(($, e, next) => next(e))

  // 主会话一轮结束（agentId 为空）：交给模型修复的待命以 main-turn 推进；同事件第三个 hook，带 turnId matcher
  on('turn.complete', { turnId: /./ }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await advanceAll($, { kind: 'main-turn' }, arm => arm.awaitingModel)
    return r
  }).catch(($, e, next) => next(e))

  // 看门狗（design D2）：跟踪在飞 agent 每次模型请求的起止；计时器未起或已停时在这里重起
  on('turn.step', { agentId: /./ }, async function* ($, e, next) {
    const id = String((e as { agentId?: unknown }).agentId ?? '')
    let tracked = false
    try {
      const at = await $.clock.now()
      await ensureTicker($)
      if (id !== '' && (await inFlight(ioHere($), id))) {
        steps.start(id, at)
        startedAt.set(id, at)
        tracked = true
      }
    } catch {
      // 跟踪失败不影响模型请求
    }
    try {
      return yield* next(e)
    } finally {
      if (tracked) {
        steps.end(id)
        startedAt.delete(id)
      }
    }
  } as never)
}
