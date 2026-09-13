## S1

`template/.claude/hooks/takeoff-gate.py` — 起飞门禁：区分「发起」与「确认」两段式握手。

- `classify(text, change_name)` — 对人类消息分类：发起 / 确认 / 其它
- `verdict(change_dir, session)` — 主判定入口：批准成立与否
- `human_text(row)` — 从转录行提取人类消息文本
- `scan_human(path, change_name)` — 扫描转录取最后一条人类消息
- `plan_mtime(change_dir)` — 计划工件（proposal.md/design.md/slices.json）最大 mtime
- `model_line(session)` — 生成「当前主模型」提示行
- `scale_line(change_dir)` — 生成「切片数/wave 数」提示行
- `worktree_of(change_dir)` — 向上找含 .git 的 worktree 绝对路径
- `block_message(change_dir, session, head)` — 拼装停下时一次给全的提示文本
- `emit_deny(reason)` — 输出拒绝并 exit `EXIT_NO_APPROVAL`
- `find_change_dir(payload)` — 从 payload 定位 change_dir
- `is_takeoff_dispatch(payload)` — 判断是否为起飞类工具派发
- `run_hook(raw)` / `run_cli(args)` / `main(argv=None)` — hook 入口 / CLI 入口 / 总入口
- `locate_hook(payload)` / `locate_cli(session_arg)` / `locate_by_sid(sid)` — 会话定位
- `session_model_module()` — 惰性导入 session-model.py（复用 `alias_of`）
- `summarize(text)` / `iso(dt)` / `parse_ts(value)` — 文本摘要 / 时间格式化工具
- 常量：`EXIT_NO_APPROVAL=3`、`WORD_LIMIT=40`、`SUMMARY_LIMIT=40`、`PLAN_FILES`、`APPLY_CMD_RE`、`APPROVE_WORD_RE`、`CHANGE_PATH_RE`、`WORKTREE_RE`、`DISPATCH_TOOLS`、`TAKEOFF_AGENTS`、`NON_HUMAN_MARKERS`

## S2

`template/.claude/hooks/phase-gate.py` — 阶段门禁：约束编辑类工具只能在 opsx 命令派发的阶段内使用。

- `violation(payload)` — 判断当前 payload 是否违反阶段约束
- `current_phase(path)` — 读取当前阶段标记
- `human_text(row)` — 从转录行提取人类消息文本
- `run_hook(raw)` / `main()` — hook 入口 / 总入口
- `emit_deny(reason)` — 输出拒绝
- 常量：`EDIT_TOOLS=("Write","Edit")`、`FLIGHT_PLAN_RE`、`OPSX_CMD_RE`、`NON_HUMAN_MARKERS`

