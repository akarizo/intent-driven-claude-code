## ADDED Requirements

### Requirement: 命令、skill 与文档写清自愈与续飞
`template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md` SHALL 都写明以下要点，`README.md` 与 `docs/WORKFLOW_zh.md` SHALL 写明同样的要点：
- **自愈三种**：合回失败重派、看门狗（10 分钟）、整合修复体，预算每次飞行 3 次；
- **G9 整合护栏**：不改工件、不碰 scenario 测试、测试只增不减；
- **停飞 kind 与终端通知**；
- **诊断员**：只读，诊断只供展示；
- **批准带**：「批准修订并续飞」「续飞」，首次起飞仍是「批准起飞」加回车 `/opsx-apply`。

Feature: 仓库纪律：命令与同名 skill 同改，禁漂移。

#### Scenario: docs-describe-self-heal-and-resume
- **GIVEN** opsx-apply 命令文件、openspec-apply-change 的 SKILL.md、README.md、docs/WORKFLOW_zh.md
- **WHEN** 读取四个文件
- **THEN** 每个文件都含「自愈」「看门狗」「10 分钟」「整合修复」「G9」「诊断员」「批准修订并续飞」
- **AND** 命令文件与 SKILL.md 都含「每次飞行 3 次」与「只读」

### Requirement: 插件版本 0.9.0
`template/plugins/flight/.claude-plugin/plugin.json` 的 version SHALL 为 `0.9.0`，description SHALL 提到停飞自愈、看门狗与一键续飞。
Feature: 新增行为与判定器能力核对（integ-guard）随插件发布。

#### Scenario: plugin-version-0-9-0
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 `0.9.0`
- **AND** description 含「自愈」「看门狗」「续飞」
