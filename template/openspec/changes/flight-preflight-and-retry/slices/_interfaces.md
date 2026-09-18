# 公开接口摘要

## S1 — slice-gate：baseline 预检 + preflight + G2 基线差分 + start 幂等

`template/.claude/hooks/slice-gate.py`

- `cmd_baseline(args)` — 建 `gate-baseline.json`（test/lint/typecheck/各片 verify 基线快照）。
- `cmd_preflight(args)` — 无绿基线或基线过期时拒绝继续。
- `cmd_start(args)` — `start` 幂等，支持 `--base` 指定接续起点。
- `cmd_gate(args)` / `cmd_lint(args, print_waves=True)` — 单切片门禁；lint 用 baseline 做差分（只罚新增行）。
- `cmd_final(args)` — 全量门禁；typecheck 走 baseline 差分。
- `cmd_record(args)` / `cmd_ship(args)` — 记录切片结论 / draft↔ready 裁决。
- `load_baseline(change_dir)` / `added_lines(root, base)` / `changed_files(root, base)` — 基线加载与 diff 辅助。
- `gate_cmd_verdict(kind, cmd, root, baseline)` — 按基线判定单条 gate 命令（test/lint/typecheck）红绿。
- `ceiling_rows(root, base)` / `ceiling_rows_from_json(raw)` / `record_ceilings(...)` — G8 ceiling 天花板判据。
- `ownership_violations(files, owns, change_rel, committed=())` — 切片所有权越界检测。
- `scenario_status(root, data, slice_ids=None)` — scenario 测试骨架状态汇总。
- `timeline_record(change_dir, event, note="")` / `append_report(change_dir, result)` — 飞行记录落盘。
- `VERIFY_TOOL_RE` — 校验 `verify` 不得含 typecheck/lint 工具（tsc/eslint/ruff/mypy 等）。

`tests/test_slice_gate.py` — 覆盖以上行为的测试（无对外接口）。

## S2 — test-evidence：change 定位 标记 → 分支名 → 唯一候选 → 不写

`template/.claude/hooks/test-evidence.py`

- `find_change(root)` — 按优先级定位当前 change：`.openspec-slice` 标记 → worktree 分支名（`worktree-` 前缀）→ 唯一候选 change 目录；歧义则不写。
- `current_branch(root)` — 读当前分支名。
- `main()` — CLI 入口，解析测试运行输出并追加 evidence.log。
- `BRANCH_PREFIX = "worktree-"` — worktree 分支名前缀约定。

`tests/test_evidence_timeline.py` — 覆盖 change 定位优先级与歧义拒写的测试。

## S4 — 文档契约：pr-ship 自动修前问一次 · propose 基线红即停 · schema verify 只跑测试

- `template/.claude/commands/pr-ship.md` step 10：CRITICAL/HIGH 自动修复前唯一一次 AskUserQuestion（『自动修并 push』/『只贴评论交人』，无应答默认只贴评论）；step 11 收尾不再问询，直接打印 Output Summary。
- `template/.claude/commands/opsx-propose.md` / `template/.claude/skills/openspec-propose/SKILL.md` step 4：`baseline` 退出非 0 → 停下报告 `reasons`，不渲染不交接；verify 在基线上必须绿。
- `template/openspec/schemas/intent-driven/schema.yaml`：新增校验规则——`verify` 只能跑测试，不得含 typecheck/lint 工具（tsc/eslint/ruff/mypy 等），由 `slice-gate.py lint` 检查。
- `tests/test_template_docs.py` — 覆盖以上文档契约的测试。
