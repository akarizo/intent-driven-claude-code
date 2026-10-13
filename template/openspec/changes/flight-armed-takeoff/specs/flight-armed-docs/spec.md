## ADDED Requirements

### Requirement: 命令、skill 与文档写清起飞待命与按下即起飞
`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`README.md` 与 `docs/WORKFLOW_zh.md` SHALL 都写明：
- **起飞待命**：被拒后插件按原因等待、重试或交给模型修；最多 3 次，30 分钟内有效；`/flight abort <change>` 可取消；
- **批准带按下即起飞**：「批准起飞」「起飞」「批准修订并续飞」「续飞」都按下即起飞，不再回车；
- **终端通知**：停飞时发通知，人工中止除外。

`template/.claude/commands/opsx-propose.md` 与 `template/.claude/skills/openspec-propose/SKILL.md` 的交接 SHALL 改为「在批准带按『批准起飞』即起飞」，SHALL NOT 再写「回车发出预填」。

Feature: 仓库纪律：命令与同名 skill 同改，禁漂移。修 PR #53 的文档与实现不符（MEDIUM），以及 README / WORKFLOW 漏写「人工中止不通知」（LOW）。

#### Scenario: docs-describe-armed-takeoff
- **GIVEN** 六个文件：
  - `opsx-apply` 命令文件、`openspec-apply-change` 的 SKILL.md；
  - `README.md`、`docs/WORKFLOW_zh.md`；
  - `opsx-propose` 命令文件、`openspec-propose` 的 SKILL.md
- **WHEN** 读取它们
- **THEN** 前四个都含「起飞待命」「按下即起飞」「最多 3 次」「30 分钟」「/flight abort」
- **AND** `README.md` 与 `docs/WORKFLOW_zh.md` 都含「人工中止除外」
- **AND** 后两个都含「按下即起飞」，都不含「回车发出预填」

### Requirement: 插件版本 0.10.0
`template/plugins/flight/.claude-plugin/plugin.json` 的 version SHALL 为 `0.10.0`，description SHALL 提到起飞待命与按下即起飞，并保留「自愈」「看门狗」「续飞」。

flight-unattended 留下的 `tests/test_unattended_docs.py::test_plugin_version_0_9_0` 写死了 `0.9.0`，SHALL 改为断言版本不低于 0.9.0（按数字逐段比较）；它对 description 的断言照旧。

Feature: 新增行为随插件发布。

#### Scenario: plugin-version-0-10-0
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 `0.10.0`
- **AND** description 含「起飞待命」与「按下即起飞」
