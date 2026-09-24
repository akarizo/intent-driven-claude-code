## ADDED Requirements

### Requirement: evidence 写入目标要么确定，要么不写
`test-evidence.py` 定位 change 目录 SHALL 依次尝试：根目录 `.openspec-slice` 标记 → 当前分支名形如 `worktree-<name>` 且 `openspec/changes/<name>` 存在 → `openspec/changes/*/tasks.md` 仍有未勾选项的 change **恰好一个**；三者都不成立时 MUST NOT 写任何文件。
Feature: 多活跃 change 的仓库里留痕不再落错目录
Rule: 宁缺毋错

#### Scenario: evidence-resolves-change-from-branch
- **GIVEN** 根目录没有标记；当前分支为 `worktree-c`；`openspec/changes/c` 与 `openspec/changes/a` 都存在且两者的 `tasks.md` 都有未勾选项（`a` 按字母序在前）
- **WHEN** 一条命令为 `python3 -m pytest -q tests` 的 PostToolUse Bash 事件进入 hook
- **THEN** `openspec/changes/c/evidence.log` 追加一行，切片列为 `-`
- **AND** `openspec/changes/a/evidence.log` 不存在

#### Scenario: evidence-refuses-ambiguous-change
- **GIVEN** 根目录没有标记；当前分支为 `main`；`openspec/changes/a` 与 `openspec/changes/b` 的 `tasks.md` 都有未勾选项
- **WHEN** 同样的测试命令事件进入 hook
- **THEN** 两个 change 目录下都不存在 `evidence.log`
- **AND** hook 退出码为 0（fail-open 不变）

#### Scenario: evidence-single-candidate-fallback
- **GIVEN** 根目录没有标记；当前分支为 `main`；只有 `openspec/changes/a` 的 `tasks.md` 有未勾选项
- **WHEN** 同样的测试命令事件进入 hook
- **THEN** `openspec/changes/a/evidence.log` 追加一行（单候选回退保留）
- **AND** 有标记时仍以标记为准，切片列取标记里的 `slice`
