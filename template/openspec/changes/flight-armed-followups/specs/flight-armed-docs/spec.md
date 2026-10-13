## ADDED Requirements

### Requirement: 文档不再写「按批准起飞后再发命令」
以下文件 SHALL 不再含这些表述：「后自己发出」「后重新发出」「人发 /opsx-apply」。
- `opsx-propose` 命令与 `openspec-propose` 的 SKILL.md 开头概述；
- `opsx-apply` 命令与 `openspec-apply-change` 的 SKILL.md 的「批准指纹」条；
- `README.md` 与 `docs/WORKFLOW_zh.md` 的流程图。

这些位置 SHALL 改为「在批准带按『批准起飞』即起飞」的说法。

Feature: 仓库纪律：命令与同名 skill 同改。PR #54 的三条 MEDIUM 都是 0.10.0 改成按下即起飞后漏改的残留。

#### Scenario: docs-say-press-takes-off-everywhere
- **GIVEN** 六个文件：opsx-propose 命令与 skill、opsx-apply 命令与 skill、README.md、docs/WORKFLOW_zh.md
- **WHEN** 读取它们
- **THEN** 都不含「后自己发出」「后重新发出」「人发 /opsx-apply」
- **AND** 都含「按下即起飞」

### Requirement: 插件版本 0.10.1
`template/plugins/flight/.claude-plugin/plugin.json` 的 version SHALL 为 `0.10.1`。

`tests/test_armed_docs.py::test_plugin_version_0_10_0` 写死了 `0.10.0`，SHALL 改为断言版本不低于 0.10.0（按数字逐段比较）；它对 description 的断言照旧。

Feature: 用户定 Q6：本次只修缺陷与补测试，用补丁号。吸取 #54 的教训：升版本前先找写死旧版本号的用例。

#### Scenario: plugin-version-0-10-1
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 `0.10.1`
- **AND** description 仍含「起飞待命」「按下即起飞」「自愈」「看门狗」「续飞」
