# 公开接口摘要

## S4

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

### template/plugins/flight/hooks/orchestrator.tsx
```
export async function scenarioFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean; lease?: Lease } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean; lease?: Lease }): Promise<string> {
export function restoreStatusNow(): Promise<void> {
export function registerOrchestrator(on: On): void {
```
