# 接口约定（跨切片）

并行切片按这里的签名与语义写代码；先合回的一方实现，后合回的一方按约定调用。行为细节以 design.md 与 specs/ 为准。

## S1

### template/plugins/flight/hooks/core.ts
```
export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver' | 'diagnostician'
export type HealKind = 'merge-retry' | 'watchdog' | 'integ'
export type HaltKind = 'blocked' | 'final' | 'integ' | 'fingerprint' | 'control' | 'watchdog' | 'abort'
export const HEAL_BUDGET = 3
export const INTEG = 'integ'
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
export function routingFindings(state: State): Finding[] {
export type SliceRow = {
export type FlightSummary = {
export function summarize(state: State): FlightSummary {
export function summaryLines(s: FlightSummary): string[] {
export const ev: {
```

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

## S2

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
def _diff_path(p):
def _g9_hunks(root, base):
def _func_span(source, func):
def _show(root, rev, rel):
def integ_guard(root, change_dir, data, base):
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

## S3

### template/plugins/flight/hooks/prompts.ts
```
export function worktreeNote(worktree: string): string {
export function executorPrompt(x: {
export function reviewerPrompt(x: { change: string; changeDir: string; slice: string; commit: string }): string {
export function wholeReviewPrompt(x: { change: string; changeDir: string; hooksDir: string; base: string; commit: string; prior: Finding[] }): string {
export function followupReviewPrompt(x: { change: string; changeDir: string; round: number; base: string; commit: string; prior: Finding[] }): string {
export function resolverPrompt(x: { change: string; changeDir: string; slice: string; conflicts: string[] }): string {
export function fixerPrompt(x: { change: string; changeDir: string; findings: Finding[] }): string {
export function integFixerPrompt(x: { change: string; changeDir: string; failed: string[]; base: string }): string {
export function integReviewPrompt(x: { change: string; changeDir: string; base: string; commit: string }): string {
export function triagePrompt(x: { change: string; changeDir: string; hooksDir: string; reason: string; kind: string }): string {
```

### template/plugins/flight/hooks/watchdog.ts
```
export const WATCHDOG_MS = 600000
export class StepTracker {
```

## S4 · 落地

- `io.ts` 的 EVENTS 与 ledger.py 同步（heal、triage、diagnostician、halt.kind 可选）。
- `runLandingAction`：
  - **派修复体**：
    - `action.slice === 'integ'` 时用 `integFixerPrompt`，failed 取 `action.failed`、base 取派发前 change worktree 的 HEAD；
    - dispatch 事件追加 `base`。
  - **派评审员**：`mode: 'integ'` 时用 `integReviewPrompt`，范围取动作上的 `base` / `commit`，dispatch 事件带二者。
  - **halt**：
    1. 追加 `ev.halt(b, {attempt, reason, kind: action.haltKind})`；
    2. `haltKind !== 'abort'` 时 `await ctx.notify?.(…)`，抛错吞掉。
  - **交接 pr-ship 失败**：toast 之外再 `ctx.notify?.(…)`。
- `onLandingStop`：slice 为 `integ` 的修复体，final 带 `--integ-base <其 dispatch 的 base>`。
- `ship.ts` 的 `shipPr`：ship 事件写入后 `ctx.notify?.(…)`，内容含 PR 号或链接、verdict、blocking 条数。

## S5 · 编排

- `perform` 处理 `heal`：只追加 heal 事件并返回 true（下一轮 next 给出派发）。
- `ctxOf($).notify = text => $.ui.notify(text, { title: 'flight' })`：未发出或抛错时 `ctx.log` 一行，不抛。
- `export async function takeoff($: Engine, args: string[], opts?: { resume?: boolean }): Promise<string>`：签名不变，只改为 export，供 S6 使用。
- 看门狗：
  - `turn.step`（async generator，`{ agentId: /./ }`）驱动 `StepTracker`；
  - `session.start` 起 `$.clock.every(60000, …)`，计时器结束后在下次 `turn.step` 重起。
- 停飞后派诊断员：`agentType('diagnostician') = 'flight:diagnostician'`，`HIDDEN` 加入；`turn.complete` 收到诊断员结束时，追加 triage 并通知。
- `/flight abort` 的 halt 带 `haltKind: 'abort'`；driveNow `terminal()` 的 halt 带 `haltKind: 'control'`。
- `versions.ts` 的 `REQUIRED_FEATURES` 加 `integ-guard`。

## S6 · `template/plugins/flight/hooks/resume.ts`

```ts
export type ResumeDeps = {
  stopLive(change: string): Promise<string[]>          // 返回被停的 agent id
  baseline(change: string): Promise<{ ok: boolean; reasons: string[] }>
  takeoff(args: string[], opts: { resume: true }): Promise<string>
  notify(text: string): Promise<void>
  toast(text: string): void
}
export async function resumeFlight(deps: ResumeDeps, change: string, opts: { replan: boolean }): Promise<string>
```
