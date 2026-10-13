# 跨切片契约（flight-armed-followups）

W1 = S1 ∥ S2 ∥ S3；W2 = S4（依赖 S2）∥ S5（依赖 S2）。

**插件通则**（违反会导致 validate 失败或测试假红）：
- **`$` 不出文件**：`$` 只能传给同一文件里声明的函数；要跨文件，就传在本文件 hook 里造好的闭包。
- **测试与插件是隔离实例**：测试 import 插件模块，拿到的是另一份模块状态；模块变量（锁、进行中表、`entry`）只能经插件 hook 的效果观察。
- **`Button` 没有禁用属性**（CLI 2.1.296）：「不可按」的做法是不渲染按钮，只显示文字。
- **提交时刻要在调用 submit 之前取**：实测，插件提交的那一轮，开始时刻（结束时的 `clock.now` 减 `durationMs`）比 `prompt.submit` 完成早 7–20 ms。

## S2

### template/plugins/flight/hooks/orchestrator.tsx
```
export async function scenarioFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean }): Promise<string> {
export function registerOrchestrator(on: On): void {
```

### template/plugins/flight/types/index.d.ts
```
export type FlightItem = {
export type FlightArmedItem = {
export type FlightArmed = { items: Record<string, FlightArmedItem> }
export type FlightBand = {
export type FlightPanel = {
```

## S1

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
export function armedLine(arm: Arm, now: number): string {
export function giveUpText(arm: Arm, why: string): string {
export function humanText(change: string, text: string, cls: 'human' | 'human-key'): string {
```

### template/plugins/flight/hooks/land.ts
```
export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录
export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
export function classifyDirty(paths: readonly string[], x: { changeDir: string; scenarioFiles: readonly string[] }): { records: string[]; artifacts: string[]; others: string[] } {
export async function commitArtifacts(io: Io, f: Flight, paths: readonly string[]): Promise<string | undefined> {
export async function mergeSlice(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[], branch = `flight/${f.change}/${slice}`):
export async function prepareResolve(io: Io, f: Flight, slice: string, x: { branch?: string; attempt?: number } = {}):
export async function finishResolve(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[], resolve = { path: resolvePath(f, slice), branch: resolveBranch(f, slice) }):
export async function mergeFix(io: Io, f: Flight, _note: string, branch?: string, slice = 'fix'): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
export function validateFindings(input: unknown): { ok: true; findings: Finding[] } | { ok: false; error: string } {
export async function closeout(io: Io, f: Flight, merged: readonly string[]): Promise<{ verdict: 'ready' | 'draft'; reasons: string }> {
export async function renderRecords(io: Io, f: Flight): Promise<string | undefined> {
```

## S4

### template/plugins/flight/hooks/orchestrator.tsx
```
export async function scenarioFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean }): Promise<string> {
export function registerOrchestrator(on: On): void {
```

## S5

### template/plugins/flight/hooks/register.tsx
```
export const register: Register = on => {
```

## S3
