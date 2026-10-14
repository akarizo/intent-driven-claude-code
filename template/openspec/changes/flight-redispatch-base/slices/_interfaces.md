# 公开接口摘要

## S1

### template/plugins/flight/hooks/core.ts
```
export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver' | 'diagnostician'
export type HealKind = 'merge-retry' | 'watchdog' | 'integ'
export type HaltKind = 'blocked' | 'final' | 'integ' | 'fingerprint' | 'control' | 'watchdog' | 'abort' | 'premerge'
export const HEAL_BUDGET = 3
export const INTEG = 'integ'
export const PREMERGE = 'premerge'
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
export function healVerdict(state: State, kind: HealKind, slice: string): { ok: true } | { ok: false; reason: string } {
export function next(state: State, plan: Plan, fpNow: string): Action[] {
export type TriageVerdict = '改计划' | '修插件' | '人工操作'
export function triageVerdict(text: string): TriageVerdict | undefined {
export function planDefect(state: State): string | undefined {
export function routingFindings(state: State): Finding[] {
export type SliceRow = {
export type FlightSummary = {
export function summarize(state: State): FlightSummary {
export function summaryLines(s: FlightSummary): string[] {
export const ev: {
```
