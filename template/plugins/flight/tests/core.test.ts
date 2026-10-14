// scenario 来源：spec flight-state-machine（core-*），事件形状对照 spec flight-ledger-events。核心是纯函数，直接调用，不经 $。
import { expect, test } from 'claude-code/testing'
import * as core from '../hooks/core'
import { agentOf, ev, next, reduce, routingFindings, stopVerdict, summarize, summaryLines } from '../hooks/core'
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
/** 收口的预合并成功（已包含）：本 attempt 第一次 final 之前必有一条（DRAFT-flight-premerge-before-final） */
const premergeOk = (attempt: number) => ev.premerge(B, { attempt, ok: true, ref: 'origin/main', target: 't-main', commit: '', conflicts: [], reason: '已包含' })
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

test('redispatch-without-dispatch-base-unchanged', () => {
  // Given: waves 只有 [S1]；S1 执行体 A 的派发没有 base 字段（旧账本），A 收口门禁红（G4 GWT）后结束，结束后补跑门禁仍红（G4 GWT）
  const solo: Plan = { waves: [['S1']], deps: {} }
  const evs = [approve, takeoff(1, solo.waves), dispatch(1, 'S1', 'executor', 'A'), gate(1, 'A', 'S1', ['G4 GWT']), ended(1, 'A'), gate(1, 'A', 'S1', ['G4 GWT'])]

  // When: 求下一批动作
  const got = next(reduce(evs), solo, F)

  // Then: 恰为续派 S1 执行体，续接原因「执行体未正常收口」、失败项 G4 GWT，动作不含 base
  expect(got).toEqual([{ kind: 'dispatch', role: 'executor', slice: 'S1', continuation: { reason: '执行体未正常收口', failed: ['G4 GWT'] } }])
})

test('redispatch-carries-dispatch-base', () => {
  // Given: waves 只有 [S1]；两份账本，S1 执行体 A 的派发都记 base b0：甲 A 收口门禁红（G4 GWT）后结束、补跑门禁仍红（G4 GWT）；乙 A 无收口结论就结束、补跑门禁红（G3 test）
  const solo: Plan = { waves: [['S1']], deps: {} }
  const head = [approve, takeoff(1, solo.waves), ev.dispatch(B, { attempt: 1, slice: 'S1', role: 'executor', agent: 'A', model: OPUS, worktree: '/wt/S1', base: 'b0' })]
  const jia = [...head, gate(1, 'A', 'S1', ['G4 GWT']), ended(1, 'A'), gate(1, 'A', 'S1', ['G4 GWT'])]
  const yi = [...head, ended(1, 'A'), gate(1, 'A', 'S1', ['G3 test'])]

  // When: 对两份账本各求一次下一批动作
  const got = [jia, yi].map(evs => next(reduce(evs), solo, F))

  // Then: 甲为续派 S1 执行体、续接原因「执行体未正常收口」、失败项 G4 GWT、base b0；乙同为续派、失败项 G3 test、base b0
  expect(got[0]).toEqual([{ kind: 'dispatch', role: 'executor', slice: 'S1', continuation: { reason: '执行体未正常收口', failed: ['G4 GWT'] }, base: 'b0' }])
  expect(got[1]).toEqual([{ kind: 'dispatch', role: 'executor', slice: 'S1', continuation: { reason: '执行体未正常收口', failed: ['G3 test'] }, base: 'b0' }])
})

test('core-reviews-fixes-then-finals', () => {
  // Given: waves [[S1, S2]] 全部合回；S1 评审 1 条 HIGH，S2 评审 1 条 LOW；三个快照：
  //   ① 评审全部返回；② 修复 agent X 收口门禁绿、结束、修复合回，收口预合并成功（第一次 final 前必有，DRAFT-flight-premerge-before-final）；③ final 绿
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
    premergeOk(1),
  ]
  const s3 = [...s2, ev.final(B, { attempt: 1, ok: true, commit: 'c-final', failed: [] })]
  const s4 = [
    ...s3,
    ev.dispatch(B, { attempt: 1, slice: 'whole', role: 'reviewer', agent: 'w0', model: OPUS, worktree: '/wt/whole', commit: 'c-final' }),
    ev.review(B, { attempt: 1, slice: 'whole', agent: 'w0', findings: [] }),
  ]

  // When: 对四个快照各求一次下一批动作
  const got = [s1, s2, s3, s4].map(evs => next(reduce(evs), ONE, F))

  // Then: ① 派发修复 agent，findings 只含那条 HIGH；② 跑 final；③ final 绿后派全量评审；④ 全量评审无 finding 后落地
  expect(got[0]).toEqual([{ kind: 'dispatch', role: 'fixer', findings: [high] }])
  expect(got[1]).toEqual([{ kind: 'final' }])
  expect(got[2]).toEqual([{ kind: 'dispatch', role: 'reviewer', slice: 'whole', mode: 'whole', commit: 'c-final', prior: [high] }])
  expect(got[3]).toEqual([{ kind: 'land' }])
})

test('core-halts-on-final-red', () => {
  // Given: waves [[S1, S2]] 全部合回且评审无问题；两份账本：
  //   甲：本 attempt 已有 3 条 heal，最新 final ok=false、commit c-final、failed=["G2 lint"]；
  //   乙：没有 heal，最新 final ok=false、commit 为空串、failed=["G2 lint"]
  const base = [
    approve,
    takeoff(1, ONE.waves),
    ...landed(1, 'S1', 'a1'),
    ...landed(1, 'S2', 'a2'),
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [] }),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }),
  ]
  const ledgers = [
    [...base, ...threeHeals(), ev.final(B, { attempt: 1, ok: false, commit: 'c-final', failed: ['G2 lint'] })],
    [...base, ev.final(B, { attempt: 1, ok: false, commit: '', failed: ['G2 lint'] })],
  ]

  // When: 分别求下一批动作
  const got = ledgers.map(evs => next(reduce(evs), ONE, F))

  // Then: 两份都恰为一条停飞动作，haltKind 为 final、原因含 G2 lint（因而没有落地，也没有派整合修复）
  for (const actions of got) {
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'halt', haltKind: 'final' })
    expect(actions[0]?.kind === 'halt' && actions[0].reason.includes('G2 lint')).toBe(true)
  }
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

  // When: 求路由核对的发现
  const blocking = routingFindings(state)

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
  // Given: waves [[S1, S2]] 全部合回；S1 评审为空列表；S2 的评审员 r2 结束未返回，review:S2 记 blocked（infra，评审未返回：r2）；
  //        收口预合并已成功（第一次 final 前必有，DRAFT-flight-premerge-before-final）
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
    premergeOk(1),
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

// scenario 来源：spec flight-fresh-worktrees（flight-measure-followups）

test('plan-change-forces-fresh-dispatch', () => {
  // Given: waves [[S1, S2]]；attempt 1（指纹 F）里 S1 的执行体 a1 门禁绿（base b1）未合回，
  //   S2 的执行体 a2 门禁红（G3 test，base b2）后中断；两份账本分别追加 attempt 2 的 takeoff，指纹为 G 与 F
  const a1 = [
    approve,
    ev.takeoff(B, { attempt: 1, fp: F, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.gate(B, { attempt: 1, agent: 'a1', slice: 'S1', ok: true, commit: 'c-S1', failed: [], base: 'b1' }),
    ended(1, 'a1'),
    dispatch(1, 'S2', 'executor', 'a2'),
    ev.gate(B, { attempt: 1, agent: 'a2', slice: 'S2', ok: false, commit: 'c-S2', failed: ['G3 test'], base: 'b2' }),
  ]
  const ledgers: [FlightEvent[], string][] = [
    [[...a1, ev.takeoff(B, { attempt: 2, fp: G, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' })], G],
    [[...a1, ev.takeoff(B, { attempt: 2, fp: F, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' })], F],
  ]

  // When: 对两份账本各以其 attempt 2 的指纹求一次下一批动作
  const got = ledgers.map(([evs, fp]) => next(reduce(evs), ONE, fp))

  // Then: 指纹 G 时 S1、S2 都是不带续接与 base 的新派发；
  //   指纹 F 时 S1 以 base b1 在 /wt/S1 补跑门禁，S2 带续接说明（上一次飞行中断，G3 test）与 base b2
  expect(got[0]).toEqual([
    { kind: 'dispatch', role: 'executor', slice: 'S1' },
    { kind: 'dispatch', role: 'executor', slice: 'S2' },
  ])
  expect(got[1]).toEqual([
    { kind: 'regate', slice: 'S1', base: 'b1', worktree: '/wt/S1' },
    { kind: 'dispatch', role: 'executor', slice: 'S2', continuation: { reason: '上一次飞行中断', failed: ['G3 test'] }, base: 'b2' },
  ])
})

test('plan-change-forces-fresh-dispatch/old-plan-gate', () => {
  // Given: waves [[S1, S2]]；attempt 1（指纹 F）里 S1 的执行体 a1 门禁绿（base b1）未合回；
  //   attempt 2（指纹 G）重新派发了 S1 的执行体 a2，它在第一次收口前就中断；attempt 3 仍以指纹 G 起飞
  const evs = [
    approve,
    ev.takeoff(B, { attempt: 1, fp: F, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.gate(B, { attempt: 1, agent: 'a1', slice: 'S1', ok: true, commit: 'c-S1', failed: [], base: 'b1' }),
    ended(1, 'a1'),
    ev.takeoff(B, { attempt: 2, fp: G, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
    dispatch(2, 'S1', 'executor', 'a2'),
    ev.takeoff(B, { attempt: 3, fp: G, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
  ]

  // When: 以指纹 G 求 attempt 3 的下一批动作
  const got = next(reduce(evs), ONE, G)

  // Then: S1 不拿旧计划（指纹 F）下的绿门禁补跑：是带续接说明、不带 base 的派发；S2 是新派发
  expect(got).toEqual([
    { kind: 'dispatch', role: 'executor', slice: 'S1', continuation: { reason: '上一次飞行中断', failed: [] } },
    { kind: 'dispatch', role: 'executor', slice: 'S2' },
  ])
})

test('dispatch-records-branch', () => {
  // Given: change demo 的三条 dispatch：a1 带 branch flight/demo/S1-a2；
  //   a3 不带 branch、worktree 为 /m/.claude/worktrees/flight-demo-S3；a4 不带 branch、worktree 为 /wt/S4（推不出）
  const state = reduce([
    approve,
    takeoff(1),
    ev.dispatch(B, { attempt: 1, slice: 'S1', role: 'executor', agent: 'a1', model: OPUS, worktree: '/m/.claude/worktrees/flight-demo-S1', branch: 'flight/demo/S1-a2' }),
    ev.dispatch(B, { attempt: 1, slice: 'S3', role: 'executor', agent: 'a3', model: OPUS, worktree: '/m/.claude/worktrees/flight-demo-S3' }),
    ev.dispatch(B, { attempt: 1, slice: 'S4', role: 'executor', agent: 'a4', model: OPUS, worktree: '/wt/S4' }),
  ])

  // When: 对 a1、a3、a4 分别调用 agentOf 取 branch
  const branches = ['a1', 'a3', 'a4'].map(a => agentOf(state, a)?.branch)

  // Then: 依次为 flight/demo/S1-a2、flight/demo/S3、空串
  expect(branches).toEqual(['flight/demo/S1-a2', 'flight/demo/S3', ''])
})

test('gate-from-other-agent-not-regated', () => {
  // Given: waves [[S1, S2]]；attempt 1（指纹 F）派发 S1 执行体 a1，attempt 2（指纹 F）续派 S1 执行体 a2；
  //   之后才记入 a1 的绿门禁（base b1）；attempt 3 仍以指纹 F 起飞
  const evs = [
    approve,
    ev.takeoff(B, { attempt: 1, fp: F, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.takeoff(B, { attempt: 2, fp: F, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
    dispatch(2, 'S1', 'executor', 'a2'),
    ev.gate(B, { attempt: 1, agent: 'a1', slice: 'S1', ok: true, commit: 'c-S1', failed: [], base: 'b1' }),
    ev.takeoff(B, { attempt: 3, fp: F, branch: 'worktree-demo', waves: ONE.waves, model: 'opus' }),
  ]

  // When: 以指纹 F 求 attempt 3 的下一批动作
  const got = next(reduce(evs), ONE, F)

  // Then: S1 不拿 a1 的绿门禁补跑：是带续接说明（上一次飞行中断，无失败项）、不带 base 的派发；S2 是新派发
  expect(got).toEqual([
    { kind: 'dispatch', role: 'executor', slice: 'S1', continuation: { reason: '上一次飞行中断', failed: [] } },
    { kind: 'dispatch', role: 'executor', slice: 'S2' },
  ])
})

// scenario 来源：spec flight-status-summary（flight-interaction）
test('summary-from-ledger', () => {
  // Given: demo 的账本：attempt 1、waves [[S1, S2], [S3]]；S1 执行体 a1 门禁绿、已合回、评审 r1 给 1 条 HIGH；
  //   S2 执行体 a2 收口门禁红 1 次（G7 x）后仍在执行（无 ended）；S3 未派；没有测量、修复、final 事件
  const high = { severity: 'HIGH' as const, file: 'a.ts', line: 1, summary: 's', fix: 'f' }
  const state = reduce([
    approve,
    takeoff(1),
    ...landed(1, 'S1', 'a1'),
    dispatch(1, 'S1', 'reviewer', 'r1'),
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [high] }),
    dispatch(1, 'S2', 'executor', 'a2'),
    gate(1, 'a2', 'S2', ['G7 x']),
  ])

  // When: 求 summaryLines(summarize(state))
  const lines = summaryLines(summarize(state))

  // Then: 恰为六行：首行 demo · attempt 1 · W1/2 · 在飞；S1 已合回且评审 1 条（CRITICAL/HIGH 1）；
  //   S2 门禁红（1 次）、门禁红 1；S3 在 W2 待派；自愈 0/3（flight-unattended）；末行修复未派、final 未跑
  expect(lines).toEqual([
    '✈ demo · attempt 1 · W1/2 · 在飞',
    'S1 W1 已合回 · 门禁红 0 · 测量 - · 评审 1 条（CRITICAL/HIGH 1）',
    'S2 W1 门禁红（1 次） · 门禁红 1 · 测量 - · 评审 未开始',
    'S3 W2 待派 · 门禁红 0 · 测量 - · 评审 未开始',
    '自愈 0/3',
    '修复 未派 · final 未跑 · 全量评审 未开始',
  ])
})

// scenario 来源：spec flight-whole-review（flight-ship-ledger）
const ONE_S1: Plan = { waves: [['S1']], deps: {} }
const H1 = { severity: 'HIGH' as const, file: 'a.ts', line: 3, summary: 'H1', fix: 'f1' }
const W1 = { severity: 'HIGH' as const, file: 'b.ts', line: 4, summary: 'W1', fix: 'w1' }
const W2 = { severity: 'HIGH' as const, file: 'c.ts', line: 5, summary: 'W2', fix: 'w2' }
const W3 = { severity: 'HIGH' as const, file: 'd.ts', line: 6, summary: 'W3', fix: 'w3' }
const L1 = { severity: 'LOW' as const, file: 'e.ts', line: 7, summary: 'L1', fix: 'l1' }
const finalOk = (commit: string) => ev.final(B, { attempt: 1, ok: true, commit, failed: [] })
const wholeDispatch = (slice: string, agent: string, commit: string) =>
  ev.dispatch(B, { attempt: 1, slice, role: 'reviewer', agent, model: OPUS, worktree: `/wt/${slice}`, commit })
/** 修复轮：修复体派发、收口门禁绿、结束 */
const fixRound = (slice: string, agent: string) => [dispatch(1, slice, 'fixer', agent), gate(1, agent, slice, []), ended(1, agent)]
/** S1 已合回，切片评审 1 条 HIGH H1，fix 已合回；本 attempt final 绿（c9） */
const shipBase = (): FlightEvent[] => [
  approve,
  takeoff(1, ONE_S1.waves),
  ...landed(1, 'S1', 'a1'),
  dispatch(1, 'S1', 'reviewer', 'r1'),
  ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [H1] }),
  ended(1, 'r1'),
  ...fixRound('fix', 'X'),
  merged(1, 'fix'),
  finalOk('c9'),
]

test('whole-review-before-landing', () => {
  // Given: 三份账本：① shipBase（final 绿 c9，未派全量评审）；② ① 加 whole 评审员 w0（commit c9）派发与无 finding 的 review；
  //   ③ ① 只追加 blocked review:whole（infra，评审未返回：w0）
  const s1 = shipBase()
  const s2 = [...s1, wholeDispatch('whole', 'w0', 'c9'), ev.review(B, { attempt: 1, slice: 'whole', agent: 'w0', findings: [] })]
  const s3 = [...s1, ev.blocked(B, { attempt: 1, slice: 'review:whole', kind: 'infra', reason: '评审未返回：w0' })]

  // When: 对三份账本各求一次下一批动作
  const got = [s1, s2, s3].map(evs => next(reduce(evs), ONE_S1, F))

  // Then: ① 恰为派发评审员（slice whole、mode whole、commit c9、prior [H1]）；② 恰为 land；③ 恰为 land
  expect(got[0]).toEqual([{ kind: 'dispatch', role: 'reviewer', slice: 'whole', mode: 'whole', commit: 'c9', prior: [H1] }])
  expect(got[1]).toEqual([{ kind: 'land' }])
  expect(got[2]).toEqual([{ kind: 'land' }])
})

test('fix-rounds-capped-at-two', () => {
  // Given: shipBase 后 whole 评审 w0（commit c9）给 1 条 HIGH W1；依次追加的六个快照：
  //   ① 到此为止；② fix-r1 修复体 X1 门禁绿并结束；③ fix-r1 合回；④ final 绿 c10；
  //   ⑤ whole-r1 评审 w1（commit c10）给 HIGH W2 并结束；⑥ fix-r2 修复体 X2 门禁绿、结束、合回，final 绿 c11，whole-r2 评审 w2（commit c11）给 HIGH W3 并结束
  const s1 = [...shipBase(), wholeDispatch('whole', 'w0', 'c9'), ev.review(B, { attempt: 1, slice: 'whole', agent: 'w0', findings: [W1] }), ended(1, 'w0')]
  const s2 = [...s1, ...fixRound('fix-r1', 'X1')]
  const s3 = [...s2, merged(1, 'fix-r1')]
  const s4 = [...s3, finalOk('c10')]
  const s5 = [...s4, wholeDispatch('whole-r1', 'w1', 'c10'), ev.review(B, { attempt: 1, slice: 'whole-r1', agent: 'w1', findings: [W2] }), ended(1, 'w1')]
  const s6 = [
    ...s5,
    ...fixRound('fix-r2', 'X2'),
    merged(1, 'fix-r2'),
    finalOk('c11'),
    wholeDispatch('whole-r2', 'w2', 'c11'),
    ev.review(B, { attempt: 1, slice: 'whole-r2', agent: 'w2', findings: [W3] }),
    ended(1, 'w2'),
  ]

  // When: 对六个快照各求一次下一批动作
  const got = [s1, s2, s3, s4, s5, s6].map(evs => next(reduce(evs), ONE_S1, F))

  // Then: 依次为派发 fix-r1（findings [W1]）、合回 fix-r1、final、派发 whole-r1（followup、base c9、commit c10、prior [W1]）、
  //   派发 fix-r2（findings [W2]）、land；全程没有派发 slice 为 fix 的修复体
  expect(got[0]).toEqual([{ kind: 'dispatch', role: 'fixer', slice: 'fix-r1', findings: [W1] }])
  expect(got[1]).toEqual([{ kind: 'merge', slice: 'fix-r1', via: 'fix' }])
  expect(got[2]).toEqual([{ kind: 'final' }])
  expect(got[3]).toEqual([{ kind: 'dispatch', role: 'reviewer', slice: 'whole-r1', mode: 'followup', base: 'c9', commit: 'c10', prior: [W1] }])
  expect(got[4]).toEqual([{ kind: 'dispatch', role: 'fixer', slice: 'fix-r2', findings: [W2] }])
  expect(got[5]).toEqual([{ kind: 'land' }])
  expect(got.flat().some(a => a.kind === 'dispatch' && a.role === 'fixer' && (a.slice ?? 'fix') === 'fix')).toBe(false)
})

test('summary-shows-whole-review', () => {
  // Given: 三份账本：① shipBase（final 绿，未派全量评审）；② ① 加 whole 评审员 w0 派发、无 review 无 blocked；
  //   ③ whole 给 W1、fix-r1 合回、final 绿 c10 后，whole-r1 评审 w1 提交 2 条（HIGH W2、LOW L1）
  const s1 = shipBase()
  const s2 = [...s1, wholeDispatch('whole', 'w0', 'c9')]
  const s3 = [
    ...s2,
    ev.review(B, { attempt: 1, slice: 'whole', agent: 'w0', findings: [W1] }),
    ended(1, 'w0'),
    ...fixRound('fix-r1', 'X1'),
    merged(1, 'fix-r1'),
    finalOk('c10'),
    wholeDispatch('whole-r1', 'w1', 'c10'),
    ev.review(B, { attempt: 1, slice: 'whole-r1', agent: 'w1', findings: [W2, L1] }),
  ]

  // When: 分别求 summaryLines(summarize(...)) 的末行
  const tails = [s1, s2, s3].map(evs => summaryLines(summarize(reduce(evs))).at(-1))

  // Then: 依次为「全量评审 未开始」「全量评审 进行中」「全量评审 第 2 轮 2 条（CRITICAL/HIGH 1）」，final 绿；
  //   修复列取本 attempt 最新修复体：①② 为 fix 已合回，③ 为 fix-r1 已合回（design D8，flight-ledger-guards）
  expect(tails).toEqual([
    '修复 已合回 · final 绿 · 全量评审 未开始',
    '修复 已合回 · final 绿 · 全量评审 进行中',
    '修复 第 1 轮 已合回 · final 绿 · 全量评审 第 2 轮 2 条（CRITICAL/HIGH 1）',
  ])
})

// scenario 来源：spec flight-reliability（flight-ledger-guards）
/** S1 已合回、评审员 r1 已结束；withReview 时 r1 提交 1 条 HIGH H1 */
const reviewedS1 = (withReview: boolean): FlightEvent[] => [
  approve,
  takeoff(1, ONE_S1.waves),
  ...landed(1, 'S1', 'a1'),
  dispatch(1, 'S1', 'reviewer', 'r1'),
  ...(withReview ? [ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [H1] })] : []),
  ended(1, 'r1'),
]

test('summary-shows-blocked-review-and-fix', () => {
  // Given: 四份账本，waves [[S1]]、S1 已合回：
  //   甲：评审员 r1 已结束、没有 review，有 blocked review:S1（infra）；
  //   乙：r1 给 1 条 HIGH，修复体 X（slice fix）已派、已结束，有 blocked fix（gate）；
  //   丙：r1 给 1 条 HIGH，修复体 X1（slice fix-r1）已派，未合回也没有 blocked；
  //   丁：r1 给 1 条 HIGH，没有修复体派发，有 blocked fix（infra）
  const ledgers = [
    [...reviewedS1(false), ev.blocked(B, { attempt: 1, slice: 'review:S1', kind: 'infra', reason: '评审未返回：r1' })],
    [...reviewedS1(true), dispatch(1, 'fix', 'fixer', 'X'), ended(1, 'X'), ev.blocked(B, { attempt: 1, slice: 'fix', kind: 'gate', reason: 'G7 x' })],
    [...reviewedS1(true), dispatch(1, 'fix-r1', 'fixer', 'X1')],
    [...reviewedS1(true), ev.blocked(B, { attempt: 1, slice: 'fix', kind: 'infra', reason: '派发失败' })],
  ]

  // When: 分别求 summaryLines(summarize(...))
  const [a, b, c, d] = ledgers.map(evs => summaryLines(summarize(reduce(evs))))

  // Then: 甲的 S1 行含「评审 阻断（infra）」；乙的末行含「修复 阻断（gate）」；
  //   丙的末行含「修复 第 1 轮 进行中」；丁的末行含「修复 阻断（infra）」
  expect(a[1]).toContain('评审 阻断（infra）')
  expect(b.at(-1)).toContain('修复 阻断（gate）')
  expect(c.at(-1)).toContain('修复 第 1 轮 进行中')
  expect(d.at(-1)).toContain('修复 阻断（infra）')
})

test('diag-events-do-not-move-the-plan', () => {
  // Given: 账本 L：计划 PLAN、attempt 1 起飞，S1 执行体 a1 已派未结束；
  //   L2 为 L 末尾追加 ev.diag(attempt 1、where SubagentStop、error aborted、kind timeout、agent a1、budget 10000)
  const L = [approve, takeoff(1), dispatch(1, 'S1', 'executor', 'a1')]
  const diag = ev.diag(B, { attempt: 1, where: 'SubagentStop', error: 'aborted', kind: 'timeout', agent: 'a1', budget: 10000 })
  const L2 = [...L, diag]

  // When: 分别求 L 与 L2 的 next 与 summaryLines(summarize(...))，并构造 attempt 1、ok、commit c、warnings [w] 的 final 事件
  const [n1, n2] = [L, L2].map(evs => next(reduce(evs), PLAN, F))
  const [s1, s2] = [L, L2].map(evs => summaryLines(summarize(reduce(evs))))
  const fin = ev.final(B, { attempt: 1, ok: true, commit: 'c', failed: [], warnings: ['w'] })

  // Then: 两次 next 相同；两次摘要相同；diag 事件 ev 为 diag 且带 where / error / kind / agent / budget；final 事件带 warnings [w]
  expect(n2).toEqual(n1)
  expect(s2).toEqual(s1)
  expect(diag).toMatchObject({ ev: 'diag', attempt: 1, where: 'SubagentStop', error: 'aborted', kind: 'timeout', agent: 'a1', budget: 10000 })
  expect(fin).toMatchObject({ ev: 'final', warnings: ['w'] })
})

// scenario 来源：spec flight-self-heal、flight-integ-fix、flight-halt-handoff（flight-unattended）
const SOLO: Plan = { waves: [['S1']], deps: {} }
const MED = { severity: 'MEDIUM' as const, file: 'm.ts', line: 2, summary: 'M1', fix: 'm1' }
function heal(kind: 'merge-retry' | 'watchdog' | 'integ', slice: string, agent?: string): FlightEvent {
  return ev.heal(B, { attempt: 1, kind, slice, reason: 'r', ...(agent ? { agent } : {}) })
}
/** 本 attempt 已用满预算的 3 条 heal（merge-retry S2、watchdog review:S3、merge-retry S4） */
function threeHeals(): FlightEvent[] {
  return [heal('merge-retry', 'S2'), heal('watchdog', 'review:S3', 'r3'), heal('merge-retry', 'S4')]
}
/** S1 的执行体 a1 收口门禁绿（commit c1）、结束，随后合回失败（非冲突） */
const mergeFailed = (): FlightEvent[] => [
  dispatch(1, 'S1', 'executor', 'a1'),
  ev.gate(B, { attempt: 1, agent: 'a1', slice: 'S1', ok: true, commit: 'c1', failed: [] }),
  ended(1, 'a1'),
  ev.merge(B, { attempt: 1, slice: 'S1', ok: false, commit: '', failed: ['合回对第一父无变更：…'] }),
]
/** waves [[S1, S2]] 全部合回、两片评审都为空列表 */
const allMerged = (): FlightEvent[] => [
  approve,
  takeoff(1, ONE.waves),
  ...landed(1, 'S1', 'a1'),
  ...landed(1, 'S2', 'a2'),
  ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [] }),
  ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }),
]
const FIN_FAILED = ['G2 test: exit 1（新增 3 条失败）\n…']
const finalRed = (commit: string) => ev.final(B, { attempt: 1, ok: false, commit, failed: FIN_FAILED })
/** final 红（c9）→ heal integ → integ 修复体 fi 派发（base c9）；gateOk 时收口门禁绿（c10），否则红；之后 fi 结束 */
const integFixed = (gateOk: boolean): FlightEvent[] => [
  ...allMerged(),
  finalRed('c9'),
  heal('integ', 'integ'),
  ev.dispatch(B, { attempt: 1, slice: 'integ', role: 'fixer', agent: 'fi', model: OPUS, worktree: '/wt/integ', base: 'c9' }),
  ev.gate(B, { attempt: 1, agent: 'fi', slice: 'integ', ok: gateOk, commit: 'c10', failed: gateOk ? [] : ['G9 integ: tests/test_a.py'] }),
  ended(1, 'fi'),
]
/** integFixed(true) 后派出 integ 评审员 ri 并交回 findings */
const integReviewed = (findings: (typeof H1 | typeof MED)[]): FlightEvent[] => [
  ...integFixed(true),
  ev.dispatch(B, { attempt: 1, slice: 'integ', role: 'reviewer', agent: 'ri', model: OPUS, worktree: '/wt/integ', base: 'c9', commit: 'c10' }),
  ev.review(B, { attempt: 1, slice: 'integ', agent: 'ri', findings }),
  ended(1, 'ri'),
]
/** integ 已合回（复核无阻断）之后 final 再红（c11） */
const integMergedThenRed = (): FlightEvent[] => [
  ...integReviewed([MED]),
  ev.merge(B, { attempt: 1, slice: 'integ', ok: true, commit: 'm-integ', failed: [] }),
  finalRed('c11'),
]

test('merge-failure-retried-once', () => {
  // Given: waves [[S1]]；四个账本快照：
  //   ① a1 收口绿（c1）后合回失败（合回对第一父无变更），没有 heal；② ① 加 heal merge-retry S1；
  //   ③ ② 加执行体 a2 派发、a2 收口门禁绿（c2）与 ended；④ ③ 再加一条 S1 的失败合回（非冲突）
  const s1 = [approve, takeoff(1, SOLO.waves), ...mergeFailed()]
  const s2 = [...s1, heal('merge-retry', 'S1')]
  const s3 = [...s2, dispatch(1, 'S1', 'executor', 'a2'), ev.gate(B, { attempt: 1, agent: 'a2', slice: 'S1', ok: true, commit: 'c2', failed: [] }), ended(1, 'a2')]
  const s4 = [...s3, ev.merge(B, { attempt: 1, slice: 'S1', ok: false, commit: '', failed: ['合回对第一父无变更：…'] })]

  // When: 对四个快照各求一次下一批动作
  const got = [s1, s2, s3, s4].map(evs => next(reduce(evs), SOLO, F))

  // Then: ① 恰为 heal merge-retry S1；② 恰为不带 continuation 的 S1 执行体派发；③ 恰为 merge S1 via branch；
  //   ④ 恰为 blocked S1（infra），原因含「合回失败」，不再 heal
  expect(got[0]).toHaveLength(1)
  expect(got[0]?.[0]).toMatchObject({ kind: 'heal', heal: 'merge-retry', slice: 'S1' })
  expect(got[1]).toEqual([{ kind: 'dispatch', role: 'executor', slice: 'S1' }])
  expect(got[2]).toEqual([{ kind: 'merge', slice: 'S1', via: 'branch' }])
  expect(got[3]).toHaveLength(1)
  expect(got[3]?.[0]).toMatchObject({ kind: 'blocked', slice: 'S1', blockKind: 'infra' })
  expect(got[3]?.[0]?.kind === 'blocked' && got[3][0].reason.includes('合回失败')).toBe(true)
})

test('heal-budget-caps', () => {
  // Given: 甲：waves [[S1]]，本 attempt 已有 3 条 heal（merge-retry S2、watchdog review:S3、merge-retry S4），S1 合回失败（非冲突）；
  //   乙：waves [[S1, S2]] 全部合回且评审无阻断，已有同样 3 条 heal，最新 final 红（commit c9，G2 test: exit 1（新增 1 条失败））
  const a = reduce([approve, takeoff(1, SOLO.waves), ...threeHeals(), ...mergeFailed()])
  const b = reduce([...allMerged(), ...threeHeals(), ev.final(B, { attempt: 1, ok: false, commit: 'c9', failed: ['G2 test: exit 1（新增 1 条失败）'] })])

  // When: 分别求甲、乙的下一批动作，并对甲求 healVerdict(merge-retry, S1)
  const [na, nb, verdict] = [next(a, SOLO, F), next(b, ONE, F), core.healVerdict(a, 'merge-retry', 'S1')] as const

  // Then: 甲恰为 blocked S1（infra），原因含「合回失败」与「自愈预算已用尽」；
  //   乙恰为停飞，haltKind 为 final，原因含「final 未通过」与「自愈预算已用尽」；healVerdict 为 ok false、reason 含「自愈预算已用尽（3/3）」
  const reasonOf = (x: unknown) => String((x as { reason?: unknown } | undefined)?.reason ?? '')
  expect(na).toHaveLength(1)
  expect(na[0]).toMatchObject({ kind: 'blocked', slice: 'S1', blockKind: 'infra' })
  expect(['合回失败', '自愈预算已用尽'].every(w => reasonOf(na[0]).includes(w))).toBe(true)
  expect(nb).toHaveLength(1)
  expect(nb[0]).toMatchObject({ kind: 'halt', haltKind: 'final' })
  expect(['final 未通过', '自愈预算已用尽'].every(w => reasonOf(nb[0]).includes(w))).toBe(true)
  expect(verdict.ok).toBe(false)
  expect(reasonOf(verdict)).toContain('自愈预算已用尽（3/3）')
})

test('heal-budget-caps-within-one-batch', () => {
  // Given: waves [[S1, S2]]，本 attempt 已有 2 条 heal（watchdog review:S3、merge-retry S4），S1、S2 的执行体都收口绿后合回失败（非冲突）
  const failed = (s: string, agent: string): FlightEvent[] => [
    dispatch(1, s, 'executor', agent),
    ev.gate(B, { attempt: 1, agent, slice: s, ok: true, commit: `c-${s}`, failed: [] }),
    ended(1, agent),
    ev.merge(B, { attempt: 1, slice: s, ok: false, commit: '', failed: ['合回对第一父无变更：…'] }),
  ]
  const state = reduce([approve, takeoff(1, ONE.waves), heal('watchdog', 'review:S3', 'r3'), heal('merge-retry', 'S4'), ...failed('S1', 'a1'), ...failed('S2', 'a2')])

  // When: 求下一批动作
  const actions = next(state, ONE, F)

  // Then: 恰好只有 1 条 heal，本 attempt 合计不超过预算 3
  expect(actions.filter(a => a.kind === 'heal')).toHaveLength(1)
})

test('watchdog-heal-redispatches-once', () => {
  // Given: waves [[S1, S2]] 全部合回；四份账本：
  //   甲：S2 评审为空列表，S1 评审员 r1 已结束、没有 review，有 heal {watchdog, review:S1, agent r1}；
  //   乙：同甲但没有那条 heal；
  //   丙：S1 评审为空、S2 评审 1 条 HIGH H1，修复体 fx（slice fix）已结束、没有收口门禁，有 heal {watchdog, fix, agent fx}；
  //   丁：甲之后又派了 S1 评审员 r2，r2 也已结束、没有 review
  const merged2 = [approve, takeoff(1, ONE.waves), ...landed(1, 'S1', 'a1'), ...landed(1, 'S2', 'a2')]
  const noHeal = [...merged2, ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }), dispatch(1, 'S1', 'reviewer', 'r1'), ended(1, 'r1')]
  const a = [...noHeal, heal('watchdog', 'review:S1', 'r1')]
  const c = [
    ...merged2,
    ev.review(B, { attempt: 1, slice: 'S1', agent: 'r1', findings: [] }),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [H1] }),
    dispatch(1, 'fix', 'fixer', 'fx'),
    ended(1, 'fx'),
    heal('watchdog', 'fix', 'fx'),
  ]
  const d = [...a, dispatch(1, 'S1', 'reviewer', 'r2'), ended(1, 'r2')]

  // When: 分别求四份账本的下一批动作
  const [ga, gb, gc, gd] = [a, noHeal, c, d].map(evs => next(reduce(evs), ONE, F))

  // Then: 甲恰为派发 S1 评审员（commit m-S1，与 r1 同范围）；乙恰为 blocked review:S1（infra，评审未返回：r1）；
  //   丙恰为派发修复体（slice 为 fix，findings 为 [H1]）；丁恰为 blocked review:S1（infra，评审未返回：r2）
  expect(ga).toEqual([{ kind: 'dispatch', role: 'reviewer', slice: 'S1', commit: 'm-S1' }])
  expect(gb).toEqual([{ kind: 'blocked', slice: 'review:S1', blockKind: 'infra', reason: '评审未返回：r1' }])
  expect(gc).toHaveLength(1)
  expect(gc[0]?.kind === 'dispatch' && gc[0].role === 'fixer' && (gc[0].slice ?? 'fix') === 'fix' && JSON.stringify(gc[0].findings) === JSON.stringify([H1])).toBe(true)
  expect(gd).toEqual([{ kind: 'blocked', slice: 'review:S1', blockKind: 'infra', reason: '评审未返回：r2' }])
})

test('summary-shows-heals', () => {
  // Given: 两份 attempt 1 的账本（waves [[S1]]）：甲有 heal merge-retry S9 与 heal watchdog review:S2（agent r2）；乙没有 heal
  const a = [approve, takeoff(1, SOLO.waves), heal('merge-retry', 'S9'), heal('watchdog', 'review:S2', 'r2')]
  const b = [approve, takeoff(1, SOLO.waves)]

  // When: 分别求 summaryLines(summarize(...))
  const [la, lb] = [a, b].map(evs => summaryLines(summarize(reduce(evs))))

  // Then: 甲有一行同时含「自愈 2/3」「merge-retry S9」「watchdog review:S2」；乙有一行含「自愈 0/3」
  expect(la?.some(l => ['自愈 2/3', 'merge-retry S9', 'watchdog review:S2'].every(w => l.includes(w)))).toBe(true)
  expect(lb?.some(l => l.includes('自愈 0/3'))).toBe(true)
})

test('final-red-dispatches-integ', () => {
  // Given: waves [[S1, S2]] 全部合回、评审无阻断；三份账本：
  //   ① 最新 final 红（commit c9，failed G2 test 新增 3 条失败），没有 heal；② ① 加 heal integ integ；③ 同 ① 但 final 的 commit 为空串
  const s1 = [...allMerged(), finalRed('c9')]
  const s2 = [...s1, heal('integ', 'integ')]
  const s3 = [...allMerged(), finalRed('')]

  // When: 分别求下一批动作
  const [g1, g2, g3] = [s1, s2, s3].map(evs => next(reduce(evs), ONE, F))

  // Then: ① 恰为 heal integ（slice integ）；② 恰为派发修复体（slice integ、findings 空、failed 等于 final 的 failed）；③ 恰为停飞，haltKind 为 final
  expect(g1).toHaveLength(1)
  expect(g1?.[0]).toMatchObject({ kind: 'heal', heal: 'integ', slice: 'integ' })
  expect(g2).toEqual([{ kind: 'dispatch', role: 'fixer', slice: 'integ', findings: [], failed: FIN_FAILED }])
  expect(g3).toHaveLength(1)
  expect(g3?.[0]).toMatchObject({ kind: 'halt', haltKind: 'final' })
})

test('integ-reviewed-before-merge', () => {
  // Given: 三份账本：① integ 修复体 fi（base c9）收口门禁绿（c10）并结束；
  //   ② ① 加 integ 评审员 ri 的派发、只含一条 MEDIUM 的 review(integ) 与 ri 结束；③ ② 加 merge integ ok
  const s1 = integFixed(true)
  const s2 = integReviewed([MED])
  const s3 = [...s2, ev.merge(B, { attempt: 1, slice: 'integ', ok: true, commit: 'm-integ', failed: [] })]

  // When: 分别求下一批动作
  const got = [s1, s2, s3].map(evs => next(reduce(evs), ONE, F))

  // Then: ① 恰为派发评审员（slice integ、mode integ、base c9、commit c10）；② 恰为 merge integ via fix（因而没有 fix 修复体）；③ 恰为 final
  expect(got[0]).toEqual([{ kind: 'dispatch', role: 'reviewer', slice: 'integ', mode: 'integ', base: 'c9', commit: 'c10' }])
  expect(got[1]).toEqual([{ kind: 'merge', slice: 'integ', via: 'fix' }])
  expect(got[2]).toEqual([{ kind: 'final' }])
})

test('integ-failures-halt', () => {
  // Given: 三份账本：甲：review(integ) 有 1 条 HIGH H1；乙：fi 收口门禁红后结束，有 blocked {integ, gate}；丙：integ 已合回，其后 final 红（c11）
  const a = integReviewed([H1])
  const b = [...integFixed(false), ev.blocked(B, { attempt: 1, slice: 'integ', kind: 'gate', reason: 'G9 integ: tests/test_a.py' })]
  const c = integMergedThenRed()

  // When: 分别求下一批动作
  const [ga, gb, gc] = [a, b, c].map(evs => next(reduce(evs), ONE, F))

  // Then: 甲恰为停飞（haltKind integ），原因含「整合修复复核未通过」；乙恰为停飞（haltKind integ）；
  //   丙恰为停飞（haltKind final），因而没有 heal 与派发
  expect(ga).toHaveLength(1)
  expect(ga?.[0]).toMatchObject({ kind: 'halt', haltKind: 'integ' })
  expect(ga?.[0]?.kind === 'halt' && ga[0].reason.includes('整合修复复核未通过')).toBe(true)
  expect(gb).toHaveLength(1)
  expect(gb?.[0]).toMatchObject({ kind: 'halt', haltKind: 'integ' })
  expect(gc).toHaveLength(1)
  expect(gc?.[0]).toMatchObject({ kind: 'halt', haltKind: 'final' })
})

test('halts-carry-kind', () => {
  // Given: 甲：waves [[S1, S2]]，S1 已 blocked（gate，G7 x），S2 已合回且评审为空；乙：takeoff 指纹 F，当前计划指纹 G；
  //   丙：integ 已合回，其后 final 红（c11）
  const a = [
    approve,
    takeoff(1, ONE.waves),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G7 x' }),
    ...landed(1, 'S2', 'a2'),
    ev.review(B, { attempt: 1, slice: 'S2', agent: 'r2', findings: [] }),
  ]
  const b = [approve, takeoff(1)]
  const c = integMergedThenRed()

  // When: 甲、丙以指纹 F、乙以指纹 G 求下一批动作，并构造 ev.halt(attempt 1、reason x、kind watchdog)
  const [ga, gb, gc, built] = [next(reduce(a), ONE, F), next(reduce(b), PLAN, G), next(reduce(c), ONE, F), ev.halt(B, { attempt: 1, reason: 'x', kind: 'watchdog' })] as const

  // Then: 三份各恰为一个 halt 动作，haltKind 依次为 blocked、fingerprint、final；构造出的事件 ev 为 halt、kind 为 watchdog
  expect([ga, gb, gc].map(g => g.length)).toEqual([1, 1, 1])
  expect([ga, gb, gc].map(g => (g[0]?.kind === 'halt' ? g[0].haltKind : undefined))).toEqual(['blocked', 'fingerprint', 'final'])
  expect(built).toMatchObject({ ev: 'halt', kind: 'watchdog' })
})

// design D6：计划缺陷的纯判定（S4 续飞拒绝、S5 批准带使用）
const G5_PASSED = 'G5 measure: tests/test_s1.py::test_s1 在改生产代码之前就已通过\n第二行细节'

test('plan-defect-from-g5-passed-before-code', () => {
  // Given: attempt 1 里 S1 记 blocked（gate），reason 为「G5 measure: tests/test_s1.py::test_s1 在改生产代码之前就已通过」加第二行，随后 kind blocked 的 halt
  const state = reduce([
    takeoff(1, [['S1']]),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: G5_PASSED }),
    ev.halt(B, { attempt: 1, reason: '切片 blocked：S1', kind: 'blocked' }),
  ])

  // When: 求 planDefect
  const got = core.planDefect(state)

  // Then: 返回该 blocked 原因的首行
  expect(got).toBe('G5 measure: tests/test_s1.py::test_s1 在改生产代码之前就已通过')
})

test('plan-defect-undefined-for-other-halts', () => {
  // Given: 三份账本——甲：同上的 blocked 但 halt 的 kind 为 final；乙：blocked 原因为「G7 demo#s1」、halt kind blocked；
  //        丙：attempt 1 有同上的 blocked 与 halt（kind blocked），之后 attempt 2 起飞、尚未停飞
  const g5 = ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: G5_PASSED })
  const states = [
    [takeoff(1, [['S1']]), g5, ev.halt(B, { attempt: 1, reason: 'final 未通过', kind: 'final' })],
    [takeoff(1, [['S1']]), ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G7 demo#s1' }), ev.halt(B, { attempt: 1, reason: '切片 blocked', kind: 'blocked' })],
    [takeoff(1, [['S1']]), g5, ev.halt(B, { attempt: 1, reason: '切片 blocked', kind: 'blocked' }), takeoff(2, [['S1']])],
  ].map(evs => reduce(evs))

  // When: 对三份账本各求 planDefect
  const got = states.map(s => core.planDefect(s))

  // Then: 三份都是 undefined
  expect(got).toEqual([undefined, undefined, undefined])
})

// flight-replan-handoff 护栏（规划时预写，base 上已成立）：结论不是「改计划」、属于旧 attempt、或已被后一条诊断改判的，都不是计划缺陷
test('plan-defect-ignores-other-triage', () => {
  // Given: 三份账本——甲：attempt 1 的 S1 blocked（G1 verify: exit 1）、kind blocked 的 halt，再有 triage「…\n修插件」；
  //        乙：attempt 1 同上但 triage 结论为「改计划」，之后 attempt 2 起飞、尚未停飞；
  //        丙：attempt 1 有 halt，先后两条 triage，前一条结论「改计划」、后一条结论「人工操作」
  const g1 = ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G1 verify: exit 1' })
  const halt = ev.halt(B, { attempt: 1, reason: '切片 blocked：S1', kind: 'blocked' })
  const triage = (agent: string, verdict: string) => ev.triage(B, { attempt: 1, agent, text: `S1 的 owns 漏了 tests/test_x.py\n${verdict}\n草案` })
  const states = [
    [takeoff(1, [['S1']]), g1, halt, triage('d1', '修插件')],
    [takeoff(1, [['S1']]), g1, halt, triage('d1', '改计划'), takeoff(2, [['S1']])],
    [takeoff(1, [['S1']]), g1, halt, triage('d1', '改计划'), triage('d2', '人工操作')],
  ].map(evs => reduce(evs))

  // When: 对三份账本各求 planDefect
  const got = states.map(s => core.planDefect(s))

  // Then: 三份都是 undefined
  expect(got).toEqual([undefined, undefined, undefined])
})

test('triage-verdict-parsed', () => {
  // Given: 七段 triage 文本：甲「根因\n改计划\n草案」、乙「根因\n**改计划**」、丙「根因\n「修插件」」、丁「根因\n\n  人工操作  」、
  //        戊「根因\n建议改计划」、己「只有一行」、庚「根因\n改计划。」
  const texts = ['根因\n改计划\n草案', '根因\n**改计划**', '根因\n「修插件」', '根因\n\n  人工操作  ', '根因\n建议改计划', '只有一行', '根因\n改计划。']

  // When: 逐段调用 triageVerdict 读出处置类别
  const got = texts.map(t => core.triageVerdict(t))

  // Then: 依次为 改计划、改计划、修插件、人工操作、undefined、undefined、undefined
  expect(got).toEqual(['改计划', '改计划', '修插件', '人工操作', undefined, undefined, undefined])
})

test('plan-defect-from-triage-replan', () => {
  // Given: attempt 1 里 S1 记 blocked（gate，原因「G1 verify: exit 1」），随后 kind blocked 的 halt，
  //        再有一条 triage，文本为「S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py」
  const state = reduce([
    takeoff(1, [['S1']]),
    dispatch(1, 'S1', 'executor', 'a1'),
    ev.blocked(B, { attempt: 1, slice: 'S1', kind: 'gate', reason: 'G1 verify: exit 1' }),
    ev.halt(B, { attempt: 1, reason: '切片 blocked：S1', kind: 'blocked' }),
    ev.triage(B, { attempt: 1, agent: 'd1', text: 'S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py' }),
  ])

  // When: 求 planDefect
  const got = core.planDefect(state)

  // Then: 结果为该 triage 的首行「S1 的 owns 漏了 tests/test_x.py」
  expect(got).toBe('S1 的 owns 漏了 tests/test_x.py')
})
