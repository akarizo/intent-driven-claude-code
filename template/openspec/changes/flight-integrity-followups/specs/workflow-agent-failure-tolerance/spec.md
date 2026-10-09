## ADDED Requirements

### Requirement: 机械角色抛错重派一次
integrator（wave 合回）与 final-gate 的 `agent()` 调用抛错或没有结果时，工作流 SHALL 重派一次，label 加后缀 `:retry`。重派仍失败时，SHALL 记 blocked（kind 为 infra，原因含「未返回」与「已重派」），并照常走完后续步骤：
- 合回失败：记 `wave<i>`，后续 wave 照常派发；
- final 失败：记 `final`，返回结果里的 final 为空。

工作流 SHALL NOT 因这两处抛错而整体 reject。
Feature: 机械活可以安全重做——合回已合回的 commit 不出错，record 自带防重复

#### Scenario: mechanical-roles-retry-once
- **GIVEN** waves 为 [[S1, S2], [S3]] 且全部门禁绿
- **AND** wave 1 的合回与 final-gate 的首次 agent 调用都抛错，重派后都成功
- **WHEN** 跑完整个工作流
- **THEN** 派发了 `integrate:w1:retry` 与 `final-gate:retry`
- **AND** blocked 为空，返回的 final 是重派的结果

#### Scenario: mechanical-roles-blocked-after-retry
- **GIVEN** waves 为 [[S1, S2], [S3]] 且全部门禁绿
- **AND** wave 1 的合回与 final-gate 的首次和重派调用都抛错
- **WHEN** 跑完整个工作流
- **THEN** 工作流正常结束，S3 仍被派发
- **AND** blocked 里有 `wave1` 与 `final` 两条，kind 都为 infra、原因都含「未返回」与「已重派」

### Requirement: 评审员抛错只记录
评审员的 `agent()` 调用抛错时，工作流 SHALL NOT 重派，也 SHALL NOT 因此 reject。它 SHALL 记一条 blocked（slice 为 `review:<S>`、kind 为 infra、原因含「评审未返回」），其余评审的 findings 照常汇总，Fix 与 Finalize 照常执行。
Feature: 切片级评审缺一份由 /pr-ship 的整 PR 评审兜住（铁律 4 要求的是每个 change 至少一次）

#### Scenario: reviewer-failure-recorded
- **GIVEN** waves 为 [[S1, S2], [S3]] 且全部门禁绿
- **AND** S1 的评审员调用抛错，S2 的评审给出 1 条 MEDIUM
- **WHEN** 跑完整个工作流
- **THEN** blocked 里有一条 slice 为 `review:S1`、kind 为 infra、原因含「评审未返回」
- **AND** deferred 含 S2 的那条 MEDIUM，final-gate 已派发

### Requirement: 回退路径同步
`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` 的回退路径 SHALL 写明：
- integrator 与 final 抛错或未返回时重派一次；
- 评审员抛错只记录、不重派。

命令与同名 skill 同改。
Feature: 回退路径与脚本语义逐项一致

#### Scenario: apply-docs-mirror-agent-failure-handling
- **GIVEN** opsx-apply.md 与 openspec-apply-change/SKILL.md
- **WHEN** 读两份回退路径段
- **THEN** 都写明 integrator 与 final 重派一次
- **AND** 都写明「评审未返回」只记录、不重派
