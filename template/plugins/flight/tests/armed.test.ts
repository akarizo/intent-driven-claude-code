// scenario 来源：spec flight-armed-takeoff#refusals-classified / armed-budget-and-expiry / armed-decides-next-step。armed.ts 是纯模块，直接调用。
import { expect, test } from 'claude-code/testing'

import { ARM_BUDGET, ARM_TTL_MS, TRANSIENT_DELAY_MS, afterMissedTurn, beforeRetry, classifyRefusal, giveUpText, nextStep, refusedAgain } from '../hooks/armed'
import type { Arm, ArmEvent } from '../hooks/armed'

const NOW = 1_000_000_000
const MIN = 60_000

function arm(over: Partial<Arm>): Arm {
  return {
    change: 'demo',
    args: ['demo'],
    resume: false,
    cls: 'human',
    reason: 'flight：一句认不出的话',
    since: NOW - MIN,
    tries: 0,
    awaitingModel: false,
    awaitingWake: false,
    transientAgain: false,
    missedTurn: false,
    ...over,
  }
}

test('refusals-classified', () => {
  // Given: 11 条起飞回复：基线仍在跑、agent 仍在运行、起飞异常、git status 失败（「不起飞：」紧跟换行）、lint 红、基线中断、未批准、账本损坏、工件未提交、跨会话、认不出的话
  const texts = [
    'flight：slice-gate preflight 未通过：基线仍在跑（已 1 分钟，上次全量约 2 分钟）：等它结束再起飞',
    'flight：demo 上一次飞行派出的 agent 仍在运行（attempt 2），等它们结束再起飞',
    'flight：起飞异常，不起飞（flight: $.process.run(python3) aborted）',
    'flight：工作区不干净，不起飞：\nfatal: Unable to create index.lock',
    'flight：slice-gate lint 未通过：overlap: 同一 wave 的 S1 与 S2 都覆盖 a.ts',
    'flight：slice-gate preflight 未通过：基线中断（进程 123 已不在）：重跑 slice-gate.py baseline',
    'flight：起飞守卫未通过：takeoff-gate: 未批准：账本里没有这个 change 的批准记录。',
    'flight：起飞守卫未通过：takeoff-gate: 账本损坏：abcd1234 坏事件。',
    'flight：工作区不干净，不起飞：未提交的只有本 change 的工件（2 个）。',
    'flight：demo 的 attempt 2 由另一个会话（abcd1234）起飞，尚未落地或停飞',
    '一句认不出的话',
  ]

  // When: 逐个调用 classifyRefusal
  const got = texts.map(t => classifyRefusal(t))

  // Then: 依次为 wait-baseline、wait-agents、transient、transient、model、model、human-key、human、human-key、human、human
  expect(got).toEqual([
    'wait-baseline', 'wait-agents', 'transient', 'transient', 'model', 'model',
    'human-key', 'human', 'human-key', 'human', 'human',
  ])
})

test('armed-budget-and-expiry', () => {
  // Given: 甲 model 类 tries=3 待命 1 分钟；乙 wait-baseline 类 tries=5 待命 10 分钟；丙 wait-baseline 类待命 31 分钟；丁 transient 类 tries=1 且 transientAgain=true
  const cases: [Arm, ArmEvent][] = [
    [arm({ cls: 'model', reason: 'flight：slice-gate lint 未通过：overlap', tries: ARM_BUDGET }), { kind: 'refused' }],
    [arm({ cls: 'wait-baseline', reason: 'flight：slice-gate preflight 未通过：基线仍在跑', tries: 5, since: NOW - 10 * MIN }), { kind: 'tick' }],
    [arm({ cls: 'wait-baseline', reason: 'flight：slice-gate preflight 未通过：基线仍在跑', since: NOW - 31 * MIN }), { kind: 'tick' }],
    [arm({ cls: 'transient', reason: 'flight：起飞异常，不起飞（aborted）', tries: 1, transientAgain: true }), { kind: 'refused' }],
  ]

  // When: 甲、丁遇 refused，乙、丙遇 tick，分别求 nextStep
  const got = cases.map(([a, e]) => nextStep(a, e, NOW))

  // Then: 甲 give-up 且原因含「重试已用尽」；乙 wake（定时到点只唤醒，不过期、不计预算）；丙 give-up 且原因含「已过期」；丁 give-up；ARM_TTL_MS 为 30 分钟
  expect(got.map(s => s.do)).toEqual(['give-up', 'wake', 'give-up', 'give-up'])
  expect(got[0].do === 'give-up' ? got[0].reason : '').toContain('重试已用尽')
  expect(got[2].do === 'give-up' ? got[2].reason : '').toContain('已过期')
  expect(ARM_TTL_MS).toBe(30 * MIN)
})

test('armed-decides-next-step', () => {
  // Given: wait-agents、transient、model 三类待命各一个，tries=0；model 的拒绝原文为「flight：slice-gate lint 未通过：overlap …」，另有一份 awaitingModel=true 的同一 model 待命
  const agents = arm({ cls: 'wait-agents', reason: 'flight：demo 上一次飞行派出的 agent 仍在运行（attempt 2），等它们结束再起飞' })
  const transient = arm({ cls: 'transient', reason: 'flight：起飞异常，不起飞（aborted）' })
  const model = arm({ cls: 'model', reason: 'flight：slice-gate lint 未通过：overlap: 同一 wave 的 S1 与 S2 都覆盖 a.ts' })
  const cases: [Arm, ArmEvent][] = [
    [agents, { kind: 'agent-ended' }],
    [transient, { kind: 'refused' }],
    [transient, { kind: 'timer' }],
    [model, { kind: 'refused' }],
    [{ ...model, awaitingModel: true }, { kind: 'main-turn' }],
    [model, { kind: 'tick' }],
  ]

  // When: 逐个求 nextStep
  const got = cases.map(([a, e]) => nextStep(a, e, NOW))

  // Then: 依次为 retry、wait(10000)、wake（timer 到点只唤醒）、submit、retry、wait（不带 ms）；submit 正文含拒绝原文与三段边界文字
  expect(got.map(s => (s.do === 'submit' || s.do === 'wake' ? { do: s.do } : s))).toEqual([
    { do: 'retry' }, { do: 'wait', ms: TRANSIENT_DELAY_MS }, { do: 'wake' }, { do: 'submit' }, { do: 'retry' }, { do: 'wait' },
  ])
  const text = got[3].do === 'submit' ? got[3].text : ''
  expect(['slice-gate lint 未通过：overlap', '只修工作区与本 change 工件', '改了计划需要人在批准带重新批准', '不要发 /opsx-apply'].filter(s => !text.includes(s))).toEqual([])
})

// scenario 来源：spec flight-armed-takeoff#relaunch-keeps-args
test('relaunch-keeps-args', () => {
  // Given: resume 类待命 args 为 [demo, --takeover]；非 resume 待命 args 为 [demo, 授权提交]；放弃原因都是「待命已过期」
  const arms = [arm({ resume: true, args: ['demo', '--takeover'] }), arm({ resume: false, args: ['demo', '授权提交'] })]

  // When: 逐个生成 giveUpText
  const texts = arms.map(a => giveUpText(a, '待命已过期'))

  // Then: 前者的做法是 /flight resume demo --takeover；后者的做法是 /opsx-apply demo 授权提交
  expect(texts[0].endsWith('做法：处理上面的原因后重新发 /flight resume demo --takeover')).toBe(true)
  expect(texts[1].endsWith('做法：处理上面的原因后重新发 /opsx-apply demo 授权提交')).toBe(true)
})

// 补覆盖（PR #54 LOW，非 scenario）：重试记账
test('retry-bookkeeping/before-retry', () => {
  // Given: 四个 tries=1、awaitingModel=true 的待命，类分别为 transient、model、wait-agents、wait-baseline
  const arms = (['transient', 'model', 'wait-agents', 'wait-baseline'] as const).map(cls => arm({ cls, tries: 1, awaitingModel: true }))

  // When: 逐个调用 beforeRetry
  const got = arms.map(beforeRetry)

  // Then: tries 依次为 2、2、1、1；awaitingModel 全为 false
  expect(got.map(a => a.tries)).toEqual([2, 2, 1, 1])
  expect(got.map(a => a.awaitingModel)).toEqual([false, false, false, false])
})

test('retry-bookkeeping/refused-again', () => {
  // Given: 旧类与新拒绝原文的四种组合：transient→起飞异常、transient→lint 未通过、model→起飞异常、wait-agents→起飞异常
  const transientText = 'flight：起飞异常，不起飞（boom）'
  const modelText = 'flight：slice-gate lint 未通过：overlap'
  const cases: [Arm, string][] = [
    [arm({ cls: 'transient' }), transientText],
    [arm({ cls: 'transient' }), modelText],
    [arm({ cls: 'model' }), transientText],
    [arm({ cls: 'wait-agents' }), transientText],
  ]

  // When: 逐个调用 refusedAgain
  const got = cases.map(([a, t]) => refusedAgain(a, t))

  // Then: transientAgain 只有第一种为 true；新类依次为 transient、model、transient、transient
  expect(got.map(a => a.transientAgain)).toEqual([true, false, false, false])
  expect(got.map(a => a.cls)).toEqual(['transient', 'model', 'transient', 'transient'])
})

// scenario 来源：spec flight-wake-turn#timer-steps-never-retry
test('timer-steps-never-retry', () => {
  // Given: wait-baseline、wait-agents、transient 三类未唤醒的 demo 待命各一个；另有一个 awaitingWake=true 的 wait-baseline 待命
  const baseline = arm({ cls: 'wait-baseline', reason: 'flight：slice-gate preflight 未通过：基线仍在跑' })
  const agents = arm({ cls: 'wait-agents', reason: 'flight：demo 上一次飞行派出的 agent 仍在运行（attempt 2），等它们结束再起飞' })
  const transient = arm({ cls: 'transient', reason: 'flight：起飞异常，不起飞（aborted）' })
  const woken = arm({ cls: 'wait-baseline', reason: 'flight：slice-gate preflight 未通过：基线仍在跑', awaitingWake: true })
  const cases: [Arm, ArmEvent][] = [
    [baseline, { kind: 'tick' }],
    [agents, { kind: 'tick' }],
    [transient, { kind: 'timer' }],
    [woken, { kind: 'tick' }],
    [woken, { kind: 'main-turn' }],
  ]

  // When: 前三个依次遇 tick、tick、timer，第四个分别遇 tick 与 main-turn，逐个求 nextStep；再对第四个调用 beforeRetry
  const got = cases.map(([a, e]) => nextStep(a, e, NOW))
  const tried = beforeRetry(woken)

  // Then: 前三个都给出 wake，正文含 demo 与「只回复「收到」」；第四个遇 tick 给 wait、遇 main-turn 给 retry；beforeRetry 之后 awaitingWake 为 false
  expect(got.map(s => s.do)).toEqual(['wake', 'wake', 'wake', 'wait', 'retry'])
  const texts = got.slice(0, 3).map(s => (s.do === 'wake' ? s.text : ''))
  expect(texts.filter(t => !t.includes('demo') || !t.includes('只回复「收到」'))).toEqual([])
  expect(tried.awaitingWake).toBe(false)
})

// scenario 来源：spec flight-dispatch-hardening#missed-turn-rewakes-on-tick
test('missed-turn-rewakes-on-tick', () => {
  // Given: demo 的 wait-baseline 待命已唤醒（awaitingWake=true）；e2 的 model 待命已提交交模型（awaitingModel=true）；两者都未错过一轮
  const woken = arm({ cls: 'wait-baseline', reason: 'flight：slice-gate preflight 未通过：基线仍在跑', awaitingWake: true })
  const submitted = arm({ change: 'e2', args: ['e2'], cls: 'model', reason: 'flight：slice-gate lint 未通过：overlap', awaitingModel: true })

  // When: 对两者分别 afterMissedTurn，各遇一次 tick；补发唤醒后（awaitingWake=true）的 demo 再遇一次 tick；对它调用 beforeRetry
  const missed = [woken, submitted].map(a => afterMissedTurn(a))
  const steps = missed.map(a => nextStep(a, { kind: 'tick' }, NOW))
  const rewoken = { ...missed[0], awaitingWake: true }
  const again = nextStep(rewoken, { kind: 'tick' }, NOW)
  const tried = beforeRetry(rewoken)

  // Then: afterMissedTurn 之后两者的已唤醒、已提交为假、错过一轮为真；各遇 tick 都给 wake，正文含各自 change 名与「只回复「收到」」；
  //       补发后再遇 tick 给 wait；beforeRetry 之后错过一轮为假
  expect(missed.map(a => [a.awaitingWake, a.awaitingModel, a.missedTurn])).toEqual([[false, false, true], [false, false, true]])
  expect(steps.map((s, i) => s.do === 'wake' && s.text.includes(missed[i].change) && s.text.includes('只回复「收到」'))).toEqual([true, true])
  expect(again.do).toBe('wait')
  expect(tried.missedTurn).toBe(false)
})
