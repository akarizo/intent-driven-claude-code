## ADDED Requirements

### Requirement: /flight status 打印进度
插件 SHALL 在会话开始时注册 `/flight` 命令；`/flight status [<change>]` SHALL 回复该 change 账本的 `summaryLines`，省略 change 且本进程只有一个在飞的 flight 时取它。
Feature: 路线图 D9：状态行、飞行面板与 /flight

#### Scenario: flight-status-prints-progress
- **GIVEN** 插件已加载，demo 已起飞（attempt 1，waves [[S1, S2], [S3]]）
- **WHEN** 人发出 `/flight status demo`，再发出不带 change 的 `/flight status`
- **THEN** 会话开始时登记过名为 `flight` 的命令
- **AND** 两次回复都含 `demo`、`attempt 1` 与 `W1/2`

### Requirement: /flight abort 停下本会话的飞行
`/flight abort [<change>]` SHALL 经 `abortFlight` 先在账本记停飞，再对本 attempt 每个在飞的 agent 调用 `TaskStop`（`task_id` 为其 agentId），之后控制面 SHALL NOT 再派发或合回。
Feature: 用户定：只有人工中止停 agent

#### Scenario: flight-abort-stops-agents
- **GIVEN** demo 已起飞并派出 S1、S2 的执行体（agent-1、agent-2），`agent.list` 里两者都是 running
- **WHEN** 人发出 `/flight abort demo`，随后 agent-1 结束（turn.complete，reason aborted）
- **THEN** 账本里本 attempt 有 halt 事件，原因含「人工中止」，且排在两次 `TaskStop` 调用之前
- **AND** `TaskStop` 的 task_id 依次为 agent-1、agent-2；agent-1 结束后账本没有新的 dispatch 或 merge

### Requirement: /flight resume 只续未落地的 attempt
`/flight resume <change>` SHALL 只在账本有 takeoff 且最新 attempt 未落地时走起飞路径续飞；从未起飞时 SHALL 回复含 `/opsx-apply` 的拒绝，已落地时 SHALL 回复含「已落地」的拒绝，两者都 SHALL NOT 写事件。
Feature: 用户定：续飞与新起飞在命令上分开

#### Scenario: flight-resume-only-unfinished
- **GIVEN** 三份账本：
  - demo 没有 takeoff；
  - demo 的 attempt 1 已落地；
  - demo 的 attempt 1 已停飞
- **WHEN** 分别发出 `/flight resume demo`
- **THEN** 第一份回复含 `/opsx-apply`，第二份含「已落地」，两者都没有新事件
- **AND** 第三份回复含「续飞」与「✈ 起飞」，账本有 attempt 2 的 takeoff

### Requirement: 起飞时自动打开飞行面板
起飞成功后插件 SHALL 打开 id 为 `flight` 的面板（用户定：自动打开）；面板 SHALL 以 `summaryLines` 的内容绘制，并随状态行刷新。
Feature: 用户定：起飞时自动打开

#### Scenario: panel-opens-at-takeoff
- **GIVEN** demo 已批准、工作区干净
- **WHEN** 人发出 `/opsx-apply demo`，再请求绘制 Pane `flight`
- **THEN** 插件以 id `flight` 调用过 `ui.open`
- **AND** 绘制出的面板文本含 `demo` 与 `W1/2`
