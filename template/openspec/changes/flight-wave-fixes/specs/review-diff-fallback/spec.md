## ADDED Requirements

### Requirement: 取 diff 失败不等于无变更
`/pr-ship` step 8 给评审员的 prompt 与 `code-reviewer` 的评审流程 SHALL 区分三种情况：diff 确实为空 → 报告「无变更」并停止；首选命令（`gh pr diff` / `glab mr diff`）拉取失败 → 改用 `git fetch origin <target>` 之后的 `git diff origin/<target>...HEAD`；两种都拉不到 → 报告「取 diff 失败」并停止，SHALL NOT 报告「无变更」。
Feature: 大 PR（diff 超过 2 万行）的 `gh pr diff` 会被 GitHub 以 HTTP 406 拒绝
Rule: 独立评审必有（铁律 4），评审不能因取不到 diff 而静默跳过

#### Scenario: pr-ship-review-falls-back-to-local-diff
- **GIVEN** `template/.claude/commands/pr-ship.md`
- **WHEN** 读取 step 8（呼叫 code-reviewer 评审 diff）
- **THEN** 该段含回退命令 `git diff origin/<target>...HEAD` 与「取 diff 失败」
- **AND** 不再出现「为空或拉不到」这种合并写法

#### Scenario: reviewer-distinguishes-empty-and-unreachable
- **GIVEN** `template/.claude/agents/code-reviewer.md`
- **WHEN** 读取「评审流程」段
- **THEN** 该段同时含「无变更」（diff 为空时）与「取 diff 失败」（拉不到时）
- **AND** 不再出现「为空或拉不到」这种合并写法
