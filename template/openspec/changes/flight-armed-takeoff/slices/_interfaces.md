# 跨切片契约（flight-armed-takeoff）

W1 = S1 ∥ S2 ∥ S3；W2 = S4 ∥ S5 ∥ S6。同 wave 的片只经下面写定的签名耦合。

**插件通则（违反即 validate 失败或测试假红）**：
- `$` 不出文件。`$` 只能传给同一文件里声明的函数；要跨文件，传闭包（在本文件的 hook 里造）。
- 测试与插件是隔离实例。测试 import 插件模块拿到的是另一份模块状态，所以模块变量（如 `takeoffNow` 的闭包）只能经插件 hook 的效果观察。
- 每插件一个 hooks 模块（`register.tsx`）。同一事件的后续 hook 要带 matcher。实测：`turn.complete` 上不带 matcher、`{ agentId: /./ }`、`{ turnId: /./ }` 三个 hook 可以共存，第三个能看到主会话轮次（agentId 为空）。

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

## S3

### template/plugins/flight/hooks/orchestrator.tsx
```
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

## S4

### template/plugins/flight/hooks/orchestrator.tsx
```
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean }): Promise<string> {
export function registerOrchestrator(on: On): void {
```

## S5

### template/plugins/flight/hooks/register.tsx
```
export const register: Register = on => {
```

### template/plugins/flight/hooks/io.ts
```
export type Tree = { path: string; branch: string }
export async function trees(io: Io, cwd: string): Promise<Tree[]> {
export async function judgesDir(io: Io, mainTree: string): Promise<string> {
export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
export async function stoppedNow(io: Io, f: Flight): Promise<'halt' | 'land' | 'unreadable' | undefined> {
export const EVENT_TYPES: readonly string[] = Object.keys(EVENTS)
export function eventProblem(event: FlightEvent, change: string): string | undefined {
export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
export const active: Map<string, ActiveTree> = new Map()
export const terminals: Map<string, number> = new Map()
export type Owner = { change: string; role: Role; slice: string; worktree: string }
export const owners: Map<string, Owner> = new Map()
export function markPending(agentId: string, change: string): void {
export function resetOwnership(): void {
export type Unknown = { unknown: true; change: string; error: string }
export async function ownership(io: Io, agentId: string): Promise<Owner | { pending: true; change: string } | Unknown | undefined> {
export async function ownerOf(io: Io, agentId: string): Promise<Owner | undefined> {
export function worktreePath(f: Flight, name: string): string {
export async function ensureWorktree(io: Io, f: Flight, name: string): Promise<{ path: string; created: boolean } | { error: string }> {
export async function occupied(io: Io, f: Flight, name: string): Promise<string | undefined> {
export async function freshWorktree(io: Io, f: Flight, name: string, attempt: number): Promise<{ path: string; branch: string } | { error: string }> {
export function agentType(role: Role): string {
export const flights: Map<string, Flight> = new Map()
export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
```

## S2

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

## S6
