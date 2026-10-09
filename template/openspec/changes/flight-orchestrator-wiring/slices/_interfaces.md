# 公开接口摘要

## S1 land.ts (template/plugins/flight/hooks/)
```
template/plugins/flight/hooks/land.ts:5:export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录
template/plugins/flight/hooks/land.ts:21:export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
template/plugins/flight/hooks/land.ts:96:export async function mergeSlice(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]):
template/plugins/flight/hooks/land.ts:107:export async function prepareResolve(io: Io, f: Flight, slice: string): Promise<{ path: string; conflicts: string[] } | { error: string }> {
template/plugins/flight/hooks/land.ts:122:export async function finishResolve(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]): Promise<{ ok: true; commit: string } | { ok: false; failed: string
template/plugins/flight/hooks/land.ts:135:export async function mergeFix(io: Io, f: Flight, note: string): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
template/plugins/flight/hooks/land.ts:145:export function validateFindings(input: unknown): { ok: true; findings: Finding[] } | { ok: false; error: string } {
template/plugins/flight/hooks/land.ts:164:export async function closeout(io: Io, f: Flight, lists: { blocked: { slice: string; kind: 'gate' | 'infra'; reason: string }[]; blocking: Finding[]; deferred: Finding[]; fix: { 
template/plugins/flight/hooks/prompts.ts:13:export function executorPrompt(x: {
template/plugins/flight/hooks/prompts.ts:36:export function reviewerPrompt(x: { change: string; changeDir: string; slice: string; commit: string }): string {
template/plugins/flight/hooks/prompts.ts:46:export function resolverPrompt(x: { change: string; changeDir: string; slice: string; conflicts: string[] }): string {
template/plugins/flight/hooks/prompts.ts:58:export function fixerPrompt(x: { change: string; changeDir: string; findings: Finding[] }): string {
template/plugins/flight/hooks/orchestrator.tsx:300:export function registerOrchestrator(on: On): void {
template/plugins/flight/hooks/register.tsx:208:export const register: Register = on => {
template/plugins/flight/hooks/core.ts:4:export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver'
template/plugins/flight/hooks/core.ts:5:export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
template/plugins/flight/hooks/core.ts:6:export type Finding = { severity: Severity; file: string; line: number; summary: string; fix: string }
template/plugins/flight/hooks/core.ts:8:export type GateJson = { slice: string; ok: boolean; commit: string; failed: string[]; warnings?: string[]; ceilings?: unknown[]; base?: string; summary?: string }
template/plugins/flight/hooks/core.ts:10:export type FlightEvent = { v: 1; ev: string; change: string; at: string; by: { plugin: 'flight'; session: string }; [k: string]: unknown }
template/plugins/flight/hooks/core.ts:11:export type Plan = { waves: string[][]; deps: Record<string, string[]> }
template/plugins/flight/hooks/core.ts:13:export type Flight = { change: string; mainTree: string; changeTree: string; changeDir: string; branch: string; hooksDir: string; model: string; session: string }
template/plugins/flight/hooks/core.ts:14:export type RunResult = { exitCode: number; stdout: string; stderr: string }
template/plugins/flight/hooks/core.ts:16:export interface Io {
template/plugins/flight/hooks/core.ts:22:export type Action =
template/plugins/flight/hooks/core.ts:36:export type State = { readonly events: readonly Ev[]; readonly attempt: number; readonly takeoff: Ev | undefined }
template/plugins/flight/hooks/core.ts:47:export function reduce(events: readonly FlightEvent[]): State {
template/plugins/flight/hooks/core.ts:53:export function currentAttempt(state: State): number {
template/plugins/flight/hooks/core.ts:57:export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number } | undefined {
template/plugins/flight/hooks/core.ts:71:export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
template/plugins/flight/hooks/core.ts:80:export function next(state: State, plan: Plan, fpNow: string): Action[] {
template/plugins/flight/hooks/core.ts:182:export function routingFindings(state: State): Finding[] {
template/plugins/flight/hooks/core.ts:201:export function closeoutLists(state: State): {
template/plugins/flight/hooks/core.ts:230:export const ev: {
template/plugins/flight/hooks/landing.tsx:5:export function registerLanding(on: On): void {}
template/plugins/flight/hooks/landing.tsx:8:export async function runLandingAction($: EngineInterface, f: Flight, action: Action): Promise<void> {}
template/plugins/flight/hooks/io.ts:9:export type Tree = { path: string; branch: string }
template/plugins/flight/hooks/io.ts:12:export async function trees(io: Io, cwd: string): Promise<Tree[]> {
template/plugins/flight/hooks/io.ts:24:export async function judgesDir(io: Io, mainTree: string): Promise<string> {
template/plugins/flight/hooks/io.ts:32:export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
template/plugins/flight/hooks/io.ts:36:export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
template/plugins/flight/hooks/io.ts:47:export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
template/plugins/flight/hooks/io.ts:72:export function worktreePath(f: Flight, name: string): string {
template/plugins/flight/hooks/io.ts:77:export async function ensureWorktree(io: Io, f: Flight, name: string): Promise<{ path: string; created: boolean } | { error: string }> {
template/plugins/flight/hooks/io.ts:85:export function agentType(role: Role): string {
template/plugins/flight/hooks/io.ts:90:export const flights: Map<string, Flight> = new Map()
template/plugins/flight/hooks/io.ts:95:export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
```

## S2 prompts.ts (template/plugins/flight/hooks/)
```
template/plugins/flight/hooks/orchestrator.tsx:300:export function registerOrchestrator(on: On): void {
template/plugins/flight/hooks/register.tsx:208:export const register: Register = on => {
template/plugins/flight/hooks/land.ts:5:export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录
template/plugins/flight/hooks/land.ts:21:export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
template/plugins/flight/hooks/land.ts:96:export async function mergeSlice(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]):
template/plugins/flight/hooks/land.ts:107:export async function prepareResolve(io: Io, f: Flight, slice: string): Promise<{ path: string; conflicts: string[] } | { error: string }> {
template/plugins/flight/hooks/land.ts:122:export async function finishResolve(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]): Promise<{ ok: true; commit: string } | { ok: false; failed: string
template/plugins/flight/hooks/land.ts:135:export async function mergeFix(io: Io, f: Flight, note: string): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
template/plugins/flight/hooks/land.ts:145:export function validateFindings(input: unknown): { ok: true; findings: Finding[] } | { ok: false; error: string } {
template/plugins/flight/hooks/land.ts:164:export async function closeout(io: Io, f: Flight, lists: { blocked: { slice: string; kind: 'gate' | 'infra'; reason: string }[]; blocking: Finding[]; deferred: Finding[]; fix: { 
template/plugins/flight/hooks/io.ts:9:export type Tree = { path: string; branch: string }
template/plugins/flight/hooks/io.ts:12:export async function trees(io: Io, cwd: string): Promise<Tree[]> {
template/plugins/flight/hooks/io.ts:24:export async function judgesDir(io: Io, mainTree: string): Promise<string> {
template/plugins/flight/hooks/io.ts:32:export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
template/plugins/flight/hooks/io.ts:36:export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
template/plugins/flight/hooks/io.ts:47:export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
template/plugins/flight/hooks/io.ts:72:export function worktreePath(f: Flight, name: string): string {
template/plugins/flight/hooks/io.ts:77:export async function ensureWorktree(io: Io, f: Flight, name: string): Promise<{ path: string; created: boolean } | { error: string }> {
template/plugins/flight/hooks/io.ts:85:export function agentType(role: Role): string {
template/plugins/flight/hooks/io.ts:90:export const flights: Map<string, Flight> = new Map()
template/plugins/flight/hooks/io.ts:95:export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
template/plugins/flight/hooks/prompts.ts:13:export function executorPrompt(x: {
template/plugins/flight/hooks/prompts.ts:36:export function reviewerPrompt(x: { change: string; changeDir: string; slice: string; commit: string }): string {
template/plugins/flight/hooks/prompts.ts:46:export function resolverPrompt(x: { change: string; changeDir: string; slice: string; conflicts: string[] }): string {
template/plugins/flight/hooks/prompts.ts:58:export function fixerPrompt(x: { change: string; changeDir: string; findings: Finding[] }): string {
template/plugins/flight/hooks/core.ts:4:export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver'
template/plugins/flight/hooks/core.ts:5:export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
template/plugins/flight/hooks/core.ts:6:export type Finding = { severity: Severity; file: string; line: number; summary: string; fix: string }
template/plugins/flight/hooks/core.ts:8:export type GateJson = { slice: string; ok: boolean; commit: string; failed: string[]; warnings?: string[]; ceilings?: unknown[]; base?: string; summary?: string }
template/plugins/flight/hooks/core.ts:10:export type FlightEvent = { v: 1; ev: string; change: string; at: string; by: { plugin: 'flight'; session: string }; [k: string]: unknown }
template/plugins/flight/hooks/core.ts:11:export type Plan = { waves: string[][]; deps: Record<string, string[]> }
template/plugins/flight/hooks/core.ts:13:export type Flight = { change: string; mainTree: string; changeTree: string; changeDir: string; branch: string; hooksDir: string; model: string; session: string }
template/plugins/flight/hooks/core.ts:14:export type RunResult = { exitCode: number; stdout: string; stderr: string }
template/plugins/flight/hooks/core.ts:16:export interface Io {
template/plugins/flight/hooks/core.ts:22:export type Action =
template/plugins/flight/hooks/core.ts:36:export type State = { readonly events: readonly Ev[]; readonly attempt: number; readonly takeoff: Ev | undefined }
template/plugins/flight/hooks/core.ts:47:export function reduce(events: readonly FlightEvent[]): State {
template/plugins/flight/hooks/core.ts:53:export function currentAttempt(state: State): number {
template/plugins/flight/hooks/core.ts:57:export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number } | undefined {
template/plugins/flight/hooks/core.ts:71:export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
template/plugins/flight/hooks/core.ts:80:export function next(state: State, plan: Plan, fpNow: string): Action[] {
template/plugins/flight/hooks/core.ts:182:export function routingFindings(state: State): Finding[] {
template/plugins/flight/hooks/core.ts:201:export function closeoutLists(state: State): {
template/plugins/flight/hooks/core.ts:230:export const ev: {
template/plugins/flight/hooks/landing.tsx:5:export function registerLanding(on: On): void {}
template/plugins/flight/hooks/landing.tsx:8:export async function runLandingAction($: EngineInterface, f: Flight, action: Action): Promise<void> {}
```

## S3 io.ts (template/plugins/flight/hooks/)
```
template/plugins/flight/hooks/register.tsx:208:export const register: Register = on => {
template/plugins/flight/hooks/orchestrator.tsx:300:export function registerOrchestrator(on: On): void {
template/plugins/flight/hooks/land.ts:5:export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录
template/plugins/flight/hooks/land.ts:21:export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
template/plugins/flight/hooks/land.ts:96:export async function mergeSlice(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]):
template/plugins/flight/hooks/land.ts:107:export async function prepareResolve(io: Io, f: Flight, slice: string): Promise<{ path: string; conflicts: string[] } | { error: string }> {
template/plugins/flight/hooks/land.ts:122:export async function finishResolve(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]): Promise<{ ok: true; commit: string } | { ok: false; failed: string
template/plugins/flight/hooks/land.ts:135:export async function mergeFix(io: Io, f: Flight, note: string): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
template/plugins/flight/hooks/land.ts:145:export function validateFindings(input: unknown): { ok: true; findings: Finding[] } | { ok: false; error: string } {
template/plugins/flight/hooks/land.ts:164:export async function closeout(io: Io, f: Flight, lists: { blocked: { slice: string; kind: 'gate' | 'infra'; reason: string }[]; blocking: Finding[]; deferred: Finding[]; fix: { 
template/plugins/flight/hooks/prompts.ts:13:export function executorPrompt(x: {
template/plugins/flight/hooks/prompts.ts:36:export function reviewerPrompt(x: { change: string; changeDir: string; slice: string; commit: string }): string {
template/plugins/flight/hooks/prompts.ts:46:export function resolverPrompt(x: { change: string; changeDir: string; slice: string; conflicts: string[] }): string {
template/plugins/flight/hooks/prompts.ts:58:export function fixerPrompt(x: { change: string; changeDir: string; findings: Finding[] }): string {
template/plugins/flight/hooks/io.ts:9:export type Tree = { path: string; branch: string }
template/plugins/flight/hooks/io.ts:12:export async function trees(io: Io, cwd: string): Promise<Tree[]> {
template/plugins/flight/hooks/io.ts:24:export async function judgesDir(io: Io, mainTree: string): Promise<string> {
template/plugins/flight/hooks/io.ts:32:export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
template/plugins/flight/hooks/io.ts:36:export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
template/plugins/flight/hooks/io.ts:47:export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
template/plugins/flight/hooks/io.ts:72:export function worktreePath(f: Flight, name: string): string {
template/plugins/flight/hooks/io.ts:77:export async function ensureWorktree(io: Io, f: Flight, name: string): Promise<{ path: string; created: boolean } | { error: string }> {
template/plugins/flight/hooks/io.ts:85:export function agentType(role: Role): string {
template/plugins/flight/hooks/io.ts:90:export const flights: Map<string, Flight> = new Map()
template/plugins/flight/hooks/io.ts:95:export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
template/plugins/flight/hooks/landing.tsx:5:export function registerLanding(on: On): void {}
template/plugins/flight/hooks/landing.tsx:8:export async function runLandingAction($: EngineInterface, f: Flight, action: Action): Promise<void> {}
template/plugins/flight/hooks/core.ts:4:export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver'
template/plugins/flight/hooks/core.ts:5:export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
template/plugins/flight/hooks/core.ts:6:export type Finding = { severity: Severity; file: string; line: number; summary: string; fix: string }
template/plugins/flight/hooks/core.ts:8:export type GateJson = { slice: string; ok: boolean; commit: string; failed: string[]; warnings?: string[]; ceilings?: unknown[]; base?: string; summary?: string }
template/plugins/flight/hooks/core.ts:10:export type FlightEvent = { v: 1; ev: string; change: string; at: string; by: { plugin: 'flight'; session: string }; [k: string]: unknown }
template/plugins/flight/hooks/core.ts:11:export type Plan = { waves: string[][]; deps: Record<string, string[]> }
template/plugins/flight/hooks/core.ts:13:export type Flight = { change: string; mainTree: string; changeTree: string; changeDir: string; branch: string; hooksDir: string; model: string; session: string }
template/plugins/flight/hooks/core.ts:14:export type RunResult = { exitCode: number; stdout: string; stderr: string }
template/plugins/flight/hooks/core.ts:16:export interface Io {
template/plugins/flight/hooks/core.ts:22:export type Action =
template/plugins/flight/hooks/core.ts:36:export type State = { readonly events: readonly Ev[]; readonly attempt: number; readonly takeoff: Ev | undefined }
template/plugins/flight/hooks/core.ts:47:export function reduce(events: readonly FlightEvent[]): State {
template/plugins/flight/hooks/core.ts:53:export function currentAttempt(state: State): number {
template/plugins/flight/hooks/core.ts:57:export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number } | undefined {
template/plugins/flight/hooks/core.ts:71:export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
template/plugins/flight/hooks/core.ts:80:export function next(state: State, plan: Plan, fpNow: string): Action[] {
template/plugins/flight/hooks/core.ts:182:export function routingFindings(state: State): Finding[] {
template/plugins/flight/hooks/core.ts:201:export function closeoutLists(state: State): {
template/plugins/flight/hooks/core.ts:230:export const ev: {
```

S2 另改 agents/reviewer.md：评审员用 git diff <commit>^1 <commit>，取不到报 HIGH

## S4 landing.tsx / core.ts / register.tsx (template/plugins/flight/hooks/)
landing.tsx
- `export const FINDINGS_TOOL` — submit_findings 工具定义
- `export async function onFindings(ctx: Ctx, found: Found | undefined, agentId: string | undefined, input: unknown): Promise<{ result: string } | { deny: string }>` — 处理评审员提交的 findings
- `export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined>` — 落地 Stop 判定
- `export async function runLandingAction(ctx: Ctx, f: Flight, action: Action): Promise<void>` — 执行落地动作
core.ts / register.tsx 本片仅小改，签名见源文件（`export const register: Register`）
