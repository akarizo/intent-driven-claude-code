# subtractive-reflex · 切片公开接口摘要

供下游切片执行体读取；重复合回时覆盖对应节。

## S1 · slice-gate G8 ceiling 判据 + 天花板汇总

文件：`template/.claude/hooks/slice-gate.py`

- `record_ceilings(change_dir, slice_id, rows)` — 把合规天花板标记汇总进 `gate-report.md` 的「天花板」表（幂等插入，不打乱既有 Gate Report 表）。
- `added_lines(root, base)` — 生成器，产出 `base..HEAD` 里新增的 `(rel_path, lineno, text)`。
- `ceiling_rows(root, base)` — 扫新增源码行的 `ceiling:` 标记，返回 `(failed, rows)`；`rows` 项为 `(rel, lineno, 限制, 升级路径)`；无标记不判红不警告。
- `_cell(text)` — 表格单元格转义（`|`→`/`，换行→空格）。
- `cmd_gate` 新增 G8 校验步骤：调用 `ceiling_rows` 追加 `failed`，并在门禁结论落盘后调用 `record_ceilings` 写回天花板表。
- 新增常量：`CEILING_RE`（匹配 `# ceiling: 限制 -> 升级路径` 形状注释）、`CEILING_SPLIT`、`CEILING_MIN=4`、`CEILING_HEAD="## 天花板"`、`CEILING_COLS`、`CEILING_SEP`、`DIFF_HUNK_RE`。

测试：`tests/test_slice_gate.py` 覆盖 4 个 scenario（ceiling-marker-passes-gate / ceiling-missing-upgrade-path / ceiling-missing-limit / no-marker-no-gate）。

## S2 · 执行体与评审员的减法契约

文件：`template/.claude/agents/slice-executor.md`

- `## 纪律` 段新增三条减法纪律（详见 agent 文件正文，未改变段落结构，仅追加约束条目）。

文件：`template/.claude/agents/code-reviewer.md`

- `## 审查 checklist` / `## 分级标准` 段新增症状修复维度（症状修复 vs 根因修复的分级判据），追加 1 行。

测试：`tests/test_agents_workflow.py`
- `test_executor_carries_subtractive_rules()` — 断言 slice-executor.md 文本携带三条减法纪律关键词。
- `test_reviewer_flags_symptom_fix()` — 断言 code-reviewer.md 携带症状修复判据关键词。
