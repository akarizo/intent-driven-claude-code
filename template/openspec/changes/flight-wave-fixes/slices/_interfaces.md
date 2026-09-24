# 接口摘要（integrator 合回后自动生成，重复合回覆盖对应节）

## S1 — template/.claude/hooks/slice-gate.py（切片门禁核心逻辑）

- `now_iso()` — 当前 UTC ISO 时间戳
- `die(msg, code=2)` — 打印错误并退出
- `git(root, *args)` — 在 root 下跑 git 子命令
- `toplevel(cwd=None)` — 取 git 仓库根
- `load_plan(change_dir)` / `save_plan(change_dir, data)` — 读写 slices.json
- `run_cmd_full(cmd, cwd)` / `run_cmd(cmd, cwd)` — 跑命令并取输出
- `_tail(out)` — 截断输出尾部
- `normalize_lines(text)` — 行归一化（用于 diff 比对）
- `plan_sha(data)` — 计划内容哈希
- `load_baseline(change_dir)` — 读门禁基线
- `gate_cmd_verdict(kind, cmd, root, baseline)` — 判定某类门禁命令通过/失败
- `glob_match(path, pattern)` / `globs_intersect(a, b)` — glob 匹配 / 交集判断（切片 owns 冲突检测）
- `compute_waves(slices)` — 按依赖分波
- `lint_plan(data)` — 切片计划静态校验
- `timeline_record(change_dir, event, note="")` — 写 timeline.md
- `append_report(change_dir, result)` — 写 gate-report.md
- `_cell(text)` / `ceiling_rows_from_json(raw)` / `record_ceilings(change_dir, slice_id, rows)` — G8 减法天花板判据落记
- `evidence_state(change_dir, slice_id)` — 读 evidence.log 状态
- `report_has_row(change_dir, slice_id, commit)` — 幂等判重
- `is_test_path(path)` / `is_doc_or_config(path)` — 文件分类
- `changed_files(root, base)` / `added_lines(root, base)` / `ceiling_rows(root, base)` — diff 相关统计
- `gwt_violations(root, test_files)` — 测试骨架 GWT 格式校验
- `_py_test_bodies(lines)` / `_test_bodies(rel, lines)` / `_py_decorators(source, func)` — 测试体解析
- `ownership_violations(files, owns, change_rel, committed=())` — 切片越界写判定
- `scenario_status(root, data, slice_ids=None)` — scenario 完成状态
- `detect_test_cmd(root)` — 探测测试命令
- 子命令实现：`cmd_lint`、`cmd_start`、`cmd_gate`、`cmd_record`（本轮新增：把并行切片门禁 JSON 幂等写回 gate-report.md/timeline.md）、`cmd_final`、`cmd_baseline`、`cmd_preflight`、`cmd_ship`
- `report_latest(change_dir)` / `_final_fresh(root, change_dir, final_commit)` — final gate 新鲜度校验
- `main()` — CLI 入口，子命令分派：lint/waves/final/baseline/preflight/start/gate/record/ship

## S2 — template/.claude/workflows/opsx-apply.js（飞行工作流编排脚本）

- 入参解构：`{ change, changeDir, hooksDir, waves, useAgentTypes }`，可选 `agentsDir` / `branch` / `deps` / `models` / `efforts`（本轮新增 `efforts` 默认 `{ executor: 'high', reviewer: 'high', integrator: 'low' }`，按角色显式路由模型 effort）
- `typed(name)` — 按 useAgentTypes 决定是否附带 agentType
- `rules(name)` — 生成"先读 agent 定义"提示片段
- `gateCmd(s)` / `startCmd(s, base)` — 拼装 slice-gate 子命令行
- `GATE` / `FINDINGS` / `MERGE` — 结构化常量（门禁/评审发现/合回相关）
- `executorPrompt(s, retryOf)` — 执行体派发 prompt
- `reviewPrompt(s, gate)` — 评审员派发 prompt
- `findings` / `blocking` / `deferred` — 评审发现按严重度分流（CRITICAL/HIGH 阻断）
- 依赖 template/.claude/agents/slice-executor.md、integrator.md 的角色定义（本轮同步更新）

## S3 — 文档同名改动（commands / skills / agents，无代码接口）

- `template/.claude/commands/opsx-apply.md` — /opsx-apply 命令文档
- `template/.claude/skills/openspec-apply-change/SKILL.md` — apply 技能说明
- `template/.claude/commands/pr-ship.md` — /pr-ship 命令文档
- `template/.claude/agents/code-reviewer.md` — 评审员角色定义
- 本轮改动为命令与 skill 描述同步纠偏，无导出函数签名

## S4 — install.sh / template/openspec/.gitignore（安装脚本与忽略规则）

- `log_add()` / `log_upd()` / `log_mv()` / `log_skip()` / `log_app()` / `log_info()` / `log_err()` — 带颜色日志输出
- `usage()` — 打印用法
- `copy_tree()` — 复制模板目录树
- `migrate_root_adr()` — 迁移根级 ADR
- `refresh_marker_block()` — 刷新标记块
- `merge_settings()` — 合并 settings.json
- `template/openspec/.gitignore` — 新增忽略规则（飞行记录等临时产物）
