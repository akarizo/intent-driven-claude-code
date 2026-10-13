// scenario 来源：spec flight-armed-takeoff#refusals-classified / armed-budget-and-expiry / armed-decides-next-step。armed.ts 是纯模块，直接调用。
import { expect, test } from 'claude-code/testing'

import { ARM_BUDGET, ARM_TTL_MS, TRANSIENT_DELAY_MS, classifyRefusal, nextStep } from '../hooks/armed'
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
    transientAgain: false,
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

  // Then: 甲 give-up 且原因含「重试已用尽」；乙 retry；丙 give-up 且原因含「已过期」；丁 give-up；ARM_TTL_MS 为 30 分钟
  expect(got.map(s => s.do)).toEqual(['give-up', 'retry', 'give-up', 'give-up'])
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

  // Then: 依次为 retry、wait(10000)、retry、submit、retry、wait（不带 ms）；submit 正文含拒绝原文与三段边界文字
  expect(got.map(s => (s.do === 'submit' ? { do: 'submit' } : s))).toEqual([
    { do: 'retry' }, { do: 'wait', ms: TRANSIENT_DELAY_MS }, { do: 'retry' }, { do: 'submit' }, { do: 'retry' }, { do: 'wait' },
  ])
  const text = got[3].do === 'submit' ? got[3].text : ''
  expect(['slice-gate lint 未通过：overlap', '只修工作区与本 change 工件', '改了计划需要人在批准带重新批准', '不要发 /opsx-apply'].filter(s => !text.includes(s))).toEqual([])
})
