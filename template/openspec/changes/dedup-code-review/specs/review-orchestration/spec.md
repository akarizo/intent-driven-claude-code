# review-orchestration

多个 code review 守门点之间的编排契约：每个守门点审什么 diff 范围、审查状态如何跨守门点传递（水位线）、评审模式如何约束上报范围、以及未阻断 finding 如何上浮到人类 reviewer。本能力回答「谁审什么、谁不再重复审谁」，不涉及「怎么审」——分级 rubric、finding 格式与只读纪律仍归 `code-reviewer` agent 定义所有。

## ADDED Requirements

### Requirement: 守门通过的范围记录到 review 水位线

逐 task 守门流程 MUST 在每次守门通过后，把被审过的 commit 区间、守门结论与未阻断的 finding 记录到本 change 的 review 记录中，并推进「已审至」标记。该记录 MUST 是人类可读的、随 change 归档的文件，同时服务「机器判范围」与「人看审查深度」两个用途。未走守门的实施模式 MUST NOT 产生该记录。

Feature: Review watermark
Rule: 每次守门通过后，被审过的 commit 区间与未阻断的 finding 必须被记录，供后续 review 点判断范围

#### Scenario: 逐 task 守门通过后水位线推进

- GIVEN 一个 change 正在以逐 task 守门模式实施
- WHEN 某个 task 的实现通过守门且无 CRITICAL 与 HIGH finding
- THEN 该 task 的已审 commit 区间与守门结论被追加到本 change 的 review 记录
- AND 记录中的「已审至」标记推进到该 task 的最新 commit

#### Scenario: 未阻断的 finding 被登记为 deferred

- GIVEN 某个 task 的守门报告含 MEDIUM 或 LOW finding 且无 CRITICAL 与 HIGH
- WHEN 该 task 通过守门
- THEN 这些 MEDIUM 与 LOW finding 被登记到 review 记录的 deferred 清单
- AND 该 task 的 checkbox 被勾选，不因这些 finding 而阻断

#### Scenario: 串行模式不产生水位线

- GIVEN 一个 change 以串行轻量模式实施
- WHEN 实施完成
- THEN 本 change 没有 review 记录
- AND 后续每个 review 点按无水位线的既有行为处理

### Requirement: 整合审每个变更只执行一次

跨 task 的整合审 MUST 在一次变更的生命周期里只执行一次。它的执行位置 MUST 由用户的明确选择决定，MUST NOT 依赖模型对用户意图的推断。当变更只有一个 task 时，整合审 MUST 被跳过，因为逐 task 守门已覆盖其全部 diff。

Feature: Integration review placement
Rule: 跨 task 的整合审在一次变更里只执行一次，位置由用户明确选择

#### Scenario: 选择立即送出时跳过本地整合审

- GIVEN 一个 change 的全部 task 已通过逐 task 守门
- WHEN 用户在收口问询中选择立即送出 PR
- THEN 本地整合审被跳过
- AND 收口报告说明整合审将在 PR 阶段执行

#### Scenario: 选择暂不送出时在本地执行整合审

- GIVEN 一个 change 的全部 task 已通过逐 task 守门
- WHEN 用户在收口问询中选择暂不送出 PR
- THEN 本地执行一次整合审，范围为本 change 的累计 diff
- AND 该整合审只报跨 task 交互、整体一致性与端到端完整性

#### Scenario: 单 task 变更恒不执行整合审

- GIVEN 一个 change 只有一个 task
- WHEN 该 task 通过守门
- THEN 整合审被跳过
- AND 跳过理由记录为逐 task 守门已覆盖其全部 diff

### Requirement: PR 评审范围遵从水位线

PR 评审 MUST 先读取本 change 的 review 记录，并按水位线覆盖情况决定评审范围：全部代码提交被覆盖时 MUST 只做整合维度评审；存在未覆盖的提交时，这些提交 MUST 按全量标准评审；读不到 review 记录时 MUST 退回今日的完整 diff 全量评审。水位线 MUST NOT 使任何未经守门的代码免于评审。

Feature: Watermark-aware PR review
Rule: PR 评审的范围由水位线覆盖情况决定，已被守门覆盖的代码不再全量重审

#### Scenario: 水位线覆盖全部代码提交时只做整合审

- GIVEN 一个 PR 的全部代码提交都在水位线的已审区间内
- WHEN 执行 PR 评审
- THEN 评审以整合模式进行，只报跨 task 交互、整体一致性、端到端规格完整性与工件实现一致性
- AND 评审报告不重复上报 review 记录中已修复或已 deferred 的 finding

#### Scenario: 守门之后新增的提交仍被全量审

- GIVEN 水位线的已审至标记之后存在新的代码提交
- WHEN 执行 PR 评审
- THEN 这些未覆盖的提交按全量标准评审
- AND 已覆盖部分只按整合维度评审

#### Scenario: 无水位线时全量评审

- GIVEN 一个 PR 没有对应的 review 记录
- WHEN 执行 PR 评审
- THEN 评审范围为该 PR 与目标分支之间的完整 diff，按全量标准进行

### Requirement: 审查深度与 deferred finding 上浮给人类 reviewer

提交到 PR 的评审报告 MUST 声明本次采用的评审模式、已被守门覆盖的 commit 区间、task 数与阻断并修复的项数，使人类 reviewer 能判断 AI 的审查深度。若 review 记录的 deferred 清单非空，报告 MUST 列出这些未阻断的 finding。

Feature: Review depth disclosure
Rule: 人类 reviewer 必须能看到 AI 审到什么程度，以及守门期间未阻断的问题

#### Scenario: PR 评论呈现审查深度声明

- GIVEN 一个 change 走过逐 task 守门并存在 review 记录
- WHEN PR 评审报告被提交为 PR 评论
- THEN 评论包含审查深度声明，含已守门覆盖的 commit 区间、task 数与阻断并修复的项数
- AND 评论包含本次评审所采用的评审模式

#### Scenario: deferred 清单随评论上浮

- GIVEN review 记录的 deferred 清单非空
- WHEN PR 评审报告被提交为 PR 评论
- THEN 评论列出守门期间 deferred 的 MEDIUM 与 LOW finding
- AND 这些条目标注为未阻断，供人类 reviewer 自行判断

### Requirement: 修复后的复审只审修复增量

针对已审代码的复审 MUST 把范围限定为修复增量，并逐条核对上一轮的 CRITICAL 与 HIGH finding 是否闭环，MUST NOT 重扫已审范围。用户明确要求完整重审时，范围 MUST 回退为完整 diff。为使修复增量可稳定圈定，修复 MUST 产出独立的修复提交，MUST NOT 通过改写既有提交的方式落地。

Feature: Incremental re-review
Rule: 针对已审代码的复审只审修复增量并核对原 finding 闭环

#### Scenario: PR 复审只审修复补丁

- GIVEN 一次 PR 评审已产出 finding 且修复补丁已推送到同一 PR
- WHEN 用户选择再走一轮评审
- THEN 评审范围为上一轮评审时的提交到当前提交之间的 diff
- AND 评审逐条核对上一轮的 CRITICAL 与 HIGH finding 是否闭环

#### Scenario: 用户可显式要求完整重审

- GIVEN 一次 PR 评审已产出 finding 且修复补丁已推送
- WHEN 用户明确要求重新完整评审
- THEN 评审范围回退为该 PR 与目标分支之间的完整 diff

#### Scenario: 逐 task 回灌复审只审修复提交

- GIVEN 某个 task 的守门报告含 CRITICAL 或 HIGH finding 且修复已提交为独立的修复提交
- WHEN 执行复审
- THEN 复审范围为该修复提交
- AND 复审逐条核对原 finding 是否闭环并检查修复本身有无新引入问题

### Requirement: 已守门的测试纪律检查降级

实施验证阶段的测试纪律检查 MUST 按水位线覆盖情况分流：水位线覆盖全部 task 时 MUST 只验证配对测试文件存在并抽样确认三段注释存在，且 MUST 在报告中注明注释细节与反模式判定已由逐 task 守门覆盖；无 review 记录时 MUST 保持完整抽查，使串行模式不失去这道检查。

Feature: Verification degradation
Rule: 已被守门按 HIGH 阻断过的测试纪律维度，验证阶段不再重复完整抽查

#### Scenario: 走过守门的变更只做存在性检查

- GIVEN 一个 change 的水位线覆盖其全部 task
- WHEN 执行实施验证
- THEN 测试纪律检查只验证每个新增或修改的生产文件有配对测试文件并抽样确认三段注释存在
- AND 验证报告注明注释细节与反模式判定已由逐 task 守门覆盖

#### Scenario: 未走守门的变更保持完整抽查

- GIVEN 一个 change 没有 review 记录
- WHEN 执行实施验证
- THEN 测试纪律检查按完整抽查标准执行

### Requirement: 评审员不得重复上报已处理的 finding

评审任务 MUST 向评审员声明评审模式与已审范围；评审员 MUST NOT 重复上报该范围内已修复或已 deferred 的 finding。当评审员确认某条上游 finding 实际未被修复时，该问题 MUST 仍可上报，且 MUST 被标注为上游评审未闭环，以保留纠错能力。

Feature: Review mode contract
Rule: 评审任务声明模式与已审范围后，评审员不得重复上报该范围内已处理的问题

#### Scenario: 评审模式约束上报范围

- GIVEN 一个评审任务声明了评审模式与已审范围
- WHEN 评审员产出报告
- THEN 报告不包含已声明范围内已修复或已 deferred 的 finding

#### Scenario: 上游未闭环的问题仍可上报

- GIVEN 评审员发现某条上游 finding 实际未被修复
- WHEN 评审员产出报告
- THEN 该问题可以上报
- AND 该条目被标注为上游评审未闭环
