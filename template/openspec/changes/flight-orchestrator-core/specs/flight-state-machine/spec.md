## ADDED Requirements

### Requirement: 状态由账本事件推出，动作由纯函数决定
插件的状态机核心 SHALL 是两个不调用任何 `$` 接口的纯函数：
- 一个从账本事件序列推出飞行状态；
- 一个从状态、计划（waves、deps）和当前计划指纹给出下一批动作。

动作只有这几类：派发 agent（executor / reviewer / fixer / resolver）、跑门禁、合回、跑 final、落地、停飞、记阻断。依赖了已阻断切片的切片 SHALL 直接记阻断（infra），SHALL NOT 派发。
Feature: 可信计算基里最容易出错的部分是纯函数，可以穷举测试

#### Scenario: core-dispatches-first-wave
- **GIVEN** 计划 waves 为 [[S1, S2], [S3]]，S3 依赖 S1
- **AND** 账本只有 approve 与 attempt 1 的 takeoff
- **WHEN** 求下一批动作
- **THEN** 恰为派发 S1 与 S2 的执行体
- **AND** 没有任何关于 S3 的动作

#### Scenario: core-blocks-dependents-of-blocked
- **GIVEN** 计划同上
- **AND** attempt 1 里 S1 已记 blocked（gate），S2 已合回
- **WHEN** 求下一批动作
- **THEN** 含一条 S3 的阻断，kind 为 infra，原因含「依赖已 blocked：S1」
- **AND** 不派发 S3

### Requirement: 收口门禁的续修上限与未收口兜底
执行体每次收口都有一条门禁结论，状态机 SHALL 按下面的规则决定续修、放行、补跑门禁或重派。结论为红时：
- 该 agent 已被续修的次数少于 2，状态机 SHALL 判「续修」，带上 failed 项；
- 否则 SHALL 判「放行收口」，agent 结束后切片记 blocked（gate）。

执行体结束时本轮没有任何收口门禁结论（如撞 maxTurns）：
- 状态机 SHALL 先给出「跑该切片门禁」的动作；
- 门禁红且该切片在本次飞行里还没有兜底重派过，SHALL 在同一切片 worktree 上重派执行体（续接）；
- 否则 SHALL 记 blocked。
Feature: 同一 agent 带着上下文续修，比冷启动重派便宜；但次数有上限

#### Scenario: core-limits-stop-blocks-to-two
- **GIVEN** S1 的执行体 A 已有两条收口门禁红结论，两次都被续修
- **WHEN** A 第三次收口，门禁仍红（failed 为 ["G7 x"]）
- **THEN** 判定为放行收口
- **AND** A 结束后，S1 记 blocked（gate），原因含 "G7 x"

#### Scenario: core-respawns-once-after-silent-end
- **GIVEN** S1 的执行体 A 结束，本轮没有收口门禁结论
- **WHEN** 求下一批动作
- **THEN** 为「跑 S1 门禁」
- **AND** 记入门禁红结论后，下一批动作是在 S1 原 worktree 上派发执行体，并标为续接
- **AND** 续接的执行体同样未经收口就结束、门禁仍红时，S1 记 blocked

### Requirement: 合回之后依次评审、批量修复、final、落地
- 门禁绿的切片 SHALL 被合回；合回后 SHALL 为它派发一个评审员。
- 全部 wave 结束且全部评审都有结果（提交了 findings，或记了阻断）后：
  - 有 CRITICAL / HIGH 时，SHALL 派发一个修复 agent，findings 只含这些阻断项；
  - 否则 SHALL 跑 final。
- 修复 agent 的 final 绿则合回修复，再跑 final。
- final 绿 SHALL 落地；final 红 SHALL 停飞。
- 计划指纹与起飞时不同，SHALL 停飞。
Feature: 评审离关键路径，修复一次批量完成，停飞只有两个原因

#### Scenario: core-reviews-fixes-then-finals
- **GIVEN** 全部切片已合回
- **AND** S1 的评审给出 1 条 HIGH，S2 的评审给出 1 条 LOW
- **WHEN** 依次推进状态机
- **THEN** 先派发修复 agent，其 findings 只含那条 HIGH
- **AND** 修复 agent 的 final 绿、修复合回后，动作为跑 final
- **AND** final 绿后，动作为落地

#### Scenario: core-halts-on-final-red
- **GIVEN** 账本里最新的 final 事件 ok 为 false，failed 为 ["G2 lint"]
- **WHEN** 求下一批动作
- **THEN** 恰为停飞，原因含 "G2 lint"
- **AND** 没有落地动作

#### Scenario: core-halts-on-plan-change
- **GIVEN** takeoff 记录的指纹是 F，当前计划指纹是 G
- **WHEN** 求下一批动作
- **THEN** 恰为停飞，原因含「计划指纹已变」

### Requirement: 再次起飞时接着上一次飞
新一次 takeoff（attempt 加 1）之后，状态机 SHALL 接着已有的账本继续，而不是从头再飞：
- 此前任一次飞行里已合回的切片，SHALL NOT 再派发，也 SHALL NOT 再评审；
- 已派发但没有结论的切片，SHALL 在原 worktree 上续接派发；
- 上一次被阻断的切片，SHALL 在本次重新派发。
Feature: 会话中断时 agent 一并终止（实测 X4），恢复只能靠账本

#### Scenario: core-continues-from-previous-attempt
- **GIVEN** attempt 1 里 S1 已合回且有评审结果，S2 已派发但没有结论
- **AND** 之后有 attempt 2 的 takeoff
- **WHEN** 求下一批动作
- **THEN** 只在 S2 的原 worktree 上派发执行体，并标为续接
- **AND** 没有派发 S1 的执行体，也没有派发 S1 的评审员

### Requirement: 事件形状与路由对账
状态机核心 SHALL 提供账本事件的构造函数，产出的字段与 flight-ledger-events 的表逐项一致。收口时 SHALL 把各 agent 的实际模型与起飞时的主模型对账：实际模型 id 不含期望模型名（别名，如 opus），或实际模型缺失，SHALL 生成一条 HIGH 阻断项。
Feature: TS 写的事件必须能被 Python 判定器读；路由偏差机械发现，不靠自述

#### Scenario: core-builds-ledger-events
- **GIVEN** 一次派发、一次门禁结论、一次 agent 结束
- **WHEN** 用事件构造函数生成三条事件
- **THEN** 三条事件的字段与类型与 flight-ledger-events 表中 dispatch、gate、ended 三行一致

#### Scenario: core-reports-routing-mismatch
- **GIVEN** takeoff 记录主模型为 opus
- **AND** 一个执行体的 ended 事件中，实际模型为 claude-sonnet-5-5
- **WHEN** 求收口阻断项
- **THEN** 含一条 HIGH，summary 含「路由不符」、角色 executor、期望 opus、实际 claude-sonnet-5-5
