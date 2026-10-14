# 片间接口（flight-dispatch-origin）

wave 1 = S1 + S4；wave 2 = S3（依赖 S1）；wave 3 = S2（依赖 S1、S3）。`orchestrator.tsx` 依次由 S1、S3、S2 改，三片串行。

## 背景（三片都要知道）
- **规则**：插件只有在「处理外部事件、尚未返回的 hook」的 await 链里派发 agent，这个 agent 的工具调用才经过插件的 `tool.call` / `tool.check` hook。
  - 在定时器回调里派发会绕过它们，而且不报错；
  - 在已返回的 hook 的后续里派发也一样。
  - 详见 design.md 的 Context。
- **测试世界模拟不出 origin**：单测只能断言结构，比如按键返回前已起飞、定时器回调只提交唤醒不派发、没有活凭证就拒绝。

## S1

### template/plugins/flight/hooks/orchestrator.tsx
```
export async function scenarioFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean }): Promise<string> {
export function registerOrchestrator(on: On): void {
```

### template/plugins/flight/hooks/armed.ts
```
export type ArmClass = 'wait-baseline' | 'wait-agents' | 'transient' | 'model' | 'human-key' | 'human'
export const ARM_BUDGET = 3
export const ARM_TTL_MS = 1800000
export const TRANSIENT_DELAY_MS = 10000
export type Arm = {
export type ArmEvent = { kind: 'refused' } | { kind: 'agent-ended' } | { kind: 'main-turn' } | { kind: 'tick' } | { kind: 'timer' }
export type ArmStep =
export function classifyRefusal(text: string): ArmClass {
export function armOf(x: { change: string; args: string[]; resume: boolean; text: string; now: number }): Arm {
export function beforeRetry(arm: Arm): Arm {
export function refusedAgain(arm: Arm, text: string): Arm {
export function nextStep(arm: Arm, event: ArmEvent, now: number): ArmStep {
export function modelPrompt(arm: Arm): string {
export function wakePrompt(arm: Arm): string {
export function armedLine(arm: Arm, now: number): string {
export function giveUpText(arm: Arm, why: string): string {
export function humanText(change: string, text: string, cls: 'human' | 'human-key'): string {
```

### template/plugins/flight/types/index.d.ts
```
export type FlightItem = {
export type FlightArmedItem = {
export type FlightArmed = { items: Record<string, FlightArmedItem> }
export type FlightBand = {
export type FlightPanel = {
```

## S3 交出（`lease.ts` 新建、`orchestrator.tsx` 两处、`register.tsx`）
- `template/plugins/flight/hooks/lease.ts`（纯模块，不 import 运行时值，不含 `$`）：
  ```ts
  /** 活帧凭证：只在处理外部事件的 hook 里经 withLease 取得；hook 返回（或抛错）即失效（design D4） */
  export type Lease = { readonly alive: boolean }
  export const LEASE_DENY = 'flight：派发须在处理外部事件的 hook 里（定时器或已返回的回调不能派发）'
  export async function withLease<T>(body: (lease: Lease) => Promise<T>): Promise<T>
  export function leaseDeny(lease: Lease | undefined): string | undefined   // 缺失或失效 → LEASE_DENY
  ```
- orchestrator：
  - `export function takeoffNow(args: string[], opts?: { resume?: boolean; lease?: Lease }): Promise<string>`：`lease` 原样传给 `takeoffArmed` 的 opts。本片只透传，不使用；
  - `export function restoreStatusNow(): Promise<void>`：session.start 里与 `entry` 一起造的无 `$` 闭包，内部调 `restoreStatus($)`。插件未就绪时直接 resolve。
- register：`ui.press` 整体包在 `withLease` 里，起飞经 `takeoffNow(args, { lease })`，续飞经 `depsOf($, item, lease)` 把凭证带给 `takeoffNow`。

## S2 交出（`lease.ts` 增补、`orchestrator.tsx`）
- `export async function guardedSpawn<T>(lease: Lease | undefined, spawn: () => Promise<T>): Promise<T | { deny: string }>`：`leaseDeny` 有值时返回 `{ deny }`，不调用 spawn。
- `ctxOf($, lease?: Lease)`：`spawn` 经 `guardedSpawn`。
- 凭证在下面这些 hook 入口用 `withLease` 取得，沿 `takeoffArmed → runStep → takeoffSafe → takeoff → drive → driveNow → ctxOf` 传下去：
  - `command.run`（`/opsx-apply`、`/flight`）；
  - 子 agent 的 `turn.complete`；
  - 主会话的 `turn.complete`。

## S4
