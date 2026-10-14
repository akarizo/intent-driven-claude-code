## ADDED Requirements

### Requirement: 命令与 skill 写明「搁置」
`template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md` SHALL 同改：都写明批准带的「搁置」（不再显示、不能起飞、改动计划后重新出现），并在「批准指纹」一行写明「已搁置」也不起飞；SHALL NOT 再写「四个按钮都按下即起飞」。

#### Scenario: docs-describe-shelve
- **GIVEN** `opsx-apply.md` 与 `openspec-apply-change/SKILL.md`
- **WHEN** 读取两份全文
- **THEN** 两份都含「「搁置」」「改动计划后重新出现」与「已搁置」
- **AND** 两份都不含「四个按钮都按下即起飞」

### Requirement: 插件补丁版本升级
插件清单 `template/plugins/flight/.claude-plugin/plugin.json` 的 version SHALL 高于 0.10.2，description SHALL 含「搁置」。

#### Scenario: plugin-version-bumped
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 按数字逐段比较高于 0.10.2
- **AND** description 含「搁置」
