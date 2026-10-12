## ADDED Requirements

### Requirement: /flight:pr-ship 飞行模式交给 ship 工具
`/flight:pr-ship` 第 7 步（创建 PR/MR）SHALL 写明飞行模式（有 `slices.json`）一律带 `--draft` 建 PR，建完调用 `ship` 工具交出 change 名与 PR 号，由插件裁决、贴评论、切换 draft / ready。第 7 步 SHALL NOT 出现 `gh pr ready`。第 8、9、10 步的标题 SHALL 都标明只用于飞行外。全文 SHALL 写明飞行外 PR 的正文要标「非账本裁决」，并且 SHALL NOT 再要求模型改写 `review-findings.json` 的 `blocking`。
Feature: 用户定（2026-10-13）：C3-A · C4-A

#### Scenario: pr-ship-flight-mode-uses-ship-tool
- **GIVEN** `template/plugins/flight/commands/pr-ship.md`
- **WHEN** 切出第 7 步，并取第 8、9、10 步的标题行
- **THEN** 第 7 步含「飞行模式」、`--draft` 与「`ship` 工具」，不含 `gh pr ready`
- **AND** 第 8、9、10 步的标题行都含「飞行外」
- **AND** 全文含「非账本裁决」，不含「只更新 `review-findings.json` 的 `blocking`」

### Requirement: apply 文档写明全量评审与账本裁决
`/opsx-apply` 命令与 `openspec-apply-change` skill SHALL 写明三件事：final 之后控制面派全量评审；CRITICAL/HIGH 自动修，至多 2 轮并复核；落地后由 `ship` 工具按账本裁决。两份文档里「**来源规则**」SHALL 各只出现一次。README 与 `docs/WORKFLOW_zh.md` SHALL 写明全量评审与「按账本裁决」。
Feature: 用户定（2026-10-13）：C1-A · C2-A · C3-A；#51 评审 LOW

#### Scenario: apply-docs-describe-whole-review
- **GIVEN** `opsx-apply.md`、`openspec-apply-change/SKILL.md`、`README.md`、`docs/WORKFLOW_zh.md`
- **WHEN** 逐份查找关键词
- **THEN** 四份都含「全量评审」与「按账本裁决」
- **AND** 两份 apply 文档都含「至多 2 轮」「复核」与「`ship` 工具」
- **AND** 两份 apply 文档里「**来源规则**」都恰好出现一次
