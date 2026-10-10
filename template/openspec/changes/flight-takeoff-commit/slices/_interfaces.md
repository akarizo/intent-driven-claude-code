# 公开接口摘要

S1 与 S2 之间没有代码接口。S2 的文档按 design D1、D2、D4 的措辞描述 S1 的行为：
- 授权词：「授权提交」，可以单独写，也可以粘在 change 名后面；
- 工件：change 目录、同一 openspec 根下的 `adr/DRAFT-*.md`、`scenario_tests` 映射到的测试文件；
- 有工件之外的未提交改动时，仍拒绝起飞。

## S2

## S1

### template/plugins/flight/hooks/land.ts
```
export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录
export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
export function classifyDirty(paths: readonly string[], x: { changeDir: string; scenarioFiles: readonly string[] }): { records: string[]; artifacts: string[]; others: string[] } {
export async function commitArtifacts(io: Io, f: Flight, paths: readonly string[]): Promise<string | undefined> {
export async function mergeSlice(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]):
export async function prepareResolve(io: Io, f: Flight, slice: string): Promise<{ path: string; conflicts: string[] } | { error: string }> {
export async function finishResolve(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
export async function mergeFix(io: Io, f: Flight, note: string): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
export function validateFindings(input: unknown): { ok: true; findings: Finding[] } | { ok: false; error: string } {
export async function closeout(io: Io, f: Flight, lists: { blocked: { slice: string; kind: 'gate' | 'infra'; reason: string }[]; blocking: Finding[]; deferred: Finding[]; fix: { ok: boolean; commit: string } | null }, merged: readonly string[]):
```

### template/plugins/flight/hooks/orchestrator.tsx
```
export function registerOrchestrator(on: On): void {
```
