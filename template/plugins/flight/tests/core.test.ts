// scenario 来源：spec flight-state-machine（core-*），事件形状对照 spec flight-ledger-events。核心是纯函数，直接调用，不经 $。
import { expect, test } from 'claude-code/testing'
import { closeoutLists, ev, next, reduce, stopVerdict } from '../hooks/core'
import type { FlightEvent, Plan, Role } from '../hooks/core'

const AT = '2026-10-09T00:00:00Z'
const B = { change: 'demo', at: AT, session: 'sess' }
const F = 'f'.repeat(64)
const G = 'a'.repeat(64)
const PLAN: Plan = { waves: [['S1', 'S2'], ['S3']], deps: { S3: ['S1'] } }
const ONE: Plan = { waves: [['S1', 'S2']], deps: {} }
const OPUS = 'claude-opus-5-5'

const approve: FlightEvent = { v: 1, ev: 'approve', change: 'demo', at: AT, by: { plugin: 'flight', session: 'sess' }, fp: F }
const takeoff = (attempt: number, waves: string[][] = PLAN.waves) =>
  ev.takeoff(B, { attempt, fp: F, branch: 'worktree-demo', waves, model: 'opus' })
const dispatch = (attempt: number, slice: string, role: Role, agent: string) =>
  ev.dispatch(B, { attempt, slice, role, agent, model: OPUS, worktree: `/wt/${slice}` })
const gate = (attempt: number, agent: string, slice: string, failed: string[]) =>
  ev.gate(B, { attempt, agent, slice, ok: failed.length === 0, commit: `c-${slice}`, failed })
const ended = (attempt: number, agent: string, model: string | null = OPUS) =>
  ev.ended(B, { attempt, agent, reason: 'completed', model })
const merged = (attempt: number, slice: string) => ev.merge(B, { attempt, slice, ok: true, commit: `m-${slice}`, failed: [] })
/** 执行体 agent 门禁绿、结束、合回 */
const landed = (attempt: number, slice: string, agent: string) => [
  dispatch(attempt, slice, 'executor', agent),
  gate(attempt, agent, slice, []),
  ended(attempt, agent),
  merged(attempt, slice),
]

test('core-dispatches-first-wave', () => {
  // Given: 计划 waves [[S1, S2], [S3]]、S3 依赖 S1；账本只有 approve 与 attempt 1 的 takeoff（指纹 F）
  const state = reduce([approve, takeoff(1)])

  // When: 以当前指纹 F 求下一批动作
  const actions = next(state, PLAN, F)

  // Then: 恰为派发 S1、S2 的执行体，没有任何 S3 的动作
  expect(actions).toEqual([
    { kind: 'dispatch', role: 'executor', slice: 'S1' },
    { kind: 'dispatch', role: 'executor', slice: 'S2' },
  ])
})

test('core-blocks-dependents-of-blocked', () => {
  // Given: attempt 1 里 S1 记 blocked（gate，G7 x），S2 已合回且评审给了空 findings
  const state = reduce([
    approve,
    takeoff(1),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G7 x' }),
    ...landed(1, 'S2', 'a2'),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }),
  ])

  // When: 求下一批动作
  const actions = next(state, PLAN, F)

  // Then: 恰为一条 S3 的 infra 阻断，原因为「依赖已 blocked：S1」，没有派发 S3
  expect(actions).toEqual([{ kind: 'blocked', slice: 'S3', blockKind: 'infra', reason: '依赖已 blocked：S1' }])
})

test('core-limits-stop-blocks-to-two', () => {
  // Given: S1 的执行体 A 已有两条收口红结论（G7 x）都被续修，第三条红结论（G7 x）已记入账本
  const third = gate(1, 'A', 'S1', ['G7 x'])
  const state = reduce([
    approve,
    takeoff(1),
    dispatch(1, 'S1', 'executor', 'A'),
    gate(1, 'A', 'S1', ['G7 x']),
    gate(1, 'A', 'S1', ['G7 x']),
    third,
  ])

  // When: 用第三条红结论判 A 的收口
  const verdict = stopVerdict(state, 'A', { slice: 'S1', ok: false, commit: 'c-S1', failed: ['G7 x'] })

  // Then: 判放行
  expect(verdict).toEqual({ kind: 'accept' })
})

test('core-limits-stop-blocks-to-two/after-end', () => {
  // Given: waves 只有 [S1, S2]；S1 的执行体 A 三条收口红结论（G7 x）之后结束；S2 的执行体 B 已派发、仍在运行
  const state = reduce([
    approve,
    takeoff(1, ONE.waves),
    dispatch(1, 'S1', 'executor', 'A'),
    dispatch(1, 'S2', 'executor', 'B'),
    gate(1, 'A', 'S1', ['G7 x']),
    gate(1, 'A', 'S1', ['G7 x']),
    gate(1, 'A', 'S1', ['G7 x']),
    ended(1, 'A'),
  ])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 恰为 S1 的 gate 类阻断，原因为 G7 x
  expect(actions).toEqual([{ kind: 'blocked', slice: 'S1', blockKind: 'gate', reason: 'G7 x' }])
})

test('core-limits-stop-blocks-to-two/second-red-blocks', () => {
  // Given: 执行体 A 已记两条收口红结论，失败项为 G7 x 与 G2 lint
  const state = reduce([
    approve,
    takeoff(1),
    dispatch(1, 'S1', 'executor', 'A'),
    gate(1, 'A', 'S1', ['G7 x']),
    gate(1, 'A', 'S1', ['G7 x', 'G2 lint']),
  ])

  // When: 用第二条红结论判 A 的收口
  const verdict = stopVerdict(state, 'A', { slice: 'S1', ok: false, commit: 'c-S1', failed: ['G7 x', 'G2 lint'] })

  // Then: 判 block，文本含两条失败项
  expect(verdict.kind).toBe('block')
  expect(verdict.kind === 'block' && verdict.text.includes('G7 x') && verdict.text.includes('G2 lint')).toBe(true)
})

test('core-respawns-once-after-silent-end', () => {
  // Given: waves 只有 [S1]；四个账本快照：
  //   ① 执行体 A 无收口结论就结束；② 补跑门禁红（G3 test）；
  //   ③ 续接的执行体 A2 同样无收口结论就结束；④ 再补跑门禁仍红（G3 test）
  const solo: Plan = { waves: [['S1']], deps: {} }
  const s1 = [approve, takeoff(1, solo.waves), dispatch(1, 'S1', 'executor', 'A'), ended(1, 'A')]
  const s2 = [...s1, gate(1, 'A', 'S1', ['G3 test'])]
  const s3 = [...s2, dispatch(1, 'S1', 'executor', 'A2'), ended(1, 'A2')]
  const s4 = [...s3, gate(1, 'A2', 'S1', ['G3 test'])]

  // When: 对四个快照各求一次下一批动作
  const got = [s1, s2, s3, s4].map(evs => next(reduce(evs), solo, F))

  // Then: ① 补跑 A 的 S1 门禁；② 续接派发 S1 执行体并带失败项；③ 补跑 A2 的门禁；④ S1 记 gate 阻断
  expect(got[0]).toEqual([{ kind: 'gate', slice: 'S1', agent: 'A' }])
  expect(got[1]).toEqual([
    { kind: 'dispatch', role: 'executor', slice: 'S1', continuation: { reason: '执行体未正常收口', failed: ['G3 test'] } },
  ])
  expect(got[2]).toEqual([{ kind: 'gate', slice: 'S1', agent: 'A2' }])
  expect(got[3]).toEqual([{ kind: 'blocked', slice: 'S1', blockKind: 'gate', reason: 'G3 test' }])
})

test('core-reviews-fixes-then-finals', () => {
  // Given: waves [[S1, S2]] 全部合回；S1 评审 1 条 HIGH，S2 评审 1 条 LOW；三个快照：
  //   ① 评审全部返回；② 修复 agent X 收口门禁绿、结束、修复合回；③ final 绿
  const high = { severity: 'HIGH' as const, file: 'a.ts', line: 3, summary: '空指针', fix: '判空' }
  const low = { severity: 'LOW' as const, file: 'b.ts', line: 9, summary: '命名', fix: '改名' }
  const s1 = [
    approve,
    takeoff(1, ONE.waves),
    ...landed(1, 'S1', 'a1'),
    ...landed(1, 'S2', 'a2'),
    dispatch(1, 'S1', 'reviewer', 'r1'),
    dispatch(1, 'S2', 'reviewer', 'r2'),
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [high] }),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [low] }),
    ended(1, 'r1'),
    ended(1, 'r2'),
  ]
  const s2 = [
    ...s1,
    dispatch(1, 'fix', 'fixer', 'X'),
    gate(1, 'X', 'fix', []),
    ended(1, 'X'),
    ev.merge(B, { attempt: 1, slice: 'fix', ok: true, commit: 'm-fix', failed: [] }),
  ]
  const s3 = [...s2, ev.final(B, { attempt: 1, ok: true, commit: 'c-final', failed: [] })]

  // When: 对三个快照各求一次下一批动作
  const got = [s1, s2, s3].map(evs => next(reduce(evs), ONE, F))

  // Then: ① 派发修复 agent，findings 只含那条 HIGH；② 跑 final；③ 落地
  expect(got[0]).toEqual([{ kind: 'dispatch', role: 'fixer', findings: [high] }])
  expect(got[1]).toEqual([{ kind: 'final' }])
  expect(got[2]).toEqual([{ kind: 'land' }])
})

test('core-halts-on-final-red', () => {
  // Given: waves [[S1, S2]] 全部合回且评审无问题；最新 final 事件 ok=false、failed=["G2 lint"]
  const state = reduce([
    approve,
    takeoff(1, ONE.waves),
    ...landed(1, 'S1', 'a1'),
    ...landed(1, 'S2', 'a2'),
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [] }),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }),
    ev.final(B, { attempt: 1, ok: false, commit: 'c-final', failed: ['G2 lint'] }),
  ])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 恰为一条停飞动作，原因含 G2 lint（因而没有落地）
  expect(actions).toHaveLength(1)
  expect(actions[0]?.kind === 'halt' && actions[0].reason.includes('G2 lint')).toBe(true)
})

test('core-halts-on-plan-change', () => {
  // Given: attempt 1 的 takeoff 指纹为 F，当前计划指纹为 G
  const state = reduce([approve, takeoff(1)])

  // When: 以当前指纹 G 求下一批动作
  const actions = next(state, PLAN, G)

  // Then: 恰为一条停飞动作，原因含「计划指纹已变」
  expect(actions).toHaveLength(1)
  expect(actions[0]?.kind === 'halt' && actions[0].reason.includes('计划指纹已变')).toBe(true)
})

test('core-continues-from-previous-attempt', () => {
  // Given: attempt 1 里 S1 已合回且评审为空，S2 已派发（执行体 a2）无结论；之后有 attempt 2 的 takeoff
  const state = reduce([
    approve,
    takeoff(1),
    ...landed(1, 'S1', 'a1'),
    dispatch(1, 'S1', 'reviewer', 'r1'),
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [] }),
    dispatch(1, 'S2', 'executor', 'a2'),
    takeoff(2),
  ])

  // When: 求下一批动作
  const actions = next(state, PLAN, F)

  // Then: 恰为续接派发 S2 的执行体（原因「上一次飞行中断」、无失败项），没有 S1 的执行体或评审员
  expect(actions).toEqual([
    { kind: 'dispatch', role: 'executor', slice: 'S2', continuation: { reason: '上一次飞行中断', failed: [] } },
  ])
})

test('core-builds-ledger-events', () => {
  // Given: 一次派发（attempt 1、S1、executor、agent a1、模型 claude-opus-5-5、worktree /wt/S1）、
  //   一次门禁结论（S1 红，commit abc，failed ["G7 x"]，warnings ["w"]，base b0）、一次 agent 结束（reason max_turns，模型缺失）
  const d = { attempt: 1, slice: 'S1', role: 'executor' as const, agent: 'a1', model: OPUS, worktree: '/wt/S1' }
  const g = { attempt: 1, agent: 'a1', slice: 'S1', ok: false, commit: 'abc', failed: ['G7 x'], warnings: ['w'], base: 'b0' }
  const e = { attempt: 1, agent: 'a1', reason: 'max_turns', model: null }

  // When: 用事件构造函数生成三条事件
  const built = [ev.dispatch(B, d), ev.gate(B, g), ev.ended(B, e)]

  // Then: 三条事件逐字段等于 flight-ledger-events 表中 dispatch、gate、ended 三行的字面量
  const by = { plugin: 'flight', session: 'sess' }
  expect(built).toEqual([
    { v: 1, ev: 'dispatch', change: 'demo', at: AT, by, attempt: 1, slice: 'S1', role: 'executor', agent: 'a1', model: 'claude-opus-5-5', worktree: '/wt/S1' },
    { v: 1, ev: 'gate', change: 'demo', at: AT, by, attempt: 1, agent: 'a1', slice: 'S1', ok: false, commit: 'abc', failed: ['G7 x'], warnings: ['w'], base: 'b0' },
    { v: 1, ev: 'ended', change: 'demo', at: AT, by, attempt: 1, agent: 'a1', reason: 'max_turns', model: null },
  ])
})

test('core-reports-routing-mismatch', () => {
  // Given: takeoff 主模型为 opus；执行体 a1 的 ended 事件实际模型为 claude-sonnet-5-5
  const state = reduce([
    approve,
    takeoff(1),
    dispatch(1, 'S1', 'executor', 'a1'),
    gate(1, 'a1', 'S1', []),
    ended(1, 'a1', 'claude-sonnet-5-5'),
  ])

  // When: 求收口清单
  const { blocking } = closeoutLists(state)

  // Then: 恰有一条 HIGH（file routing、line 0），summary 含「路由不符」、executor、opus、claude-sonnet-5-5
  expect(blocking).toHaveLength(1)
  expect(blocking[0]).toMatchObject({ severity: 'HIGH', file: 'routing', line: 0 })
  expect(['路由不符', 'executor', 'opus', 'claude-sonnet-5-5'].every(w => blocking[0]?.summary.includes(w))).toBe(true)
})

// scenario 来源：spec flight-blocked-halt（flight-gate-speedup）

test('core-halts-when-slices-blocked', () => {
  // Given: waves [[S1, S2]]；attempt 1 里 S1 记 blocked（gate，G7 x），S2 已合回、评审员 r2 给了 1 条 HIGH 并结束
  const high = { severity: 'HIGH' as const, file: 'a.ts', line: 3, summary: '空指针', fix: '判空' }
  const state = reduce([
    approve,
    takeoff(1, ONE.waves),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G7 x' }),
    ...landed(1, 'S2', 'a2'),
    dispatch(1, 'S2', 'reviewer', 'r2'),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [high] }),
    ended(1, 'r2'),
  ])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 恰为一条停飞动作（因而没有修复派发与 final），原因含 S1、G7 x 与「未跑 final」
  const halt = actions[0]
  expect(actions).toHaveLength(1)
  expect(halt?.kind === 'halt' && ['S1', 'G7 x', '未跑 final'].every(w => halt.reason.includes(w))).toBe(true)
})

test('core-waits-reviews-before-halting', () => {
  // Given: waves [[S1, S2]]；S1 记 blocked（gate，G7 x），S2 已合回、评审员 r2 已派发但既无 review 事件也无 ended
  const state = reduce([
    approve,
    takeoff(1, ONE.waves),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G7 x' }),
    ...landed(1, 'S2', 'a2'),
    dispatch(1, 'S2', 'reviewer', 'r2'),
  ])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 动作里没有停飞
  expect(actions.some(a => a.kind === 'halt')).toBe(false)
})

test('core-review-blocked-still-finals', () => {
  // Given: waves [[S1, S2]] 全部合回；S1 评审为空列表；S2 的评审员 r2 结束未返回，review:S2 记 blocked（infra，评审未返回：r2）
  const state = reduce([
    approve,
    takeoff(1, ONE.waves),
    ...landed(1, 'S1', 'a1'),
    ...landed(1, 'S2', 'a2'),
    dispatch(1, 'S1', 'reviewer', 'r1'),
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [] }),
    ended(1, 'r1'),
    dispatch(1, 'S2', 'reviewer', 'r2'),
    ended(1, 'r2'),
    ev.blocked(B, { attempt: 1, slice: 'review:S2', kind: 'infra', reason: '评审未返回：r2' }),
  ])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 恰为一条 final 动作
  expect(actions).toEqual([{ kind: 'final' }])
})

test('core-resume-redispatches-blocked-slice', () => {
  // Given: attempt 1 里 S1 的执行体 a1 记 blocked（gate，G7 x），S2 已合回且评审为空列表，之后停飞；随后有 attempt 2 的 takeoff
  const state = reduce([
    approve,
    takeoff(1, ONE.waves),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G7 x' }),
    ...landed(1, 'S2', 'a2'),
    dispatch(1, 'S2', 'reviewer', 'r2'),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }),
    ended(1, 'r2'),
    ev.halt(B, { attempt: 1, reason: '切片 blocked：S1（G7 x）' }),
    takeoff(2, ONE.waves),
  ])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 恰为全新派发 S1 的执行体，没有任何 S2 的动作
  expect(actions).toEqual([{ kind: 'dispatch', role: 'executor', slice: 'S1' }])
})
