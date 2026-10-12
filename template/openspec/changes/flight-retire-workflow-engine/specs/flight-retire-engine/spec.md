## ADDED Requirements

### Requirement: 旧引擎文件删除
`template/.claude/workflows/opsx-apply.js`、`template/.claude/agents/integrator.md`、`template/.claude/agents/slice-executor.md` SHALL 删除。
Feature: DRAFT-flight-orchestrator-state-machine：旧引擎与 integrator 在后续 change 删除

#### Scenario: old-engine-files-removed
- **GIVEN** 本 change 合入后的模板
- **WHEN** 检查这三个路径
- **THEN** 三个文件都不存在

### Requirement: 插件拒绝 --engine=workflow
`/opsx-apply <change> --engine=workflow` SHALL 由插件直接作答拒绝，答复含「旧 Workflow 引擎已删除」与 `DRAFT-flight-single-implementation`，SHALL NOT 交给模型、SHALL NOT 写任何账本事件。
Feature: BREAKING：旧引擎入口关闭，明确拒绝而不是静默忽略参数照常起飞

#### Scenario: engine-workflow-refused
- **GIVEN** demo 已批准、工作区干净
- **WHEN** 人发出 `/opsx-apply demo --engine=workflow`
- **THEN** 插件作答含「旧 Workflow 引擎已删除」与 `DRAFT-flight-single-implementation`
- **AND** 命令没到达模型，账本没有新事件

### Requirement: --gate=per-task 照旧透传
`/opsx-apply <change> --gate=per-task` SHALL 照旧交给模型（legacy 路径），插件 SHALL NOT 起飞、SHALL NOT 写事件。
Feature: 护栏：删除旧引擎不得误伤唯一的非飞行路径（base 上已成立）

#### Scenario: per-task-passes-through
- **GIVEN** demo 已批准、工作区干净
- **WHEN** 人发出 `/opsx-apply demo --gate=per-task`
- **THEN** 命令交给了模型（插件不作答）
- **AND** 账本没有新事件
