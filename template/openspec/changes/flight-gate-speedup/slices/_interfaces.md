# 公开接口摘要

## S1 → S2（同一文件 `template/.claude/hooks/slice-gate.py`，S2 在 S1 合回后的版本上改）

S1 合回后，`slice-gate.py` 里应有以下形状（名字可以不同，但 S2 依赖这两个「接缝」）：

```
def run_test_gate(cmd, root):
    """跑 gate.test，经 PYTEST_ADDOPTS 注入 --junitxml。
    返回 {"rc": int, "out": str, "failed": [标识, ...] | None, "why": str | None}
    failed 非 None ⇔ 本次结果可度量（design D2 的四个条件）；why 是不可度量的理由。"""

def cmd_final(args):
    # 顺序：G7 → lint / typecheck → G2
    # G2 只在一处执行，形如：
    #   if v7: warnings.append("G2 全量未跑：…")
    #   else:  <跑 run_test_gate 并按基线差分>
```

S2 在 G2 这一处之前插入复用判断（`--reuse-fix`），在 `cmd_baseline` 开头加运行标记，在 `cmd_preflight` 开头加标记识别，在 `lint_plan` 加 `gate.test` 必填。

## S3、S4、S5

彼此之间、与 S1 / S2 之间没有代码接口。约定只有一条：S4 让插件以 `slice-gate.py final --change-dir <dir> --reuse-fix` 调用 final，参数语义由 S2 实现（design D3）。S4 的测试用假 io，不依赖 S2 的实现。

## S4

### template/plugins/flight/hooks/landing.tsx
```
export const FINDINGS_TOOL: { name: 'submit_findings'; description: string; inputSchema: Record<string, unknown> } = {
export async function onFindings(ctx: Ctx, found: Found | undefined, agentId: string | undefined, input: unknown): Promise<{ result: string } | { deny: string }> {
export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined> {
export async function runLandingAction(ctx: Ctx, f: Flight, action: Action): Promise<void> {
```

## S3

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
export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number } | undefined {
export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
export function next(state: State, plan: Plan, fpNow: string): Action[] {
export function routingFindings(state: State): Finding[] {
export function closeoutLists(state: State): {
export const ev: {
```

## S5
