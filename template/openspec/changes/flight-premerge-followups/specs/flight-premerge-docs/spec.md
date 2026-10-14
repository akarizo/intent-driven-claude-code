## ADDED Requirements

### Requirement: 文档写明预合并、重验与计划需修订
`template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md` SHALL 同改，都写明：落地前预合并目标分支（冲突交解冲突 agent、解不开停飞）、`/flight recheck`、「计划需修订」。`template/plugins/flight/commands/pr-ship.md` 第 4 步 SHALL 写明飞行内已预合并、落地后又有冲突时人解完发 `/flight recheck`。

#### Scenario: docs-describe-premerge
- **GIVEN** `opsx-apply.md`、`openspec-apply-change/SKILL.md` 与 `template/plugins/flight/commands/pr-ship.md`
- **WHEN** 读取三份全文
- **THEN** 前两份都含「预合并」「/flight recheck」「计划需修订」
- **AND** pr-ship.md 含「/flight recheck」

### Requirement: 插件 0.12.0
插件清单的 version SHALL 不低于 0.12.0，description SHALL 含「预合并」。

#### Scenario: plugin-version-0-12-0
- **GIVEN** `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 按数字逐段比较不低于 0.12.0
- **AND** description 含「预合并」
