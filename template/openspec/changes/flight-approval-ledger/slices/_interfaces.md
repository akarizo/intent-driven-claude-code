# 公开接口摘要

## S1
### template/.claude/hooks/plan_fp.py
23:class PlanError(Exception):
27:def plan_files(change_dir):
43:def normalize(rel, raw):
54:def plan_fingerprint(change_dir):
72:def main(argv=None):
### template/.claude/hooks/spec_html.py
50:def now_iso(now_arg):
59:def read_text(path):
66:def esc(s):
70:def inline_md(text):
77:def split_sections(text, level="##"):
95:def paragraphs(text):
99:def list_items(text):
108:def substitute_block(html_text, name, content):
118:def render_why(proposal_text):
131:def render_what(proposal_text):
150:def render_capabilities(proposal_text):
177:def render_scenario(name, body):
188:def render_requirement(heading, body):
202:def render_specs(change_dir):
232:def extract_diagrams(design_text):
247:def render_diagrams(design_text):
261:def strip_mermaid(text):
265:def render_generic_md(text):
284:def render_design(design_text):
312:def project_root(change_dir):
317:def scan_adrs(change_dir):
357:def render_tasks(tasks_text):
387:def compute_waves(slices):
401:def find_def_line(lines, func):
412:def decorator_source(source, func):
425:def scenario_flight_status(root, rel, func):
451:def gate_report_passed_slices(change_dir):
467:def load_timeline_rows(change_dir):
482:def render_flight(change_dir):
546:def compute_meta_chips(change_dir, change_name):
590:def render_footer(now, section_count, diagram_count, task_count):
602:def render(change_dir, template_path, out_path, now_arg):
653:def main():

## S2
### template/.claude/hooks/ledger.py
19:class LedgerInvalid(Exception):
26:def ref_for(change):
30:def _git(change_dir, *args, check=True):
37:def _check_event(sha, ev, change):
55:def read_events(change_dir):
87:def latest_approval(change_dir):
98:def main(argv=None):

## S3

- `template/plugins/flight/hooks/register.tsx`：`export const register: Register = on => {...}`，flight 插件入口，注册 hook 并刷新/追加审批账本
- `template/plugins/flight/hooks/hooks.json`、`.claude-plugin/plugin.json`：插件清单
- `template/plugins/flight/types/index.d.ts`：引擎类型声明
