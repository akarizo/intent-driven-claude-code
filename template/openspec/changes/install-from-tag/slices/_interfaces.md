# 接口摘要

## S1

tests/test_install.py:14:def run_install(tmp_path, target, *flags):
tests/test_install.py:27:def ignored(repo, rel):
tests/test_install.py:31:def test_template_ignores_flight_marker(git_repo):
tests/test_install.py:46:def test_upgrade_appends_flight_ignore_once(tmp_path):
tests/test_install.py:72:def path_without_real_claude(bin_dir):
tests/test_install.py:79:def run_install_stubbed(tmp_path, target, *flags, claude=True):
tests/test_install.py:99:def plugin_calls(calls):
tests/test_install.py:103:def test_marketplace_lists_flight_plugin():
tests/test_install.py:117:def test_install_registers_plugin_at_project_scope(tmp_path):
tests/test_install.py:131:def test_install_without_claude_prints_manual_steps(tmp_path):
tests/test_install.py:144:def test_install_skips_enabled_plugin(tmp_path):
tests/test_install.py:166:def run_install_claude_failing(tmp_path, target, failing, *flags):
tests/test_install.py:187:def test_plugin_install_continues_after_marketplace_failure(tmp_path):
tests/test_install.py:201:def test_plugin_install_failure_keeps_exit_zero(tmp_path):
tests/test_install.py:215:def test_upgrade_adds_missing_template_settings_keys(tmp_path):
tests/test_install.py:249:def _skip_changes(info):
tests/test_install.py:254:def make_source(tmp_path, ref, kind, files):
tests/test_install.py:274:def run_pipe(tmp_path, source, *args, ref=None, extra_env=None):
tests/test_install.py:290:def stub_log(tmp_path):
tests/test_install.py:298:def test_pipe_installs_tag_only_ref(tmp_path):
tests/test_install.py:311:def test_pipe_default_ref_is_main_branch(tmp_path):
tests/test_install.py:324:def test_pipe_missing_ref_lists_both_urls(tmp_path):
tests/test_install.py:339:def test_pipe_delegates_args_to_archived_installer(tmp_path):
tests/test_install.py:353:def test_pipe_propagates_exit_and_cleans_temp(tmp_path):
tests/test_install.py:368:def test_pipe_real_installer_runs_local_mode(tmp_path):
tests/test_install.py:385:def test_readme_documents_pinned_install():
install.sh:50:log_add()  { printf '%s[add]%s     %s\n' "$C_GREEN"  "$C_RESET" "$1"; }
install.sh:51:log_upd()  { printf '%s[update]%s  %s\n' "$C_BLUE"   "$C_RESET" "$1"; }
install.sh:52:log_mv()   { printf '%s[move]%s    %s\n' "$C_BLUE"   "$C_RESET" "$1"; }
install.sh:53:log_skip() { printf '%s[skip]%s    %s\n' "$C_DIM"    "$C_RESET" "$1"; }
install.sh:54:log_app()  { printf '%s[append]%s  %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
install.sh:55:log_info() { printf '%s[info]%s    %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
install.sh:56:log_err()  { printf '%s[err]%s     %s\n' "$C_RED"    "$C_RESET" "$1" >&2; }
install.sh:61:usage() {
install.sh:212:copy_tree() {
install.sh:244:migrate_root_adr() {
install.sh:272:refresh_marker_block() {
install.sh:295:merge_settings() {
install.sh:324:def key(entry):
install.sh:374:flight_plugin_enabled() {
