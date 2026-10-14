# 公开接口摘要

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
def lint_artifact_files(data):
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

### template/plugins/flight/hooks/land.ts
```
export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录
export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
export function classifyDirty(paths: readonly string[], x: { changeDir: string; scenarioFiles: readonly string[]; artifactFiles?: readonly string[] }): { records: string[]; artifacts: string[]; others: string[] } {
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
export async function artifactFiles(io: Io, path: string): Promise<string[]> {
export async function takeoff($: Engine, args: string[], opts: { resume?: boolean; lease?: Lease } = {}): Promise<string> {
export function takeoffNow(args: string[], opts?: { resume?: boolean; lease?: Lease }): Promise<string> {
export function restoreStatusNow(): Promise<void> {
export function registerOrchestrator(on: On): void {
```

### template/plugins/flight/hooks/register.tsx
```
export const register: Register = on => {
```

## S3
