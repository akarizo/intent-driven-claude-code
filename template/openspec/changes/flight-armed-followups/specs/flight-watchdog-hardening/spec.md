## ADDED Requirements

### Requirement: 诊断员登记窗口里的请求也计时
诊断员已派发、dispatch 尚未写入账本时，看门狗 SHALL 也开始跟踪它的模型请求：在诊断中（`diagnosing`）的 change 下，登记中的 agent 就是诊断员。dispatch 写入后，超时 SHALL 照常 TaskStop。

Feature: PR #54 MEDIUM：登记中的 owner 不带 role，而停飞后 change 已移出在飞集合，诊断员的首个请求从不计时。

#### Scenario: diagnostician-pending-timed
- **GIVEN** demo 已停飞，诊断员 d1 已派发、dispatch 尚未写入；d1 在此期间发出一个模型请求，之后再也没有结束
- **WHEN** dispatch 写入账本；时钟推进到该请求开始后 10 分钟零 1 秒，看门狗 tick
- **THEN** 对 d1 恰好调用一次 TaskStop

### Requirement: tick 处理前复查请求仍然超时
看门狗在一次 tick 里处理某个 agent 之前，SHALL 复查：该 agent 当前请求的起点仍是快照里的那个，且仍超过阈值。不满足时 SHALL 跳过，SHALL NOT 停它，也不记 heal。

Feature: PR #54 LOW：tick 取快照后有 await，其间旧请求结束、新请求开始，会按陈旧快照停掉一个刚开始请求的 agent。

#### Scenario: tick-rechecks-staleness
- **GIVEN** 执行体 a1 的请求已超时，被 tick 取进快照；tick 在查归属时卡住，其间 a1 的旧请求结束、又开始了一个新请求
- **WHEN** 放行 tick
- **THEN** 没有对 a1 调用 TaskStop，账本没有追加 heal

### Requirement: 两个计时器并存时同一超时 agent 只处理一次
两个看门狗计时器同时存活、各 tick 一次时，被两个计时器都取到的那个超时 agent SHALL 只被处理一次：一条 heal、一次 TaskStop。

Feature: 重述 flight-armed-takeoff 的同名要求。原文写的是 a1，而用例里被两个计时器都取到的是 agent-2（PR #54 LOW）。这里按用例实际构造重述。行为在 base 上已经成立，属于护栏。

#### Scenario: ticker-handles-once
- **GIVEN** 看门狗计时器被误判为已停，又起了第二个，第一个仍在；有一个执行体的请求已超时，自愈预算未用尽
- **WHEN** 时钟推进，两个计时器各 tick 一次
- **THEN** 被两个计时器都取到的那个 agent 恰好有一条 heal、一次 TaskStop
