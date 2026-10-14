## ADDED Requirements

### Requirement: 文档写明唤醒轮
`opsx-apply` 命令与 skill、`README.md`、`docs/WORKFLOW_zh.md` 讲起飞待命的地方 SHALL 写明「唤醒轮」：
- 定时到点（等待类的检查、偶发类的重试）与看门狗停飞后的诊断，不直接派发；
- 而是由插件发一轮只回复「收到」的对话，这一轮结束时再起飞或派发；
- 原因是插件只能在处理外部事件的 hook 里派发。

#### Scenario: docs-describe-wake-turn
- **GIVEN** `template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`README.md`、`docs/WORKFLOW_zh.md`
- **WHEN** 读取这四个文件
- **THEN** 都含「唤醒轮」
- **AND** 命令与 skill 两份都含「只回复「收到」」

### Requirement: opsx-propose 命令的 description 不再写旧起飞流程
`template/.claude/commands/opsx-propose.md` 的 frontmatter description SHALL 写「按下即起飞」，SHALL NOT 写「自己发 /opsx-apply」。

Feature: PR #56 MEDIUM：这段 description 显示在斜杠命令菜单里，与正文矛盾。

#### Scenario: propose-description-current
- **GIVEN** `template/.claude/commands/opsx-propose.md`
- **WHEN** 读取其 frontmatter 的 description
- **THEN** 含「按下即起飞」，不含「自己发 /opsx-apply」

### Requirement: 插件版本 0.10.2
flight 插件清单的 version SHALL 为 0.10.2；description SHALL 仍含：起飞待命、按下即起飞、自愈、看门狗、续飞。

#### Scenario: plugin-version-0-10-2
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 0.10.2
- **AND** description 含起飞待命、按下即起飞、自愈、看门狗、续飞
