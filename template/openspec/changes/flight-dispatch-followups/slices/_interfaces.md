# 片间接口（flight-dispatch-followups）

三片在同一 wave 并行，owns 互不相交，彼此不依赖对方的新接口。

## 三片都要知道
- **派发只在处理外部事件、尚未返回的 hook 里发生**（`DRAFT-flight-dispatch-live-frame`）：
  - 定时器回调没有活凭证，派发会被拒；
  - 不要在锁释放处、定时器回调里直接重试起飞，要重试就走唤醒轮。
- **测试世界模拟不出 origin，也模拟不出撞锁的微小窗口**：能用纯函数测的就放进纯函数（`armed.ts`）。

## S1

### template/plugins/flight/hooks/orchestrator.tsx
```
export async function scenarioFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean; lease?: Lease } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean; lease?: Lease }): Promise<string> {
export function restoreStatusNow(): Promise<void> {
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
export function afterMissedTurn(arm: Arm): Arm {
export function refusedAgain(arm: Arm, text: string): Arm {
export function nextStep(arm: Arm, event: ArmEvent, now: number): ArmStep {
export function modelPrompt(arm: Arm): string {
export const WAKE_FOOTER = '这一轮只回复「收到」，不要做别的，也不要发 /opsx-apply。'
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

## S2

### template/plugins/flight/hooks/register.tsx
```
export const register: Register = on => {
```

## S3
