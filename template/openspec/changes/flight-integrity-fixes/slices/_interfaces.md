# 公开接口摘要

## S1
### template/.claude/hooks/slice-gate.py
74:def now_iso():
78:def die(msg, code=2):
83:def git(root, *args):
90:def toplevel(cwd=None):
97:def load_plan(change_dir):
105:def save_plan(change_dir, data):
111:def run_cmd_full(cmd, cwd):
116:def _tail(out):
120:def run_cmd(cmd, cwd):
125:def normalize_lines(text):
136:def plan_sha(data):
144:def load_baseline(change_dir):
155:def gate_cmd_verdict(kind, cmd, root, baseline):
179:def glob_match(path, pattern):
187:def globs_intersect(a, b):
198:def compute_waves(slices):
211:def lint_plan(data):
248:def timeline_record(change_dir, event, note=""):
260:def append_report(change_dir, result):
276:def _cell(text):
280:def ceiling_rows_from_json(raw):
299:def record_ceilings(change_dir, slice_id, rows):
331:def evidence_state(change_dir, slice_id):
350:def report_has_row(change_dir, slice_id, commit):
364:def is_test_path(path):
371:def is_doc_or_config(path):
378:def changed_files(root, base):
392:def added_lines(root, base):
416:def ceiling_rows(root, base):
439:def gwt_violations(root, test_files):
459:def _py_test_bodies(lines):
475:def _test_bodies(rel, lines):
510:def ownership_violations(files, owns, change_rel, committed=()):
526:def _py_decorators(source, func):
540:def scenario_status(root, data, slice_ids=None):
587:def detect_test_cmd(root):
601:def cmd_lint(args, print_waves=True):
611:def _is_ancestor(root, anc, desc):
617:def _base_check(root, branch):
630:def _ckpt_ref(change_dir, slice_id):
634:def _ckpt_delete(root, ref):
639:def _gate_ref(change_dir, slice_id):
643:def _gate_save(root, change_dir, result):
662:def _gate_load(root, ref):
673:def _slice_owns(change_dir, slice_id):
682:def _checkpoint(root):
733:def cmd_checkpoint(args):
750:def _ckpt_restore(root, ref, owns):
782:def cmd_start(args):
826:def _read_marker(root):
837:def cmd_gate(args):
920:def cmd_record(args):
949:def cmd_final(args):
982:def cmd_baseline(args):
1022:def cmd_preflight(args):
1044:def report_latest(change_dir):
1061:def _final_fresh(root, change_dir, final_commit):
1074:def cmd_ship(args):
1121:def main():

## S3
### template/.claude/workflows/opsx-apply.js
20:export const meta = {

## S4
### template/.claude/hooks/plan_fp.py template/.claude/hooks/ledger.py

## S5
插件文件，无公开代码接口（template/plugins/flight/**）

## S6
### install.sh
49:log_add()  { printf '%s[add]%s     %s\n' "$C_GREEN"  "$C_RESET" "$1"; }
50:log_upd()  { printf '%s[update]%s  %s\n' "$C_BLUE"   "$C_RESET" "$1"; }
51:log_mv()   { printf '%s[move]%s    %s\n' "$C_BLUE"   "$C_RESET" "$1"; }
52:log_skip() { printf '%s[skip]%s    %s\n' "$C_DIM"    "$C_RESET" "$1"; }
53:log_app()  { printf '%s[append]%s  %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
54:log_info() { printf '%s[info]%s    %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
55:log_err()  { printf '%s[err]%s     %s\n' "$C_RED"    "$C_RESET" "$1" >&2; }
60:usage() {
192:copy_tree() {
224:migrate_root_adr() {
252:refresh_marker_block() {
275:merge_settings() {
354:flight_plugin_enabled() {
370:install_flight_plugin() {
