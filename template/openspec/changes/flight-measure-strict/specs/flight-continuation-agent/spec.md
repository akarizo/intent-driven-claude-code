## ADDED Requirements

### Requirement: 续接只认上一个执行体自己的门禁
`core.next` 判断续接时取的门禁结论 SHALL 限定为：上一个执行体派发之后、由该执行体或补跑（regate）记下的本片门禁；别的 agent（解冲突 agent、被接管会话的残留执行体等）记下的门禁 SHALL NOT 用于补跑、续接说明或 base。
Feature: #47 复核 MEDIUM：门禁结论没有限定来源 agent

#### Scenario: gate-from-other-agent-not-regated
- **GIVEN** waves [[S1, S2]]；attempt 1（指纹 F）派发 S1 的执行体 a1，attempt 2（指纹 F）续派 S1 的执行体 a2
- **AND** 之后 a1 的收口门禁才记入账本（绿，base b1）
- **AND** attempt 3 仍以指纹 F 起飞
- **WHEN** 求 attempt 3 的下一批动作
- **THEN** S1 不是 regate，而是带续接说明、不带 base 的派发
