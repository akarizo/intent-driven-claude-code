## ADDED Requirements

### Requirement: 插件版本 0.10.3
flight 插件清单的 version SHALL 为 0.10.3；description SHALL 仍含：起飞待命、按下即起飞、自愈、看门狗、续飞。

#### Scenario: plugin-version-0-10-3
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 0.10.3
- **AND** description 含起飞待命、按下即起飞、自愈、看门狗、续飞
