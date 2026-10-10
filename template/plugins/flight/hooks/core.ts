// 飞行状态机核心：状态由账本事件推出，下一批动作由纯函数决定（spec flight-state-machine · design D2–D5）。
// 只放纯函数与类型：不 import claude-code 的运行时值，不调用任何 $。

export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver'
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type Finding = { severity: Severity; file: string; line: number; summary: string; fix: string }
/** slice-gate.py gate / final 打印的 JSON */
export type GateJson = { slice: string; ok: boolean; commit: string; failed: string[]; warnings?: string[]; ceilings?: unknown[]; base?: string; summary?: string }
/** 账本事件（字段表见 spec flight-ledger-events；by = { plugin: 'flight', session }） */
export type FlightEvent = { v: 1; ev: string; change: string; at: string; by: { plugin: 'flight'; session: string }; [k: string]: unknown }
export type Plan = { waves: string[][]; deps: Record<string, string[]> }
/** 一次飞行的上下文（由 S7 在起飞时组装；changeDir 是相对 worktree 根的路径，如 template/openspec/changes/demo） */
export type Flight = { change: string; mainTree: string; changeTree: string; changeDir: string; branch: string; hooksDir: string; model: string; session: string }
export type RunResult = { exitCode: number; stdout: string; stderr: string }
/** 副作用原语：S5 用 $ 实现，S6 / 测试用假实现 */
export interface Io {
  run(argv: readonly string[], opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; stdin?: string }): Promise<RunResult>
  read(path: string): Promise<string | undefined>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
}
/** 「这个 agent 属于哪次飞行」的查找结果（io.flightOfAgent 的返回） */
export type Found = { flight: Flight; events: FlightEvent[] }
/** hook 文件从 $ 造的上下文：全是闭包，可以跨文件传（实测 X12：$ 本身不能跨 import） */
export interface Ctx {
  io: Io
  now(): Promise<number> // 毫秒时间戳，用于事件的 at
  spawn(x: { f: Flight; role: Role; cwd: string; prompt: string; description: string }): Promise<{ agentId?: string; deny?: string }>
  status(text: string | undefined): Promise<void>
  toast(text: string): Promise<void>
  runCommand(command: string, args: string): Promise<void>
  log(text: string): Promise<void> // 打印到转录（飞行记录）
}
export type Action =
  | { kind: 'dispatch'; role: 'executor'; slice: string; continuation?: { reason: string; failed: string[] } }
  | { kind: 'dispatch'; role: 'resolver'; slice: string; conflicts: string[] }
  | { kind: 'dispatch'; role: 'reviewer'; slice: string; commit: string }
  | { kind: 'dispatch'; role: 'fixer'; findings: Finding[] }
  | { kind: 'gate'; slice: string; agent: string } // 执行体未经收口结束后的补跑门禁
  | { kind: 'merge'; slice: string; via: 'branch' | 'resolve' | 'fix' }
  | { kind: 'final' }
  | { kind: 'land' }
  | { kind: 'halt'; reason: string }
  | { kind: 'blocked'; slice: string; blockKind: 'gate' | 'infra'; reason: string }

/** 账本事件按写入顺序编号；状态即带编号的事件序列加最新 takeoff。 */
type Ev = FlightEvent & { seq: number }
export type State = { readonly events: readonly Ev[]; readonly attempt: number; readonly takeoff: Ev | undefined }

const FIX = 'fix'
const CONFLICT = 'conflict: '
const BLOCKING: readonly Severity[] = ['CRITICAL', 'HIGH']

const str = (e: Ev, k: string): string => String(e[k] ?? '')
const failedOf = (e: Ev | undefined): string[] => (Array.isArray(e?.failed) ? (e.failed as string[]) : [])
const joined = (e: Ev | undefined, fallback: string): string => failedOf(e).join('; ') || fallback
const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1]

export function reduce(events: readonly FlightEvent[]): State {
  const seqd = events.map((e, seq) => ({ ...e, seq }))
  const takeoff = last(seqd.filter(e => e.ev === 'takeoff'))
  return { events: seqd, attempt: takeoff ? Number(takeoff.attempt) : 0, takeoff }
}

export function currentAttempt(state: State): number {
  return state.attempt
}

export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number } | undefined {
  const d = last(state.events.filter(e => e.ev === 'dispatch' && e.agent === agent))
  return d && { role: d.role as Role, slice: str(d, 'slice'), worktree: str(d, 'worktree'), attempt: Number(d.attempt) }
}

/** 一个 agent 结束前的收口门禁结论、结束事件、结束后的补跑门禁结论。 */
function lifecycle(state: State, agent: string) {
  const end = state.events.find(e => e.ev === 'ended' && e.agent === agent)
  const gates = state.events.filter(e => e.ev === 'gate' && e.agent === agent)
  const closing = gates.filter(g => !end || g.seq < end.seq)
  const post = end ? gates.filter(g => g.seq > end.seq) : []
  return { end, closing, post }
}

export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
  if (gate.ok) return { kind: 'accept' }
  // 调用方先记 gate 事件再判；没记入时这条就算第 1 条
  const reds = Math.max(1, lifecycle(state, agent).closing.filter(g => g.ok !== true).length)
  if (reds > 2) return { kind: 'accept' }
  const items = gate.failed.map(f => `- ${f}`).join('\n')
  return { kind: 'block', text: `flight 收口门禁未通过（第 ${reds} 次，第 3 次起放行并记阻断）：\n${items}\n修好这些项后再收口。` }
}

export function next(state: State, plan: Plan, fpNow: string): Action[] {
  const { takeoff, attempt: A } = state
  if (!takeoff) return []
  const evs = state.events
  const inA = (e: Ev) => Number(e.attempt) === A
  const ofA = (ev: string) => evs.filter(e => e.ev === ev && inA(e))
  if (ofA('land').length || ofA('halt').length) return []
  if (fpNow !== takeoff.fp) return [{ kind: 'halt', reason: `计划指纹已变：起飞时 ${str(takeoff, 'fp').slice(0, 8)}，当前 ${fpNow.slice(0, 8)}` }]

  const mergedOk = (s: string) => last(evs.filter(e => e.ev === 'merge' && e.slice === s && e.ok === true))
  const blockedNow = (s: string) => ofA('blocked').find(e => e.slice === s)
  const done = (s: string) => !!mergedOk(s) || !!blockedNow(s)
  const dispatchesA = (s: string, role: Role) => ofA('dispatch').filter(e => e.slice === s && e.role === role)
  const reviewed = (s: string) => evs.some(e => (e.ev === 'review' && e.slice === s) || (e.ev === 'blocked' && e.slice === `review:${s}`))
  const blocked = (slice: string, blockKind: 'gate' | 'infra', reason: string): Action => ({ kind: 'blocked', slice, blockKind, reason })

  function firstDispatch(s: string): Action {
    const prev = last(evs.filter(e => e.ev === 'dispatch' && e.role === 'executor' && e.slice === s && Number(e.attempt) < A))
    const fresh: Action = { kind: 'dispatch', role: 'executor', slice: s }
    if (!prev || evs.some(e => e.ev === 'blocked' && e.slice === s && e.attempt === prev.attempt)) return fresh
    const g = last(evs.filter(e => e.ev === 'gate' && e.slice === s))
    return { ...fresh, continuation: { reason: '上一次飞行中断', failed: failedOf(g) } }
  }

  function afterMergeFailed(s: string, m: Ev): Action[] {
    const conflicts = failedOf(m).filter(f => f.startsWith(CONFLICT)).map(f => f.slice(CONFLICT.length))
    const r = last(dispatchesA(s, 'resolver'))
    if (!r) {
      if (conflicts.length) return [{ kind: 'dispatch', role: 'resolver', slice: s, conflicts }]
      return [blocked(s, 'infra', `合回失败：${joined(m, '未知原因')}`)]
    }
    if (r.seq < m.seq) return [blocked(s, 'infra', `解冲突后合回失败：${joined(m, '未知原因')}`)]
    const { end, closing } = lifecycle(state, str(r, 'agent'))
    if (!end) return []
    const g = last(closing)
    if (g?.ok === true) return [{ kind: 'merge', slice: s, via: 'resolve' }]
    return [blocked(s, 'infra', `解冲突未通过：${joined(g, '没有收口门禁结论')}`)]
  }

  function executorOutcome(s: string, agent: string, dispatched: number): Action[] {
    const { end, closing, post } = lifecycle(state, agent)
    if (!end) return []
    const c = last(closing)
    if (c?.ok === true) return [{ kind: 'merge', slice: s, via: 'branch' }]
    if (c && closing.filter(g => g.ok !== true).length > 2) return [blocked(s, 'gate', joined(c, '门禁红'))]
    const p = last(post)
    if (!p) return [{ kind: 'gate', slice: s, agent }]
    if (p.ok === true) return [{ kind: 'merge', slice: s, via: 'branch' }]
    if (dispatched < 2) return [{ kind: 'dispatch', role: 'executor', slice: s, continuation: { reason: '执行体未正常收口', failed: failedOf(p) } }]
    return [blocked(s, 'gate', joined(p, '门禁红'))]
  }

  function sliceActions(s: string): Action[] {
    const dep = (plan.deps[s] ?? []).find(d => blockedNow(d))
    if (dep) return [blocked(s, 'infra', `依赖已 blocked：${dep}`)]
    const execs = dispatchesA(s, 'executor')
    if (!execs.length) return [firstDispatch(s)]
    const m = last(ofA('merge').filter(e => e.slice === s))
    if (m) return afterMergeFailed(s, m)
    return executorOutcome(s, str(last(execs)!, 'agent'), execs.length)
  }

  function reviewActions(s: string): Action[] {
    if (reviewed(s)) return []
    const r = last(dispatchesA(s, 'reviewer'))
    if (!r) return [{ kind: 'dispatch', role: 'reviewer', slice: s, commit: str(mergedOk(s)!, 'commit') }]
    if (!lifecycle(state, str(r, 'agent')).end) return []
    return [blocked(`review:${s}`, 'infra', `评审未返回：${str(r, 'agent')}`)]
  }

  function closing(): Action[] {
    const findings = reviewFindings(state).filter(f => BLOCKING.includes(f.severity))
    const fixed = evs.some(e => e.ev === 'merge' && e.slice === FIX && e.ok === true)
    if (findings.length && !fixed && !blockedNow(FIX)) {
      const fx = last(dispatchesA(FIX, 'fixer'))
      if (!fx) return [{ kind: 'dispatch', role: 'fixer', findings }]
      const { end, closing: cg } = lifecycle(state, str(fx, 'agent'))
      if (!end) return []
      const m = last(ofA('merge').filter(e => e.slice === FIX && e.seq > end.seq))
      if (m) return [blocked(FIX, 'infra', `修复合回失败：${joined(m, '未知原因')}`)]
      const g = last(cg)
      if (g?.ok === true) return [{ kind: 'merge', slice: FIX, via: 'fix' }]
      return [blocked(FIX, 'gate', joined(g, '修复 agent 没有收口门禁结论'))]
    }
    const fin = last(ofA('final'))
    if (!fin) return [{ kind: 'final' }]
    if (fin.ok === true) return [{ kind: 'land' }]
    return [{ kind: 'halt', reason: `final 未通过：${joined(fin, '未知原因')}` }]
  }

  const all = plan.waves.flat()
  const reviews = all.filter(s => mergedOk(s)).flatMap(reviewActions)
  const wave = plan.waves.find(w => w.some(s => !done(s)))
  if (wave) return [...wave.filter(s => !done(s)).flatMap(sliceActions), ...reviews]
  if (reviews.length || all.some(s => mergedOk(s) && !reviewed(s))) return reviews
  return closing()
}

function reviewFindings(state: State): Finding[] {
  return state.events.filter(e => e.ev === 'review').flatMap(e => (Array.isArray(e.findings) ? (e.findings as Finding[]) : []))
}

export function routingFindings(state: State): Finding[] {
  const takeoffs = state.events.filter(e => e.ev === 'takeoff')
  return state.events
    .filter(e => e.ev === 'ended')
    .flatMap(e => {
      const expected = str(last(takeoffs.filter(t => t.attempt === e.attempt)) ?? state.takeoff ?? e, 'model')
      const actual = typeof e.model === 'string' ? e.model : null
      if (actual && expected && actual.toLowerCase().includes(expected.toLowerCase())) return []
      const role = agentOf(state, str(e, 'agent'))?.role ?? 'unknown'
      return [{
        severity: 'HIGH' as const,
        file: 'routing',
        line: 0,
        summary: `路由不符：${role}（agent ${str(e, 'agent')}）期望 ${expected}，实际 ${actual ?? '缺失'}`,
        fix: `按角色路由用 ${expected} 重跑该角色，或人工核对该 agent 的实际模型`,
      }]
    })
}

export function closeoutLists(state: State): {
  blocked: { slice: string; kind: 'gate' | 'infra'; reason: string }[]
  blocking: Finding[]
  deferred: Finding[]
  fix: { ok: boolean; commit: string } | null
} {
  const findings = reviewFindings(state)
  const fixMerge = last(state.events.filter(e => e.ev === 'merge' && e.slice === FIX))
  return {
    blocked: state.events
      .filter(e => e.ev === 'blocked' && Number(e.attempt) === state.attempt)
      .map(e => ({ slice: str(e, 'slice'), kind: e.kind as 'gate' | 'infra', reason: str(e, 'reason') })),
    blocking: [...findings.filter(f => BLOCKING.includes(f.severity)), ...routingFindings(state)],
    deferred: findings.filter(f => !BLOCKING.includes(f.severity)),
    fix: fixMerge ? { ok: fixMerge.ok === true, commit: str(fixMerge, 'commit') } : null,
  }
}

type Base = { change: string; at: string; session: string }
const make = (ev: string) => (b: Base, x: object): FlightEvent => ({
  v: 1,
  ev,
  change: b.change,
  at: b.at,
  by: { plugin: 'flight', session: b.session },
  ...x,
})

/** 事件构造：产出完整事件（含 v / by），字段对照 spec flight-ledger-events。本 change 不构造 approve。 */
export const ev: {
  takeoff(b: Base, x: { attempt: number; fp: string; branch: string; waves: string[][]; model: string }): FlightEvent
  dispatch(b: Base, x: { attempt: number; slice: string; role: Role; agent: string; model: string; worktree: string }): FlightEvent
  gate(b: Base, x: { attempt: number; agent: string } & GateJson): FlightEvent
  ended(b: Base, x: { attempt: number; agent: string; reason: string; model: string | null }): FlightEvent
  merge(b: Base, x: { attempt: number; slice: string; ok: boolean; commit: string; failed: string[] }): FlightEvent
  review(b: Base, x: { attempt: number; slice: string; agent: string; findings: Finding[] }): FlightEvent
  blocked(b: Base, x: { attempt: number; slice: string; kind: 'gate' | 'infra'; reason: string }): FlightEvent
  final(b: Base, x: { attempt: number; ok: boolean; commit: string; failed: string[] }): FlightEvent
  land(b: Base, x: { attempt: number; verdict: 'ready' | 'draft' }): FlightEvent
  halt(b: Base, x: { attempt: number; reason: string }): FlightEvent
} = {
  takeoff: make('takeoff'),
  dispatch: make('dispatch'),
  gate: make('gate'),
  ended: make('ended'),
  merge: make('merge'),
  review: make('review'),
  blocked: make('blocked'),
  final: make('final'),
  land: make('land'),
  halt: make('halt'),
}
