## ADDED Requirements

### Requirement: 文档写明 /flight 的用法
`/opsx-apply` 命令、`openspec-apply-change` skill 与 README SHALL 写明 `/flight status`、`/flight panel`、`/flight abort`、`/flight resume` 的用法，以及起飞时自动打开面板、abort 只停本会话起飞的飞行。
Feature: 命令与同名 skill 同改，禁漂移

#### Scenario: docs-describe-flight-commands
- **GIVEN** 本 change 合入后的 opsx-apply.md、openspec-apply-change/SKILL.md 与 README.md
- **WHEN** 逐份读取
- **THEN** 都含 `/flight status`、`/flight panel`、`/flight abort`、`/flight resume`
- **AND** 命令与 skill 都含「面板」与「本会话」

### Requirement: /opsx-apply 的 Guardrails 与 skill 一致
`/opsx-apply` 命令 SHALL NOT 再写「PreToolUse hook」作为起飞批准的强制点，与同名 skill 一致。
Feature: #49 评审 MEDIUM：hook 模式已退役，命令文档仍声称它

#### Scenario: apply-guardrails-consistent
- **GIVEN** 本 change 合入后的 opsx-apply.md 与 openspec-apply-change/SKILL.md
- **WHEN** 逐份读取
- **THEN** 都不含「PreToolUse hook」
- **AND** 都含 `takeoff-gate`

### Requirement: 读到即停飞先区分是否发过 /opsx-apply
命令与 skill 的「模型读到本命令即停飞」一段 SHALL 先区分本轮是否发过 `/opsx-apply`：没有（如用户用自然语言触发了 skill）时 SHALL 提示人发出 `/opsx-apply <name>`，而不按插件缺席处理。
Feature: #49 评审 MEDIUM：自然语言触发 skill 时会误判插件缺席

#### Scenario: apply-skill-natural-language-trigger
- **GIVEN** 本 change 合入后的 opsx-apply.md 与 openspec-apply-change/SKILL.md
- **WHEN** 各取「即停飞」一段
- **THEN** 都含「自然语言」与「/opsx-apply <name>」

### Requirement: 安装器提醒退役文件不受保护
`install.sh` 列出退役文件时 SHALL 写明它们仍可被调用、且不再受起飞批准拦截，提示尽快删除。
Feature: #49 评审 MEDIUM：升级后到人删除退役文件之前的保护空档

#### Scenario: install-warns-retired-files-unprotected
- **GIVEN** 一个已装旧版模板、`.claude/workflows/opsx-apply.js` 仍在的目标项目
- **WHEN** 以升级方式运行 `install.sh`
- **THEN** 输出列出 `.claude/workflows/opsx-apply.js`
- **AND** 输出含「仍可被调用」与「不再受起飞批准」
