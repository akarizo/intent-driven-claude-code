## ADDED Requirements

### Requirement: 人工中止先记停飞再停 agent
`abortFlight` 对本会话起飞的在飞 attempt SHALL 先记停飞（原因「人工中止（/flight abort）」），停飞写入成功后 SHALL 对本 attempt 每个在飞的 agent 调用停止，回复逐个列出已停与未停（附原因），并提示可用 `/flight resume <change>` 续飞；停飞写入失败时 SHALL 不停任何 agent 并如实回复。
Feature: 用户定：只有 /flight abort 停 agent；实测 TaskStop 停下后 turn.complete 到达，先记停飞才能让控制面不再推进

#### Scenario: abort-halts-then-stops-live-agents
- **GIVEN** 本会话起飞的 demo attempt 1 在飞，在飞的 agent 为 a2、a3，停 a3 会失败（原因「not found」）
- **WHEN** 调用 `abortFlight`
- **THEN** 先调用一次 halt（原因含「人工中止」），之后才依次停 a2、a3
- **AND** 回复含 a2「已停」、a3「未停」与「not found」，并含 `/flight resume demo`

### Requirement: 没有本会话的在飞 attempt 时不动作
没有 takeoff、本 attempt 已落地或停飞时，`abortFlight` SHALL 回复「没有在飞的 attempt」；最新 takeoff 来自另一个会话时 SHALL 回复「另一个会话」并指明到那个会话里中止；两种情况都 SHALL NOT 记停飞、SHALL NOT 停任何 agent。
Feature: TaskStop 只认本会话的任务

#### Scenario: abort-refuses-without-own-flight
- **GIVEN** 三份账本：
  - demo 的 attempt 1 已落地；
  - demo 的最新 takeoff 来自 other-session-1234 且在飞；
  - 没有 takeoff
- **WHEN** 分别调用 `abortFlight`（本会话 sess-1）
- **THEN** 第一、三份回复含「没有在飞的 attempt」，第二份含「另一个会话」与 `other-se`
- **AND** 三次都没有调用 halt 或 stop
