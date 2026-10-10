## ADDED Requirements

### Requirement: 命令、skill 与 ADR 写明飞行中的权限边界
`/opsx-apply` 命令与同名 skill 在第一个步骤之前的部分 SHALL 都写明：飞行 agent 的写入限于角色包络；Bash 只对门禁 / verify 命令等白名单免询问，其余按用户的权限设置；飞行中主会话对在飞的 change worktree 只读，且写明它是尽力而为。仓库 SHALL 有 ADR `DRAFT-flight-capability-envelope`，状态为 accepted，并关联 `DRAFT-flight-orchestrator-state-machine`。
Feature: 命令与同名 skill 同改，禁漂移；权限边界是架构决策，需要 ADR 留档

#### Scenario: docs-state-envelope
- **GIVEN** `opsx-apply.md`、`openspec-apply-change/SKILL.md` 与 `template/openspec/adr/`
- **WHEN** 读两份文档在第一个步骤之前的部分，以及 ADR 目录
- **THEN** 两份文档都含「包络」「白名单」「只读」「尽力」
- **AND** `DRAFT-flight-capability-envelope.md` 存在，含「Status: accepted」与「DRAFT-flight-orchestrator-state-machine」
