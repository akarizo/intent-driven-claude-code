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
  | { kind: 'dispatch'; role: 'executor'; slice: string; continuation?: { reason: string; failed: string[] }; base?: string }
  | { kind: 'dispatch'; role: 'resolver'; slice: string; conflicts: string[] }
  | { kind: 'dispatch'; role: 'reviewer'; slice: string; commit: string; mode?: 'whole' | 'followup'; base?: string; prior?: Finding[] }
  | { kind: 'dispatch'; role: 'fixer'; slice?: string; findings: Finding[] } // slice 缺省为 'fix'；修复轮为 'fix-r<k>'
  | { kind: 'gate'; slice: string; agent: string } // 执行体未经收口结束后的补跑门禁
  | { kind: 'regate'; slice: string; base: string; worktree: string } // 续飞：上一 attempt 已绿未合回的切片，以原 base 补跑门禁
  | { kind: 'merge'; slice: string; via: 'branch' | 'resolve' | 'fix' }
  | { kind: 'final' }
  | { kind: 'land' }
  | { kind: 'halt'; reason: string }
  | { kind: 'blocked'; slice: string; blockKind: 'gate' | 'infra'; reason: string }

/** 账本事件按写入顺序编号；状态即带编号的事件序列加最新 takeoff。 */
type Ev = FlightEvent & { seq: number }
export type State = { readonly events: readonly Ev[]; readonly attempt: number; readonly takeoff: Ev | undefined }

const FIX = 'fix'
const REGATE = 'regate'
const CONFLICT = 'conflict: '
const BLOCKING: readonly Severity[] = ['CRITICAL', 'HIGH']
const FIX_ROUND = /^fix-r\d+$/
const WHOLE = /^whole(-r\d+)?$/
/** 第 k 轮全量评审的 slice：0 为 whole，之后为 whole-r<k> */
const wholeSlice = (k: number) => (k === 0 ? 'whole' : `whole-r${k}`)

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

/** dispatch 所在分支：事件记了就用；旧事件由 worktree basename `flight-<change>-<name>` 推出 `flight/<change>/<name>`，推不出为空串。 */
function branchOf(d: Ev): string {
  if (typeof d.branch === 'string' && d.branch !== '') return d.branch
  const change = str(d, 'change')
  const base = str(d, 'worktree').replace(/\/+$/, '').split('/').pop() ?? ''
  const prefix = `flight-${change}-`
  return change && base.startsWith(prefix) && base.length > prefix.length ? `flight/${change}/${base.slice(prefix.length)}` : ''
}

export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number; branch: string; base?: string } | undefined {
  const d = last(state.events.filter(e => e.ev === 'dispatch' && e.agent === agent))
  return d && { role: d.role as Role, slice: str(d, 'slice'), worktree: str(d, 'worktree'), attempt: Number(d.attempt), branch: branchOf(d), ...(typeof d.base === 'string' && d.base !== '' ? { base: d.base } : {}) }
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

  const baseOf = (e: Ev | undefined) => (e && typeof e.base === 'string' && e.base !== '' ? { base: e.base } : {})

  function firstDispatch(s: string): Action {
    const prev = last(evs.filter(e => e.ev === 'dispatch' && e.role === 'executor' && e.slice === s && Number(e.attempt) < A))
    const fresh: Action = { kind: 'dispatch', role: 'executor', slice: s }
    if (!prev || evs.some(e => e.ev === 'blocked' && e.slice === s && e.attempt === prev.attempt)) return fresh
    // 续接只限同一份计划：上一个执行体所在 attempt 的起飞指纹与当前不同就另起新派发（design D2）
    const prevTakeoff = last(evs.filter(e => e.ev === 'takeoff' && e.attempt === prev.attempt))
    if (prevTakeoff?.fp !== takeoff!.fp) return fresh
    // 门禁结论也只认上一个执行体派发之后的：更早的属于旧计划或旧现场，不得拿来补跑（PR #47 评审 MEDIUM）；
    // 且只认该执行体自己的或补跑的：别的执行体迟到的结论不代表它的现场（design D8）
    const g = last(evs.filter(e => e.ev === 'gate' && e.slice === s && e.seq > prev.seq && (e.agent === prev.agent || e.agent === REGATE)))
    const b = baseOf(g)
    if (g?.ok === true && b.base) return { kind: 'regate', slice: s, base: b.base, worktree: str(prev, 'worktree') }
    return { ...fresh, continuation: { reason: '上一次飞行中断', failed: failedOf(g) }, ...b }
  }

  /** 本 attempt 还没派过执行体：有补跑结论按结论走，否则按首次派发判。 */
  function beforeExecutor(s: string): Action[] {
    const r = last(ofA('gate').filter(e => e.slice === s && e.agent === REGATE))
    if (!r) return [firstDispatch(s)]
    if (r.ok !== true) return [{ kind: 'dispatch', role: 'executor', slice: s, continuation: { reason: '上一次飞行中断', failed: failedOf(r) }, ...baseOf(last(evs.filter(e => e.ev === 'gate' && e.slice === s && baseOf(e).base))) }]
    const m = last(ofA('merge').filter(e => e.slice === s))
    if (m) return afterMergeFailed(s, m)
    return [{ kind: 'merge', slice: s, via: 'branch' }]
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
    if (!execs.length) return beforeExecutor(s)
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
    // 评审已收齐才会走到这里；有计划切片 blocked 时 final 必红，停飞等续飞只重派它们
    const stuck = plan.waves.flat().filter(s => blockedNow(s))
    if (stuck.length) {
      const list = stuck.map(s => `${s}（${str(blockedNow(s)!, 'reason').split('\n')[0]}）`).join('、')
      const change = str(takeoff, 'change')
      return [{ kind: 'halt', reason: `切片 blocked：${list}；未派修复、未跑 final。修好后重发 /opsx-apply${change ? ` ${change}` : ''} 续飞，只重派这些切片` }]
    }
    const sliceBlocking = blockingOf(reviewFindings(state, true))
    const fixed = evs.some(e => e.ev === 'merge' && e.slice === FIX && e.ok === true)
    if (sliceBlocking.length && !fixed && !blockedNow(FIX)) {
      const fx = last(dispatchesA(FIX, 'fixer'))
      if (!fx) return [{ kind: 'dispatch', role: 'fixer', findings: sliceBlocking }]
      return fixerOutcome(FIX, fx)
    }
    const fin = last(ofA('final'))
    if (!fin) return [{ kind: 'final' }]
    if (fin.ok !== true) return [{ kind: 'halt', reason: `final 未通过：${joined(fin, '未知原因')}` }]
    return wholeReview(fin)
  }

  /** 修复体结束后：合回失败、门禁绿合回、否则 blocked（切片级修复与修复轮共用）。 */
  function fixerOutcome(s: string, fx: Ev): Action[] {
    const { end, closing: cg } = lifecycle(state, str(fx, 'agent'))
    if (!end) return []
    const m = last(ofA('merge').filter(e => e.slice === s && e.seq > end.seq))
    if (m) return [blocked(s, 'infra', `修复合回失败：${joined(m, '未知原因')}`)]
    const g = last(cg)
    if (g?.ok === true) return [{ kind: 'merge', slice: s, via: 'fix' }]
    return [blocked(s, 'gate', joined(g, '修复 agent 没有收口门禁结论'))]
  }

  /** final 绿之后：全量评审 → CRITICAL/HIGH 修复轮 → 复核，修复至多 2 轮（design D2）；只看本 attempt。 */
  function wholeReview(fin: Ev): Action[] {
    const fixMerges = ofA('merge').filter(e => FIX_ROUND.test(str(e, 'slice')) && e.ok === true)
    if (fixMerges.some(m => m.seq > fin.seq)) return [{ kind: 'final' }]
    const k = new Set(fixMerges.map(m => str(m, 'slice'))).size
    const R = wholeSlice(k)
    const rev = last(ofA('review').filter(e => e.slice === R))
    if (!rev) {
      if (blockedNow(`review:${R}`)) return [{ kind: 'land' }]
      const d = last(dispatchesA(R, 'reviewer'))
      if (!d) {
        const commit = str(fin, 'commit')
        if (k === 0) return [{ kind: 'dispatch', role: 'reviewer', slice: R, mode: 'whole', commit, prior: blockingOf(reviewFindings(state, true)) }]
        const prev = wholeSlice(k - 1)
        const prevReview = last(ofA('review').filter(e => e.slice === prev))
        return [{
          kind: 'dispatch', role: 'reviewer', slice: R, mode: 'followup',
          base: String(last(dispatchesA(prev, 'reviewer'))?.commit ?? ''), commit,
          prior: blockingOf(findingsOf(prevReview)),
        }]
      }
      if (!lifecycle(state, str(d, 'agent')).end) return []
      return [blocked(`review:${R}`, 'infra', `评审未返回：${str(d, 'agent')}`)]
    }
    const findings = blockingOf(findingsOf(rev))
    if (!findings.length || k >= 2) return [{ kind: 'land' }]
    const F = `fix-r${k + 1}`
    if (blockedNow(F)) return [{ kind: 'land' }]
    const fx = last(dispatchesA(F, 'fixer'))
    if (!fx) return [{ kind: 'dispatch', role: 'fixer', slice: F, findings }]
    return fixerOutcome(F, fx)
  }

  const all = plan.waves.flat()
  const reviews = all.filter(s => mergedOk(s)).flatMap(reviewActions)
  const wave = plan.waves.find(w => w.some(s => !done(s)))
  if (wave) return [...wave.filter(s => !done(s)).flatMap(sliceActions), ...reviews]
  if (reviews.length || all.some(s => mergedOk(s) && !reviewed(s))) return reviews
  return closing()
}

const findingsOf = (e: Ev | undefined): Finding[] => (Array.isArray(e?.findings) ? (e.findings as Finding[]) : [])
const blockingOf = (fs: readonly Finding[]): Finding[] => fs.filter(f => BLOCKING.includes(f.severity))

/** 全部 review 事件的 findings；sliceOnly 时只取切片评审（不含 whole / whole-r<k>）。 */
function reviewFindings(state: State, sliceOnly = false): Finding[] {
  return state.events.filter(e => e.ev === 'review' && !(sliceOnly && WHOLE.test(str(e, 'slice')))).flatMap(findingsOf)
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

export type SliceRow = {
  id: string
  wave: number
  phase: string // 待派 / 执行中 / 门禁红（n 次）/ 已合回 / 阻断（gate|infra）
  agent?: string
  reds: number // 本 attempt 门禁红次数
  measured: string // 先红 / 未先红 / -
  review: string // 未开始 / 进行中 / <n> 条（CRITICAL/HIGH <k>）
}
export type FlightSummary = {
  change: string
  attempt: number
  waves: number
  wave: number // 当前 wave（1 起），已全部完成为 waves
  slices: SliceRow[]
  fix: string // 未派 / 进行中 / 已合回 / 无需
  final: string // 未跑 / 绿 / 红
  whole: string // 未开始 / 进行中 / 未返回 / 第 n 轮 x 条（CRITICAL/HIGH y）
  end: string // 在飞 / 已落地（ready|draft）/ 已停飞（<原因>）
}

/** 飞行进度归约（design D2）：只看本 attempt 的事件，合回与评审跨 attempt 计入（与 next 口径一致）。 */
export function summarize(state: State): FlightSummary {
  const { takeoff, attempt: A, events: evs } = state
  const waves = Array.isArray(takeoff?.waves) ? (takeoff?.waves as string[][]) : []
  const ofA = (ev: string) => evs.filter(e => e.ev === ev && Number(e.attempt) === A)
  const mergedOk = (s: string) => evs.some(e => e.ev === 'merge' && e.slice === s && e.ok === true)
  const blockedNow = (s: string) => last(ofA('blocked').filter(e => e.slice === s))
  const dispatchesA = (s: string, role: Role) => ofA('dispatch').filter(e => e.slice === s && e.role === role)
  const failing = (e: Ev) => Array.isArray(e.outcomes) && (e.outcomes as [string, string][]).some(([, o]) => o === 'FAILED' || o === 'ERROR')

  function row(id: string, wave: number): SliceRow {
    const gates = ofA('gate').filter(e => e.slice === id)
    const reds = gates.filter(g => g.ok === false).length
    const exec = last(dispatchesA(id, 'executor'))
    const b = blockedNow(id)
    const lastGate = last(gates)
    const phase = mergedOk(id) ? '已合回'
      : b ? `阻断（${str(b, 'kind')}）`
      : exec ? (lastGate && lastGate.ok !== true ? `门禁红（${reds} 次）` : '执行中')
      : '待派'
    const ms = ofA('measure').filter(e => e.slice === id)
    const measured = !ms.length ? '-' : ms.some(m => !(Array.isArray(m.source) && m.source.length) && failing(m)) ? '先红' : '未先红'
    const reviews = evs.filter(e => e.ev === 'review' && e.slice === id)
    const findings = reviews.flatMap(e => (Array.isArray(e.findings) ? (e.findings as Finding[]) : []))
    const review = reviews.length ? `${findings.length} 条（CRITICAL/HIGH ${findings.filter(f => BLOCKING.includes(f.severity)).length}）`
      : dispatchesA(id, 'reviewer').length ? '进行中'
      : '未开始'
    return { id, wave, phase, ...(exec ? { agent: str(exec, 'agent') } : {}), reds, measured, review }
  }

  const fixers = dispatchesA(FIX, 'fixer')
  const fix = fixers.length ? (mergedOk(FIX) ? '已合回' : '进行中')
    : blockingOf(reviewFindings(state, true)).length ? '未派' : '无需'
  // 全量评审：本 attempt 最新一轮（whole 为第 1 轮，whole-r<k> 为第 k+1 轮）
  const wd = last(ofA('dispatch').filter(e => e.role === 'reviewer' && WHOLE.test(str(e, 'slice'))))
  const ws = wd ? str(wd, 'slice') : ''
  const wr = last(ofA('review').filter(e => e.slice === ws))
  const wf = findingsOf(wr)
  const whole = !wd ? '未开始'
    : wr ? `第 ${ws === 'whole' ? 1 : Number(ws.slice('whole-r'.length)) + 1} 轮 ${wf.length} 条（CRITICAL/HIGH ${blockingOf(wf).length}）`
    : blockedNow(`review:${ws}`) ? '未返回'
    : '进行中'
  const fin = last(ofA('final'))
  const land = last(ofA('land'))
  const halt = last(ofA('halt'))
  const current = waves.findIndex(w => w.some(s => !mergedOk(s) && !blockedNow(s)))
  return {
    change: takeoff ? str(takeoff, 'change') : '',
    attempt: A,
    waves: waves.length,
    wave: current < 0 ? waves.length : current + 1,
    slices: waves.flatMap((w, i) => w.map(s => row(s, i + 1))),
    fix,
    final: !fin ? '未跑' : fin.ok === true ? '绿' : '红',
    whole,
    end: land ? `已落地（${str(land, 'verdict')}）` : halt ? `已停飞（${str(halt, 'reason')}）` : '在飞',
  }
}

export function summaryLines(s: FlightSummary): string[] {
  return [
    `✈ ${s.change} · attempt ${s.attempt} · W${s.wave}/${s.waves} · ${s.end}`,
    ...s.slices.map(r => `${r.id} W${r.wave} ${r.phase} · 门禁红 ${r.reds} · 测量 ${r.measured} · 评审 ${r.review}`),
    `修复 ${s.fix} · final ${s.final} · 全量评审 ${s.whole}`,
  ]
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
  dispatch(b: Base, x: { attempt: number; slice: string; role: Role; agent: string; model: string; worktree: string; base?: string; branch?: string; commit?: string }): FlightEvent
  gate(b: Base, x: { attempt: number; agent: string } & GateJson): FlightEvent
  ended(b: Base, x: { attempt: number; agent: string; reason: string; model: string | null }): FlightEvent
  merge(b: Base, x: { attempt: number; slice: string; ok: boolean; commit: string; failed: string[] }): FlightEvent
  review(b: Base, x: { attempt: number; slice: string; agent: string; findings: Finding[] }): FlightEvent
  blocked(b: Base, x: { attempt: number; slice: string; kind: 'gate' | 'infra'; reason: string }): FlightEvent
  final(b: Base, x: { attempt: number; ok: boolean; commit: string; failed: string[] }): FlightEvent
  land(b: Base, x: { attempt: number; verdict: 'ready' | 'draft' }): FlightEvent
  halt(b: Base, x: { attempt: number; reason: string }): FlightEvent
  measure(b: Base, x: { attempt: number; slice: string; agent: string; base: string; commit: string; outcomes: [string, string][]; changed: string[]; source: string[] }): FlightEvent
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
  measure: make('measure'),
}
