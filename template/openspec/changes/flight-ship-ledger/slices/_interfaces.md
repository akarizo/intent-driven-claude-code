# 公开接口摘要

## 约定（规划时写定；wave 1 四片并行，各自按这里对接，不得改动）

### Action（S2 产出，S3 消费；`template/plugins/flight/hooks/core.ts`）
```ts
| { kind: 'dispatch'; role: 'reviewer'; slice: string; commit: string; mode?: 'whole' | 'followup'; base?: string; prior?: Finding[] }
| { kind: 'dispatch'; role: 'fixer'; slice?: string; findings: Finding[] }   // slice 缺省为 'fix'
| { kind: 'merge'; slice: string; via: 'branch' | 'resolve' | 'fix' }       // 修复轮：slice 为 'fix-r<k>'、via 'fix'
```
- 全量评审：`{ role: 'reviewer', slice: 'whole', mode: 'whole', commit: <最新 final 的 commit>, prior: <切片评审的 CRITICAL/HIGH> }`，不带 base（由 S3 派发时计算）。
- 复核：`{ role: 'reviewer', slice: 'whole-r<k>', mode: 'followup', base: <上一轮评审员 dispatch 的 commit>, commit: <最新 final 的 commit>, prior: <上一轮 review 的 CRITICAL/HIGH> }`。
- 切片评审：照旧，不带 mode / base / prior。
- slice id：全量评审 `whole`、`whole-r1`、`whole-r2`；修复轮 `fix-r1`、`fix-r2`；切片级修复仍为 `fix`。

### dispatch 事件（S3 写入，S1 与 S2 读取）
评审员的 dispatch 事件，在 mode 为 whole 或 followup 时额外带 `commit`（这一轮审到的 commit）与 `base`。`ev.dispatch` 的参数类型增加可选的 `commit?: string`（S2）。

### `slice-gate.py ship` 的 JSON（S1 产出，S3 与 S4 消费）
```json
{"ready": false, "commit": "<HEAD 全长>", "reasons": ["…"],
 "blocked": [{"slice": "S1", "kind": "gate", "reason": "…"}],
 "blocking": [{"severity": "HIGH", "file": "a.ts", "line": 3, "summary": "…", "fix": "…"}],
 "deferred": [{"severity": "LOW", "file": "…", "line": 1, "summary": "…", "fix": "…"}],
 "fix": {"ok": true, "commit": "…"},
 "review": {"slice": "whole-r1", "agent": "r9", "commit": "…"}}
```
- 退出码：0 为 ready，1 为 draft。
- `fix` 与 `review` 可以为 null。
- `--markdown` 照旧只打印 reasons 与 blocked 段落。

### `mergeFix`（S3 产出，S5 接线；`template/plugins/flight/hooks/land.ts`）
```ts
export async function mergeFix(io: Io, f: Flight, note: string, branch?: string, slice = 'fix'): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }>
```
- 合并的分支缺省为 `flight/${f.change}/${slice}`，提交信息为 `integrate: ${slice}`。

### `closeout`（S3；`land.ts`）
```ts
export async function closeout(io: Io, f: Flight, merged: readonly string[]): Promise<{ verdict: 'ready' | 'draft'; reasons: string }>
```
- 不再接收 lists。之后 `core.ts` 的 `closeoutLists` 不再有调用方，由 S5 删除。

### `ship.ts`（S4 产出，S5 接线；`template/plugins/flight/hooks/ship.ts`）
```ts
export const SHIP_TOOL: { name: 'ship'; description: string; inputSchema: Record<string, unknown> }
export type ShipJson = { ready: boolean; commit: string; reasons: string[]; blocked: { slice: string; kind: string; reason: string }[]; blocking: Finding[]; deferred: Finding[]; fix: { ok: boolean; commit: string } | null; review: { slice: string; agent: string; commit: string } | null }
export function shipComment(j: ShipJson, x: { date: string }): string
export async function shipPr(ctx: Ctx, f: Flight, state: State, pr: string): Promise<{ result: string } | { deny: string }>
```
- `SHIP_TOOL.inputSchema`：`{ type: 'object', properties: { change: { type: 'string' }, pr: { type: 'string' } }, required: ['change', 'pr'] }`。

### 事件字段表
`io.ts`（S4）与 `ledger.py`（S1）都增加 `ship: { attempt: 正整数, pr: 非空字符串, verdict: 'ready' | 'draft', commit: 字符串 }`。

### 判定器能力
`slice-gate.py features` 增加 `ship-ledger`（S1）；插件的 `REQUIRED_FEATURES` 增加 `ship-ledger`（S5）。

## S4

### template/plugins/flight/hooks/ship.ts
```
export const SHIP_TOOL = {
export type ShipJson = {
export function shipComment(j: ShipJson, x: { date: string }): string {
export async function shipPr(ctx: Ctx, f: Flight, state: State, pr: string): Promise<{ result: string } | { deny: string }> {
```

### template/plugins/flight/hooks/io.ts
```
export type Tree = { path: string; branch: string }
export async function trees(io: Io, cwd: string): Promise<Tree[]> {
export async function judgesDir(io: Io, mainTree: string): Promise<string> {
export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
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
