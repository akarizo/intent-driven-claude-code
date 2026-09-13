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

## S3

`template/.claude/hooks/hooks.json` — hook 注册表，新增飞行相关 hook 挂载点（键：`hooks`）。

`template/.claude/commands/opsx-apply.md` — `/opsx-apply` 命令：飞行模式 apply，批准后从门禁 lint 直跑到 PR，中途不问，模型按角色显式路由。
- **Input**：可选 change 名；`--gate=per-task` 走 legacy 逐 task 守门；`--model=<alias>` 人工指定主模型别名。
- **Steps** / **Guardrails** 两节为主体流程与护栏。

`template/.claude/commands/opsx-explore.md` — `/opsx-explore` 命令：探索阶段，节：The Stance / What You Might Do / OpenSpec Awareness / What You Don't Have To Do / Ending Discovery / Guardrails。

`template/.claude/commands/opsx-propose.md` — `/opsx-propose` 命令：一次成稿生成 change 全部工件（含切片计划），收尾交人类审批 spec.html。
- **Input**：change 名或自然语言描述。
- **Steps** / **Output** / **Artifact Creation Guidelines** / **Guardrails**。

`template/.claude/skills/openspec-explore/SKILL.md` — 与 opsx-explore 命令同步的 skill 版本，节结构一致（含 Handling Different Entry Points / What We Figured Out）。

`template/.claude/skills/openspec-apply-change/SKILL.md` — 与 opsx-apply 命令同步的 skill：Implement tasks using flight mode。
- 依赖 sub-skill `openspec-git-discipline`（Worktree Isolation）。
- **Steps** / **Guardrails** / **Fluid Workflow Integration**。

`template/.claude/skills/openspec-propose/SKILL.md` — 与 opsx-propose 命令同步的 skill：Propose a new change with all artifacts in one step。
- 依赖 sub-skill `openspec-git-discipline`（Worktree Isolation）。
- **Steps** / **Output** / **Artifact Creation Guidelines** / **Guardrails**。

`tests/test_template_docs.py` — 命令/skill 同步与门禁文档断言测试。
- `read(path)` — 读文件辅助
- `test_apply_command_zero_prompts()` / `test_pr_ship_single_review()` / `test_schema_tasks_produce_slices()` / `test_propose_command_triggers()` / `test_command_skill_sync()` / `test_git_discipline_wave_parallel_carveout()` / `test_apply_resolves_main_model()` / `test_pr_ship_resolves_main_model()` / `test_apply_checks_approval_gate()` / `test_explore_command_states_boundary()` / `test_apply_command_documents_handshake()` / `test_propose_prints_takeoff_command()`

## S4

`CLAUDE.md` — 仓库根记忆：铁律条款更新（起飞两段式握手、模型显式路由等，见第 6/7/11 条）。

`template/CLAUDE.md.snippet` — 模板下发给下游仓库的 CLAUDE.md 片段，随根 CLAUDE.md 铁律同步微调。

`README.md` — 顶层说明文档，新增飞行模式相关介绍段落。

`docs/WORKFLOW_zh.md` — 工作流中文文档，新增飞行模式相关流程说明段落。

`tests/test_docs_iron_rules.py` — 文档铁律断言测试。
- `read(rel)` — 读文件辅助
- `before_legacy(text)` — 截取 legacy 分支之前的正文
- `test_claudemd_iron_rules()` / `test_docs_updated()` / `test_legacy_mode_optional()` / `test_docs_state_mechanical_resolution()` / `test_iron_rule_records_handshake()`
