## ADDED Requirements

### Requirement: 起飞异常不落回模型，drive 接上落地且不空转
- 起飞或 drive 抛出异常时，`/opsx-apply` SHALL 由插件回复含「异常」的文本，SHALL NOT 交给命令文档。否则旧引擎会把同一个 change 再飞一遍，违反「控制面缺席即停飞」。
- drive 遇到 dispatch reviewer / fixer、final、land、halt 动作时，SHALL 交给落地逻辑执行。
- 某一轮执行完动作后，账本没有新增事件时，drive SHALL 停止，不得空转到轮数上限。
Feature: 编排的每条出路都闭合；fail-closed

#### Scenario: takeoff-exception-stays-grounded
- **GIVEN** 起飞检查全部通过，派发 agent 时抛出异常
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 插件回复含「异常」
- **AND** 命令没有交给模型

#### Scenario: drive-hands-landing-actions
- **GIVEN** S1 门禁绿，合回成功
- **WHEN** 处理 S1 执行体的结束
- **THEN** 以 flight:reviewer 派发评审员，cwd 为 change worktree
- **AND** 账本追加 role 为 reviewer、slice 为 S1 的 dispatch

#### Scenario: drive-stops-without-progress
- **GIVEN** 账本写入总是失败（`update-ref` 一直旧值不符）
- **WHEN** 处理一个执行体的结束
- **THEN** drive 读账本不超过 2 次就停止
