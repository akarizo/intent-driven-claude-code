# 跨切片契约（flight-armed-takeoff）

W1 = S1 ∥ S2 ∥ S3；W2 = S4 ∥ S5 ∥ S6。同 wave 的片只经下面写定的签名耦合。

**插件通则（违反即 validate 失败或测试假红）**：
- `$` 不出文件。`$` 只能传给同一文件里声明的函数；要跨文件，传闭包（在本文件的 hook 里造）。
- 测试与插件是隔离实例。测试 import 插件模块拿到的是另一份模块状态，所以模块变量（如 `takeoffNow` 的闭包）只能经插件 hook 的效果观察。
- 每插件一个 hooks 模块（`register.tsx`）。同一事件的后续 hook 要带 matcher。实测：`turn.complete` 上不带 matcher、`{ agentId: /./ }`、`{ turnId: /./ }` 三个 hook 可以共存，第三个能看到主会话轮次（agentId 为空）。

## S1 · `template/plugins/flight/hooks/armed.ts`（纯模块，不 import 运行时值、不碰 `$`）

```ts
export type ArmClass = 'wait-baseline' | 'wait-agents' | 'transient' | 'model' | 'human-key' | 'human'
export const ARM_BUDGET = 3
export const ARM_TTL_MS = 1800000
export const TRANSIENT_DELAY_MS = 10000

/** 一次待命；存进会话状态 flight.armed.items[change]（字段与 types 的 FlightArmedItem 一一对应） */
export type Arm = {
  change: string
  args: string[]          // 起飞参数原样（含「授权提交」等）
  resume: boolean         // 来自 /flight resume 或续飞按钮
  cls: ArmClass
  reason: string          // 最近一次拒绝的原文
  since: number           // 首次被拒的时刻（毫秒）
  tries: number           // 已计入预算的自动重试次数
  awaitingModel: boolean  // 已提交「交模型」的一轮、尚未结束
  transientAgain: boolean // 上一次自动重试的结果也是 transient
}
export type ArmEvent = { kind: 'refused' } | { kind: 'agent-ended' } | { kind: 'main-turn' } | { kind: 'tick' } | { kind: 'timer' }
export type ArmStep =
  | { do: 'retry' }
  | { do: 'submit'; text: string }
  | { do: 'wait'; ms?: number }       // ms 给出时由调用方起 clock.after(ms)，到点产生 timer
  | { do: 'give-up'; reason: string }

export function classifyRefusal(text: string): ArmClass
/** 首次被拒：cls = classifyRefusal(text)，reason = text，since = now，tries 0，两个布尔为假 */
export function armOf(x: { change: string; args: string[]; resume: boolean; text: string; now: number }): Arm
/** 执行 retry 之前调用：transient / model 类 tries + 1；awaitingModel 置假 */
export function beforeRetry(arm: Arm): Arm
/** 自动重试后又被拒：cls / reason 换成新的；transientAgain = 旧 cls 与新 cls 都是 transient */
export function refusedAgain(arm: Arm, text: string): Arm
export function nextStep(arm: Arm, event: ArmEvent, now: number): ArmStep
/** 交模型那一轮的正文：拒绝原文 + 「只修工作区与本 change 工件」「改了计划需要人在批准带重新批准」「不要发 /opsx-apply」 */
export function modelPrompt(arm: Arm): string
/** 状态行：「flight · 起飞待命 <change> · <原因首行>（重试 n/3，剩 m 分钟）」 */
export function armedLine(arm: Arm, now: number): string
/** 放弃待命的通知正文：含 change、why 与做法 */
export function giveUpText(arm: Arm, why: string): string
/** 不进入待命（human / human-key）时的通知正文：原因首行 + 做法（human-key：「在批准带按『批准起飞』或『起飞』」；跨会话：提到 --takeover） */
export function humanText(change: string, text: string, cls: 'human' | 'human-key'): string
```

「原因首行」指去掉开头 `flight：` 之后的第一行。

## S3 · `orchestrator.tsx` 与 `types/index.d.ts`

```ts
/** 批准带等其他文件起飞用：不收 $。entry 由本文件带 matcher 的 session.start hook 设好；未设时回复「flight：插件尚未就绪，稍后再按」 */
export function takeoffNow(args: string[], opts?: { resume?: boolean }): Promise<string>
```
- S3：`entry = (args, opts) => takeoff($, args, opts)`。
- S4：把 `entry` 换成「起飞 + 被拒即待命」的包装，签名不变。

`types/index.d.ts`（S3 改，S4 / S5 用）：
```ts
export type FlightItem = { …; mode: 'approve' | 'takeoff' | 'replan' | 'resume' }   // 新增 'takeoff'
export type FlightArmedItem = {
  change: string; args: string[]; resume: boolean; cls: string; reason: string
  since: number; tries: number; awaitingModel: boolean; transientAgain: boolean
}
export type FlightArmed = { items: Record<string, FlightArmedItem> }
// PluginState.flight 增加 armed: FlightArmed
```

## S4 · `orchestrator.tsx`

- `atom({ plugin: 'flight', key: 'armed' } as const, { items: {} } as FlightArmed)`。
- `/opsx-apply`、`/flight resume`、`takeoffNow` 都经同一个「起飞 + 被拒即待命」包装。
- 推进事件：
  - 看门狗计时器 tick；
  - 已有的 `turn.complete { agentId: /./ }`（agent 结束）；
  - 新增 `turn.complete { turnId: /./ }`（只处理 agentId 为空的主会话轮次）；
  - `clock.after`。
- `$.prompt.submit` 只在 `clock.after(0, …)` 的回调里调用，不在 `command.run` 里调用。
- `/flight abort <change>`：待命中则清除并回复「已取消起飞待命」。
- 偶发失败：`appendEvent(…, ev.diag(b, { attempt, where: 'takeoff', error }))`。账本读不出时跳过；attempt 取账本当前 attempt，没有起飞过时为 0。

## S5 · `register.tsx` 与 `io.ts`

- `import { takeoffNow } from './orchestrator'`，任何时候都不把 `$` 传出本文件。
- `resumeFlight` 的依赖：`takeoff: (args, opts) => takeoffNow(args, opts)`（opts 为 `{ resume: true }`）。
- 按键 key：`approve:` / `takeoff:` / `replan:` / `resume:` + `<change>:<fp>`。
- `io.ts` 的 `stoppedNow`：同一 attempt 同时有 land 与 halt 时返回 `land`。其它调用方只判 `!== undefined`，不受影响。

## S2 · `land.ts`

- `commitArtifacts(io, f, paths)` 签名不变；行为见 spec `flight-takeoff-commit`。

## S6

- 只改文档与 `plugin.json`。行为以 spec 为准，不 import 任何代码。
