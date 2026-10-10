# 公开接口摘要

## S2

### template/plugins/flight/hooks/landing.tsx
```
export const FINDINGS_TOOL: { name: 'submit_findings'; description: string; inputSchema: Record<string, unknown> } = {
export async function onFindings(ctx: Ctx, found: Found | undefined, agentId: string | undefined, input: unknown): Promise<{ result: string } | { deny: string }> {
export async function onLandingStop(ctx: Ctx, found: Found, agentId: string): Promise<{ block: string } | undefined> {
export async function runLandingAction(ctx: Ctx, f: Flight, action: Action): Promise<void> {
```

## S5

## S4

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

### template/plugins/flight/hooks/orchestrator.tsx
```
export function registerOrchestrator(on: On): void {
```

## S3

### template/plugins/flight/hooks/envelope.ts
```
export type Who = { role: Role; worktree: string; owns: readonly string[] }
export type ActiveTree = { change: string; changeTree: string; slicePrefix: string }
export type Deny = { deny: string }
export function normalizePath(p: string): string {
export function globMatch(path: string, pattern: string): boolean {
export function writeTarget(tool: string, input: unknown): string | undefined {
export function writeVerdict(who: Who, absPath: string): Deny | undefined {
export function bashVerdict(role: Role, command: string): Deny | undefined {
export function bashUpgradable(role: Role, command: string, commands: readonly string[]): boolean {
export function mainSessionVerdict(active: readonly ActiveTree[], tool: string, input: unknown): Deny | undefined {
export function spawnVerdict(x: { subagentType: string; originPlugin: string | undefined; model: string | undefined; parentInFlight: boolean }): Deny | undefined {
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
def _tail(out):
def run_cmd(cmd, cwd):
def normalize_lines(text):
def plan_sha(data):
def load_baseline(change_dir):
def gate_cmd_verdict(kind, cmd, root, baseline):
def glob_match(path, pattern):
def globs_intersect(a, b):
def compute_waves(slices):
def lint_plan(data):
def timeline_record(change_dir, event, note=""):
def append_report(change_dir, result):
def _cell(text):
def ceiling_rows_from_json(raw):
def record_ceilings(change_dir, slice_id, rows):
def evidence_state(change_dir, slice_id):
def report_has_row(change_dir, slice_id, commit):
def is_test_path(path):
def is_doc_or_config(path):
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
def cmd_lint(args, print_waves=True):
def _is_ancestor(root, anc, desc):
def _base_check(root, branch):
def _ckpt_ref(change_dir, slice_id):
def _ckpt_delete(root, ref):
def _gate_ref(change_dir, slice_id):
def _gate_save(root, change_dir, result):
def _gate_load(root, ref):
def _slice_owns(change_dir, slice_id):
def _checkpoint(root):
def cmd_checkpoint(args):
def _ckpt_restore(root, ref, owns):
def cmd_start(args):
def _read_marker(root):
def cmd_gate(args):
def cmd_record(args):
def cmd_final(args):
def cmd_baseline(args):
def cmd_preflight(args):
def report_latest(change_dir):
def _final_fresh(root, change_dir, final_commit):
def cmd_ship(args):
def main():
```

## S6

### template/plugins/flight/hooks/io.ts
```
export type Tree = { path: string; branch: string }
export async function trees(io: Io, cwd: string): Promise<Tree[]> {
export async function judgesDir(io: Io, mainTree: string): Promise<string> {
export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
export function eventProblem(event: FlightEvent, change: string): string | undefined {
export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
export const active: Map<string, ActiveTree> = new Map()
export type Owner = { change: string; role: Role; slice: string; worktree: string }
export const owners: Map<string, Owner> = new Map()
export async function ownerOf(io: Io, agentId: string): Promise<Owner | undefined> {
export function worktreePath(f: Flight, name: string): string {
export async function ensureWorktree(io: Io, f: Flight, name: string): Promise<{ path: string; created: boolean } | { error: string }> {
export function agentType(role: Role): string {
export const flights: Map<string, Flight> = new Map()
export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
```

### template/plugins/flight/hooks/orchestrator.tsx
```
export function registerOrchestrator(on: On): void {
```
