// 起飞待命的纯判定（design D1、D3、D5）：拒绝分类、预算与过期、按事件推进。不 import 运行时值、不读时钟。

export type ArmClass = 'wait-baseline' | 'wait-agents' | 'transient' | 'model' | 'human-key' | 'human'
export const ARM_BUDGET = 3
export const ARM_TTL_MS = 1800000
export const TRANSIENT_DELAY_MS = 10000

/** 一次待命；存进会话状态 flight.armed.items[change]（字段与 types 的 FlightArmedItem 一一对应） */
export type Arm = {
  change: string
  args: string[]
  resume: boolean
  cls: ArmClass
  reason: string
  since: number
  tries: number
  awaitingModel: boolean
  /** 已提交唤醒、尚未重试（design D1）：定时到点只唤醒，重试在主会话那一轮结束时做 */
  awaitingWake: boolean
  transientAgain: boolean
  /** 唤醒或交模型那一轮撞锁被错过：下一次 tick / 计时到点补发唤醒（design D3） */
  missedTurn: boolean
  /** 提交唤醒 / 交模型之前的时刻 T0：只认开始时刻不早于它的那一轮；缺失时按旧行为 */
  submittedAt?: number
}
export type ArmEvent = { kind: 'refused' } | { kind: 'agent-ended' } | { kind: 'main-turn' } | { kind: 'tick' } | { kind: 'timer' }
export type ArmStep =
  | { do: 'retry' }
  | { do: 'submit'; text: string }
  | { do: 'wake'; text: string }
  | { do: 'wait'; ms?: number }
  | { do: 'give-up'; reason: string }

const PREFIX = 'flight：'
const TRANSIENT_HEADS = ['起飞异常', '账本读取失败', '提交遗留飞行记录失败', '计算计划指纹失败', '写 takeoff 事件失败']
const MODEL_HEADS = ['提交工件失败', 'slice-gate lint 未通过', 'slice-gate preflight 未通过']

function body(text: string): string {
  return text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text
}

/** 原因首行：去掉开头「flight：」之后的第一行 */
function head(text: string): string {
  return body(text).split('\n')[0]
}

/** 按 spec 字样表自上而下取第一条命中；认不出的归 human（只会通知人，不会误重试） */
export function classifyRefusal(text: string): ArmClass {
  const b = body(text)
  if (b.startsWith('slice-gate preflight 未通过') && b.includes('基线仍在跑')) return 'wait-baseline'
  if (b.includes('上一次飞行派出的 agent 仍在运行')) return 'wait-agents'
  // git status 本身失败：「不起飞：」紧跟换行；有别于「未提交的只有本 change 的工件」与「（工件之外的未提交改动）」
  if (TRANSIENT_HEADS.some(h => b.startsWith(h)) || b.startsWith('工作区不干净，不起飞：\n')) return 'transient'
  if (MODEL_HEADS.some(h => b.startsWith(h))) return 'model'
  if (b.includes('未提交的只有本 change 的工件')) return 'human-key'
  if (b.startsWith('起飞守卫未通过') && (b.includes('未批准') || b.includes('计划已变'))) return 'human-key'
  return 'human'
}

export function armOf(x: { change: string; args: string[]; resume: boolean; text: string; now: number }): Arm {
  return {
    change: x.change,
    args: x.args,
    resume: x.resume,
    cls: classifyRefusal(x.text),
    reason: x.text,
    since: x.now,
    tries: 0,
    awaitingModel: false,
    awaitingWake: false,
    transientAgain: false,
    missedTurn: false,
  }
}

function counted(cls: ArmClass): boolean {
  return cls === 'transient' || cls === 'model'
}

export function beforeRetry(arm: Arm): Arm {
  return { ...arm, tries: counted(arm.cls) ? arm.tries + 1 : arm.tries, awaitingModel: false, awaitingWake: false, missedTurn: false }
}

/** 等的那一轮（唤醒 / 交模型）撞锁被错过：清掉已唤醒、已提交，记下错过一轮；不在等那一轮时原样返回 */
export function afterMissedTurn(arm: Arm): Arm {
  if (!arm.awaitingWake && !arm.awaitingModel) return arm
  return { ...arm, awaitingWake: false, awaitingModel: false, missedTurn: true }
}

export function refusedAgain(arm: Arm, text: string): Arm {
  const cls = classifyRefusal(text)
  return { ...arm, cls, reason: text, transientAgain: arm.cls === 'transient' && cls === 'transient' }
}

export function nextStep(arm: Arm, event: ArmEvent, now: number): ArmStep {
  const why = head(arm.reason)
  if (now - arm.since > ARM_TTL_MS) return { do: 'give-up', reason: `待命已过期（超过 ${ARM_TTL_MS / 60000} 分钟）：${why}` }
  if (arm.cls === 'human' || arm.cls === 'human-key') return { do: 'give-up', reason: why }
  if (event.kind === 'refused' && counted(arm.cls) && arm.tries >= ARM_BUDGET) {
    return { do: 'give-up', reason: `重试已用尽（${arm.tries}/${ARM_BUDGET}）：${why}` }
  }
  if (event.kind === 'refused' && arm.cls === 'transient' && arm.transientAgain) {
    return { do: 'give-up', reason: `偶发失败重试一次后仍失败：${why}` }
  }
  // 已提交唤醒：那一轮结束才重试（定时器回调里起飞会绕过包络与 measure，design D1）
  if (event.kind === 'main-turn' && arm.awaitingWake) return { do: 'retry' }
  const wake: ArmStep = arm.awaitingWake ? { do: 'wait' } : { do: 'wake', text: wakePrompt(arm) }
  // 错过的那一轮：任何类别都在下一次 tick / 计时到点补发唤醒（交模型也一样，不再重复提交修复请求）
  if ((event.kind === 'tick' || event.kind === 'timer') && arm.missedTurn) return wake
  switch (arm.cls) {
    case 'wait-baseline':
      if (event.kind === 'tick') return wake
      break
    case 'wait-agents':
      if (event.kind === 'agent-ended') return { do: 'retry' }
      if (event.kind === 'tick') return wake
      break
    case 'transient':
      if (event.kind === 'refused') return { do: 'wait', ms: TRANSIENT_DELAY_MS }
      if (event.kind === 'timer') return wake
      break
    case 'model':
      if (event.kind === 'refused') return { do: 'submit', text: modelPrompt(arm) }
      if (event.kind === 'main-turn' && arm.awaitingModel) return { do: 'retry' }
      break
  }
  return { do: 'wait' }
}

export function modelPrompt(arm: Arm): string {
  return [
    `flight：${arm.change} 起飞被拒，请修复后结束这一轮：`,
    arm.reason,
    '',
    '边界：只修工作区与本 change 工件；改了计划需要人在批准带重新批准；不要发 /opsx-apply。',
    '插件会在这一轮结束后自动重试起飞。',
  ].join('\n')
}

/** 唤醒正文的第二行：起飞待命与看门狗诊断的唤醒共用 */
export const WAKE_FOOTER = '这一轮只回复「收到」，不要做别的，也不要发 /opsx-apply。'

/** 定时到点的唤醒文本：让主会话跑一轮，插件在那一轮结束时重试起飞 */
export function wakePrompt(arm: Arm): string {
  return [`flight：${arm.change} 起飞待命到点（${head(arm.reason)}），插件将在这一轮结束后重试起飞。`, WAKE_FOOTER].join('\n')
}

export function armedLine(arm: Arm, now: number): string {
  const left = Math.max(0, Math.ceil((arm.since + ARM_TTL_MS - now) / 60000))
  return `flight · 起飞待命 ${arm.change} · ${head(arm.reason)}（重试 ${arm.tries}/${ARM_BUDGET}，剩 ${left} 分钟）`
}

function relaunch(arm: Arm): string {
  if (arm.resume) return ['/flight resume', arm.change, ...arm.args.filter(a => a !== arm.change)].join(' ')
  return `/opsx-apply ${arm.args.length ? arm.args.join(' ') : arm.change}`
}

export function giveUpText(arm: Arm, why: string): string {
  return `flight：放弃 ${arm.change} 的起飞待命：${why}\n做法：处理上面的原因后重新发 ${relaunch(arm)}`
}

export function humanText(change: string, text: string, cls: 'human' | 'human-key'): string {
  const how = cls === 'human-key' ? '在批准带按『批准起飞』或『起飞』' : '按上面的原因处理后重新起飞'
  return `flight：${change} 未起飞：${head(text)}\n做法：${how}`
}
