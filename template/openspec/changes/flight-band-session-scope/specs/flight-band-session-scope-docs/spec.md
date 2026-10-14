## ADDED Requirements

### Requirement: 文档写明批准带只显示本会话认领的 change
opsx-apply 的命令与 skill、opsx-propose 的命令与 skill、`README.md`、`docs/WORKFLOW_zh.md` SHALL 写明批准带只显示本会话认领的 change，以及认领方法：本会话写过其目录，或人发的 `/opsx-*`、`/flight` 命令点名过它；只读不算；认领只在本进程内有效。opsx-propose 的命令与 skill 交接给人时，SHALL 把「批准带没出现」的处理写成先发 `/opsx-apply <name>`、仍不出现才是未装插件，不再直接断言「未装 flight 插件」。
Feature: 人知道批准带为什么没出现、怎样让它出现

#### Scenario: docs-describe-session-scope
- **GIVEN** `template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`template/.claude/commands/opsx-propose.md`、`template/.claude/skills/openspec-propose/SKILL.md`、`README.md`、`docs/WORKFLOW_zh.md`
- **WHEN** 读取这六个文件
- **THEN** 都含「本会话认领」
- **AND** opsx-propose 的命令与 skill 都含「批准带没出现：先发 `/opsx-apply <name>`」，都不含「批准带没出现 = 未装 flight 插件」

### Requirement: 插件版本 0.11.0
flight 插件清单的 version SHALL 为 0.11.0；description SHALL 仍含：起飞待命、按下即起飞、自愈、看门狗、续飞，并含「本会话认领」。

#### Scenario: plugin-version-0-11-0
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 0.11.0
- **AND** description 含起飞待命、按下即起飞、自愈、看门狗、续飞、本会话认领
