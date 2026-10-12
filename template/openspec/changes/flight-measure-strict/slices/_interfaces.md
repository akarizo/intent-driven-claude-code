# 公开接口摘要

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
export function agentOf(state: State, agent: string): { role: Role; slice: string; worktree: string; attempt: number; branch: string; base?: string } | undefined {
export function stopVerdict(state: State, agent: string, gate: GateJson): { kind: 'block'; text: string } | { kind: 'accept' } {
export function next(state: State, plan: Plan, fpNow: string): Action[] {
export function routingFindings(state: State): Finding[] {
export function closeoutLists(state: State): {
export const ev: {
```

### template/plugins/flight/hooks/prompts.ts
```
export function worktreeNote(worktree: string): string {
export function executorPrompt(x: {
export function reviewerPrompt(x: { change: string; changeDir: string; slice: string; commit: string }): string {
export function resolverPrompt(x: { change: string; changeDir: string; slice: string; conflicts: string[] }): string {
export function fixerPrompt(x: { change: string; changeDir: string; findings: Finding[] }): string {
```

### template/plugins/flight/hooks/measure.ts
```
export const MEASURE_TOOL: { name: 'measure'; description: string; inputSchema: Record<string, unknown> } = {
export type MeasureJson = {
export async function measureSlice(
export async function onMeasure(ctx: Ctx, found: Found | undefined, agentId: string | undefined): Promise<{ result: string } | { deny: string }> {
```

## S2

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

## S4

### template/.claude/hooks/spec_html.py
```
def now_iso(now_arg):
def read_text(path):
def esc(s):
def inline_md(text):
def split_sections(text, level="##"):
def paragraphs(text):
def list_items(text):
def substitute_block(html_text, name, content):
def render_why(proposal_text):
def render_what(proposal_text):
def render_capabilities(proposal_text):
def render_scenario(name, body):
def render_requirement(heading, body):
def render_specs(change_dir):
def extract_diagrams(design_text):
def render_diagrams(design_text):
def strip_mermaid(text):
def render_generic_md(text):
def render_design(design_text):
def project_root(change_dir):
def scan_adrs(change_dir):
def render_tasks(tasks_text):
def compute_waves(slices):
def find_def_line(lines, func):
def decorator_source(source, func):
def scenario_flight_status(root, rel, func):
def gate_report_passed_slices(change_dir):
def load_timeline_rows(change_dir):
def render_flight(change_dir):
def compute_meta_chips(change_dir, change_name):
def render_footer(now, section_count, diagram_count, task_count):
def render(change_dir, template_path, out_path, now_arg):
def main():
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
def timeline_record(change_dir, event, note=""):
def append_report(change_dir, result):
def _cell(text):
def ceiling_rows_from_json(raw):
def record_ceilings(change_dir, slice_id, rows):
def evidence_state(change_dir, slice_id):
def g5_ledger_verdict(events, slice_id, base, pairs, guards=()):
def report_has_row(change_dir, slice_id, commit):
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
def cmd_measure(args):
def cmd_record(args):
def _reusable_fix_gate(root, change_dir):
def _dirty_paths(root, change_dir):
def cmd_final(args):
def cmd_baseline(args):
def _die_running_baseline(change_dir, bl, data):
def cmd_preflight(args):
def report_latest(change_dir):
def _final_fresh(root, change_dir, final_commit):
def cmd_ship(args):
def main():
```
