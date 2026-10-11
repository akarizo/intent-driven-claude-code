# 公开接口摘要

## S1

### template/plugins/flight/hooks/envelope.ts
```
export type Who = { role: Role; worktree: string; owns: readonly string[] }
export type ActiveTree = { change: string; changeTree: string; slicePrefix: string }
export type Deny = { deny: string }
export function normalizePath(p: string): string {
export function globMatch(path: string, pattern: string): boolean {
export function writeTarget(tool: string, input: unknown): string | undefined {
export function writeVerdict(who: Who, absPath: string): Deny | undefined {
export function inWorktree(command: string, worktree: string): string {
export function bashVerdict(role: Role, command: string, worktree?: string, _mainTree?: string): Deny | undefined {
export function bashUpgradable(role: Role, command: string, commands: readonly string[], worktree?: string, mainTree?: string): boolean {
export function readUpgradable(tool: string, input: unknown, worktree: string, mainTree: string): boolean {
export function mainSessionVerdict(active: readonly ActiveTree[], tool: string, input: unknown): Deny | undefined {
export function spawnVerdict(x: { subagentType: string; originPlugin: string | undefined; model: string | undefined; parentInFlight: boolean }): Deny | undefined {
```

## S2

### template/plugins/flight/hooks/core.ts
```
export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver'
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type Finding = { severity: Severity; file: string; line: number; summary: string; fix: string }
export type GateJson = { slice: string; ok: boolean; commit: string; failed: string[]; warnings?: string[]; ceilings?: unknown[]; base?: string; summary?: string }
export type FlightEvent = { v: 1; ev: string; change: string; at: string; by: { plugin: 'flight'; session: string }; [k: string]: unknown }
export type Plan = { waves: string[][]; deps: Record<string, string[]> }
export type Flight = { change: string; mainTree: string; changeTree: string; changeDir: string; branch: string; hooksDir: string; model: string; session: string }
export type RunResult = { exitCode: number; stdout: string; stderr: string }
export interface Io {
export type Found = { flight: Flight; events: FlightEvent[] }
export interface Ctx {
export type Action =
export type State = { readonly events: readonly Ev[]; readonly attempt: number; readonly takeoff: Ev | undefined }
export function reduce(events: readonly FlightEvent[]): State {
export function currentAttempt(state: State): number {
export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number; branch: string; base?: string } | undefined {
export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
export function next(state: State, plan: Plan, fpNow: string): Action[] {
export function routingFindings(state: State): Finding[] {
export function closeoutLists(state: State): {
export const ev: {
```
