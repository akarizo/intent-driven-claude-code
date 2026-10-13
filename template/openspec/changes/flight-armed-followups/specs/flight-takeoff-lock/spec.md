## ADDED Requirements

### Requirement: 起飞锁被占用时如实回复
同一 change 正在起飞时（`/opsx-apply`、`/flight resume`、批准带按键或待命自动重试中的任一个持有起飞锁），另一路起飞 SHALL 被拒，回复「flight：<change> 正在起飞，稍候」，SHALL NOT 追加 takeoff 事件。

Feature: PR #54 评审：锁已存在，但拒绝原文写成「正在自动重试起飞」，人工起飞期间再按批准带也会收到这句，容易误读。

#### Scenario: second-takeoff-refused-while-taking-off
- **GIVEN** demo 已批准；第一次 `/opsx-apply demo` 卡在起飞检查中（测试世界让 takeoff-gate.py 迟迟不答）
- **WHEN** 此时再发一次 `/opsx-apply demo`，随后放行第一次
- **THEN** 第二次的回复含「正在起飞，稍候」，不含「自动重试」
- **AND** 账本恰好追加一条 takeoff

### Requirement: 自动重试进行中收到 abort 时请人稍后再试
自动重试持有起飞锁时，`/flight abort <change>` SHALL 回复「flight：<change> 正在自动起飞，结束后再 /flight abort」，SHALL NOT 清除待命。重试结束时，若起飞成功，SHALL 通知「已起飞」，即使待命在此期间已被替换或清除。

Feature: 用户定 Q2 A。PR #54 MEDIUM：现在 abort 会先清待命并回复「已取消」，而这次重试成功起飞后，结果被静默丢掉。

#### Scenario: abort-waits-for-retry
- **GIVEN** demo 因「基线仍在跑」进入待命；60 秒 tick 触发的自动重试卡在起飞检查中
- **WHEN** 发 `/flight abort demo`，随后放行重试，重试起飞成功
- **THEN** abort 的回复含「正在自动起飞」与「结束后再 /flight abort」
- **AND** abort 之后待命仍在，直到重试结束
- **AND** 重试成功后 `ui.notify` 收到含「已起飞」的通知
