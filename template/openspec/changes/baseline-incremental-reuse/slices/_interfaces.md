# 公开接口摘要

## S3

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
def _has_takeoff(change_dir):
def _change_rel(root, change_dir):
def _plan_file(rel, change_rel):
def _ignored(rel):
def _git_raw(root, args, stdin=None):
def _hash_paths(root, rels):
def _snapshot(root, change_rel):
def _blobs_at(root, commit, paths):
def _repo_rel(root, tok):
def cmd_key(root, change_rel, cmd):
def _delta(root, cand, cur_snap, head, change_rel, same_change):
def _try_reuse(root, change_dir, data, cand, cur_snap, key):
def _verify_paths(root, cmd, delta):
def _verify_rerun(root, cmd, prev, delta):
def _final_fresh(root, change_dir, final_commit):
def _is_fix_slice(s):
def _whole_round(s):
def _findings(reviews):
def routing_findings(events):
def ship_verdict(root, change_dir, data, events, head):
def cmd_ship(args):
def main():
```
