## ADDED Requirements

### Requirement: 评审员看的是切片相对第一父的改动
控制面交给评审员的 commit 是 `--no-ff` 合并提交；对没有冲突的合并提交，`git show <commit>` 不输出 diff。评审员提示词与 reviewer 定义 SHALL 用 `git diff <commit>^1 <commit>` 取改动。取不到 diff 或 diff 为空时，SHALL 要求评审员提交一条 severity 为 HIGH 的 finding，说明「取 diff 失败」，SHALL NOT 提交空列表放行。
Feature: 评审员看到空 diff 就放行，等于独立评审失效（铁律 4）

#### Scenario: prompts-reviewer-diffs-against-first-parent
- **GIVEN** S1 合回后的合并提交 c1
- **WHEN** 生成评审员提示词
- **THEN** 含 `git diff c1^1 c1`
- **AND** 不含 `git show c1`

#### Scenario: reviewer-body-treats-missing-diff-as-high
- **GIVEN** `template/plugins/flight/agents/reviewer.md`
- **WHEN** 读它的正文
- **THEN** 含 `^1`、「取 diff 失败」与 HIGH
- **AND** 不含 `git show`
