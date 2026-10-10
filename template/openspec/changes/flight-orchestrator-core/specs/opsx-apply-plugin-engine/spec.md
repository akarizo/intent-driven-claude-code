## ADDED Requirements

### Requirement: 命令与 skill 写明插件接管
`/opsx-apply` 的命令文档 `opsx-apply.md` 与同名 skill `openspec-apply-change/SKILL.md` SHALL 在开头写明以下三点，两份文档同改：
1. 装了 flight 插件（0.2.0 及以上）时，`/opsx-apply` 由插件的状态机执行；起飞检查与整个飞行都不经模型，模型不执行文档里的步骤。
2. 只有人显式加 `--engine=workflow` 时，才由模型按文档步骤用旧的 Workflow 引擎飞；插件不会自动回退到旧引擎。
3. 插件缺席即停飞：没有插件，批准无从写入账本，`takeoff-gate.py` 必然拒绝。
Feature: 文档与实际执行者一致，不让模型以为自己要手走 step 0–7

#### Scenario: apply-docs-describe-plugin-engine
- **GIVEN** `opsx-apply.md` 与 `openspec-apply-change/SKILL.md`
- **WHEN** 读两份文档在第一个步骤之前的部分
- **THEN** 两份都含「插件」与「状态机」，都含 `--engine=workflow`，都含「停飞」
- **AND** 两份都写明插件不会自动回退到旧引擎
