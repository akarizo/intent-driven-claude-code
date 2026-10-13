# 公开接口摘要

## 约定（规划时写定；各片按这里对接，不得改动）

### `slice-gate.py base`（S1 产出，S7 消费）
```
python3 <hooks>/slice-gate.py base <S> --change-dir <D> [--base <X>] [--expect-branch <B>]
```
- cwd 为切片 worktree，或解冲突 worktree。
- 成功：退出 0，stdout 恰为一行 JSON `{"slice": "<S>", "base": "<X，或 git rev-parse HEAD 全长>"}`。
- G0 不过（只在带 `--expect-branch` 时检查）：退出 1，stdout 为 `{"slice": "<S>", "ok": false, "commit": "", "failed": ["G0 base: …"], "warnings": [], "summary": "基点校验未通过"}`。
- S 不在计划里：退出 2，stderr 写原因。
- 不写任何文件。
- `slice-gate.py start` / `record` 不存在（argparse 错误，退出 2）。
- `gate` / `measure` 的 `--base` 必填。
- `features` 增加一行 `ledger-records`。

### `timeline.py render`（S2 产出，S6 消费）
```
python3 <hooks>/timeline.py render --change-dir <D>
```
- cwd 为 change worktree，D 为相对 change 目录。
- 成功：退出 0，整份重写 `<D>/timeline.md` 与 `<D>/gate-report.md`，stdout 为 `{"timeline": "<路径>", "report": "<路径>", "events": <n>}`。
- 账本读不出：退出 1，stderr 写原因，不写文件。
- 格式见 design D2。`timeline.py record` 不存在。

### `timeline.py report`（S2 产出，S6 的飞行记录照旧调用）
- 调用方式不变：`timeline.py report --change-dir <D>`。账本里有 takeoff 时按账本计算，见 design D2。

### diag 事件（S2 的 `ledger.py`、S5 的 `ev.diag`、S8 的 `io.ts` EVENTS 三处一致）
```json
{"v": 1, "ev": "diag", "change": "<c>", "at": "<ISO>", "by": {"plugin": "flight", "session": "<s>"},
 "attempt": 1, "where": "SubagentStop", "error": "<消息，可为空串>", "kind": "throw|timeout|re-entry", "agent": "<id>", "budget": 10000}
```
- 必填 `attempt`（整数）、`where`（非空字符串）、`error`（字符串）。
- `kind`、`agent`、`budget` 可选。

### `intent-gate.py check`（S3 产出，S4 消费）
```
python3 <hooks>/intent-gate.py check --cwd <C> <PATH> [<PATH> …]
```
- 判完：退出 0，stdout 恰为一行 JSON `{"allow": <bool>, "denied": [{"path": "<绝对路径>", "reason": "<原因>"}]}`。
- 判定异常：退出 2，stderr 写原因。
- 相对 PATH 相对 `--cwd` 解析。

### `envelope.ts`（S4 产出，S4 / S8 消费）
```ts
export function bashWriteTargets(command: string, cwd: string): { targets: string[]; unresolved: string[] }
export function bashWritesVerdict(who: Who, command: string): Deny | undefined
```
- targets 为绝对路径，经 `normalizePath` 规整，去重，保持出现顺序。
- `bashWritesVerdict` 只看写入目标：每个 target 走 `writeVerdict(who, target)`；unresolved 非空时拒绝，原因含「写入目标无法静态判定」。git 拒绝表等仍由 `bashVerdict` 负责，两者由 S8 在 `orchestrator.tsx` 的 `envelopeVerdict` 里串起来。

### `intent.ts`（S4 产出，S8 消费）
```ts
export function toolTargets(tool: string, e: Record<string, unknown>, cwd: string): string[]
export async function intentVerdict(io: Io, hooksDir: string, cwd: string, targets: readonly string[]): Promise<{ deny: string } | undefined>
```
- `e` 是 `tool.call` 的平铺事件：`e.file_path`、`e.notebook_path`、`e.command`。

### `core.ts`（S5 产出，S6 / S8 消费）
```ts
ev.final(b, x: { attempt: number; ok: boolean; commit: string; failed: string[]; warnings?: string[] }): FlightEvent
ev.diag(b, x: { attempt: number; where: string; error: string; kind?: string; agent?: string; budget?: number }): FlightEvent
```
- `reduce` / `next` / `summarize` 忽略 diag。

### `io.ts` `stoppedNow`（S6 产出，S8 消费）
```ts
export async function stoppedNow(io: Io, f: Flight): Promise<'halt' | 'land' | 'unreadable' | undefined>
```
- 按账本最新 takeoff 的 attempt 判断。

### `land.ts` `mergeFix`（S6 维持签名，S7 / S8 照旧调用）
```ts
mergeFix(io, f, _note: string, branch?: string, slice = 'fix')
```
- 第三个形参保留不用，因为并行的 S7 还按原位置传参。

### `abort.ts` `abortFlight`（S7 内部）
- 依赖为 `{ state, session, halt, live, stop, drain }`，流程见 design D7。

## S3

### template/.claude/hooks/intent-gate.py
```
def deny_reason(rel):
def scoped_deny_reason(rel, branch, name):
def to_posix(rel):
def is_exempt(rel_posix):
def resolve_root(file_abs, project_dir):
def has_unchecked_task(text):
def tasks_unchecked(tasks):
def has_apply_context(root):
def current_branch(file_abs):
def change_of_branch(branch):
def parse_marker(text):
def marker_expired(created):
def mini_allows(root, rel_posix):
def judge(target_abs, cwd):
def classic():
def check(argv):
```

## S5

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
export type SliceRow = {
export type FlightSummary = {
export function summarize(state: State): FlightSummary {
export function summaryLines(s: FlightSummary): string[] {
export const ev: {
```

### template/plugins/flight/hooks/ship.ts
```
export const SHIP_TOOL = {
export type ShipJson = {
export function shipComment(j: ShipJson, x: { date: string }): string {
export async function shipPr(ctx: Ctx, f: Flight, state: State, pr: string): Promise<{ result: string } | { deny: string }> {
```

## S2

### template/.claude/hooks/timeline.py
```
def parse_ts(s):
def _ts(e):
def _fmt_at(at):
def _flat(text):
def _cell(text):
def _strs(x):
def _red_count(outcomes):
def _note(e):
def _baseline_line(change_dir):
def event_lines(change_dir, events):
def ceiling_rows_from_json(raw):
def report_text(events):
def render(change_dir):
def load(change_dir):
def _first_ship_at(events):
def minutes(a, b):
def _span(a, b):
def _red_lines(events):
def report_ledger(change_dir, events):
def report(change_dir):
def main():
```

### template/.claude/hooks/ledger.py
```
def _int(x):  # Python 里 True 是 int，须排除
def _strs(x):
def _finding(f):
def _one_of(*opts):
def _outcome(o):
class LedgerInvalid(Exception):
class LedgerUnreadable(Exception):
def ref_for(change):
def _git(change_dir, *args, check=True):
def _err(p):
def _out(p):
def _check_event(sha, ev, change):
def _read(change_dir):
def read_events(change_dir):
def latest_approval(change_dir):
def main(argv=None):
```

## S4

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
export function bashWriteTargets(command: string, cwd: string): { targets: string[]; unresolved: string[] } {
export function bashWritesVerdict(who: Who, command: string): Deny | undefined {
export function bashUpgradable(role: Role, command: string, commands: readonly string[], worktree?: string, mainTree?: string): boolean {
export function readUpgradable(tool: string, input: unknown, worktree: string, mainTree: string): boolean {
export function mainSessionVerdict(active: readonly ActiveTree[], tool: string, input: unknown): Deny | undefined {
export function spawnVerdict(x: { subagentType: string; originPlugin: string | undefined; model: string | undefined; parentInFlight: boolean }): Deny | undefined {
```

### template/plugins/flight/hooks/intent.ts
```
export function toolTargets(tool: string, e: Record<string, unknown>, cwd: string): string[] {
export async function intentVerdict(io: Io, hooksDir: string, cwd: string, targets: readonly string[]): Promise<{ deny: string } | undefined> {
```

## S1

### template/.claude/hooks/slice-gate.py
```
def pytest_runtest_logreport(report):
def now_iso():
def die(msg, code=2):
def git(root, *args):
def toplevel(cwd=None):
def load_plan(change_dir):
def save_plan(change_dir, data):
def run_cmd_full(cmd, cwd):
def _tail(out, n=6):
def run_cmd(cmd, cwd):
def _summary_failed(line):
def run_test_gate(cmd, root):
def normalize_lines(text):
def plan_sha(data):
def load_baseline(change_dir):
def gate_cmd_verdict(kind, cmd, root, baseline):
def full_suite_verdict(cmd, root, baseline):
def glob_match(path, pattern):
def globs_intersect(a, b):
def compute_waves(slices):
def lint_plan(data):
def g5_ledger_verdict(events, slice_id, base, pairs, guards=()):
def is_test_path(path):
def is_doc_or_config(path):
def source_files(files, change_rel):
def is_bytecode(path):
def changed_files(root, base):
def added_lines(root, base):
def ceiling_rows(root, base):
def gwt_violations(root, test_files):
def _py_test_bodies(lines):
def _test_bodies(rel, lines):
def ownership_violations(files, owns, change_rel, committed=()):
def _py_decorators(source, func):
def _g7_runner(gate):
def _g7_timeout(gate):
def _pytest_outcomes(root, targets, gate=None):
def _g7_diag(text):
def scenario_status(root, data, slice_ids=None):
def detect_test_cmd(root):
def guard_marker_errors(change_dir, data):
def cmd_lint(args, print_waves=True):
def _is_ancestor(root, anc, desc):
def _base_check(root, branch):
def cmd_checkpoint(args):
def cmd_features(args):
def cmd_base(args):
def cmd_gate(args):
def cmd_measure(args):
def _reusable_fix_gate(root, change_dir):
def _dirty_paths(root, change_dir):
def cmd_final(args):
def cmd_baseline(args):
def _die_running_baseline(change_dir, bl, data):
def cmd_preflight(args):
def _final_fresh(root, change_dir, final_commit):
def _is_fix_slice(s):
def _whole_round(s):
def _findings(reviews):
def routing_findings(events):
def ship_verdict(root, change_dir, data, events, head):
def cmd_ship(args):
def main():
```

## S6

### template/plugins/flight/hooks/landing.tsx
```
export const FINDINGS_TOOL: { name: 'submit_findings'; description: string; inputSchema: Record<string, unknown> } = {
export async function onFindings(ctx: Ctx, found: Found | undefined, agentId: string | undefined, input: unknown): Promise<{ result: string } | { deny: string }> {
export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined> {
export async function runLandingAction(ctx: Ctx, f: Flight, action: Action): Promise<void> {
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

## S7

### template/plugins/flight/hooks/orchestrator.tsx
```
export function registerOrchestrator(on: On): void {
```

### template/plugins/flight/hooks/abort.ts
```
export async function abortFlight(x: {
```

### template/plugins/flight/hooks/versions.ts
```
export type VersionCheck = { ok: true; line: string } | { ok: false; reason: string }
export const REQUIRED_FEATURES = ['evidence-ledger-only', 'g5-per-target', 'guards', 'ship-ledger', 'ledger-records'] as const
export async function checkPluginCopy(io: Io, x: { pluginRoot: string; configDir: string; mainTree: string }): Promise<VersionCheck> {
export async function checkJudges(io: Io, x: { hooksDir: string; required: readonly string[] }): Promise<VersionCheck> {
```

## S8

### template/plugins/flight/hooks/orchestrator.tsx
```
export function registerOrchestrator(on: On): void {
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

## S9
