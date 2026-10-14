## ADDED Requirements

### Requirement: 排队中的 drive 计入「正在飞」
本进程里某 change 的 drive 正在跑或已排进队列尚未结束时，`/opsx-apply` 与 `/flight resume` SHALL 回复「正在飞」，SHALL NOT 写新的 takeoff。这一条不看该 change 当前有没有活 agent。

Feature: PR #56 MEDIUM。drive 走全局单一队列，另一个 change 跑全量门禁时，这个 change 的 drive 可能排几分钟；这期间它既不在 `driving` 里，也没有活 agent，被误判为卡住。

#### Scenario: queued-drive-counts-as-flying
- **GIVEN** 本会话先后起飞了 e2 与 demo；e2 的 drive 正在跑、卡在门禁上；demo 的最后一个执行体刚结束，它的 drive 排在 e2 之后；demo 已没有活 agent
- **WHEN** 发 `/flight resume demo`
- **THEN** 回复含「正在飞」
- **AND** demo 的账本没有新的 takeoff

### Requirement: abort 撞上人工起飞时如实回复
`/flight abort <change>` 撞上起飞锁时：持锁的是自动重试，就回复「正在自动起飞，结束后再 /flight abort」；持锁的是人工起飞（命令或按键），SHALL 回复「flight：<change> 正在起飞，结束后再 /flight abort」，SHALL NOT 说「自动」。

Feature: PR #56 LOW：措辞与事实不符。

#### Scenario: abort-while-manual-takeoff
- **GIVEN** demo 因「基线仍在跑」处于起飞待命；人又发了 `/opsx-apply demo`，这次起飞卡在起飞检查中
- **WHEN** 发 `/flight abort demo`
- **THEN** 回复含「正在起飞，结束后再 /flight abort」
- **AND** 回复不含「正在自动起飞」

### Requirement: 看门狗唤醒失败留日志
看门狗停飞后提交唤醒失败时，插件 SHALL 在通知人之外再记一行日志，含 change 名与「唤醒失败」。

Feature: PR #57 LOW：design 写的是「只记一行、通知人」，实现只通知，事后从日志查不到。

#### Scenario: triage-wake-failure-logged
- **GIVEN** 账本预置 3 条 heal（自愈预算已用尽）；demo 起飞，agent-1 的请求不结束；`prompt.submit` 会抛错
- **WHEN** 时钟推进 661 秒（看门狗停飞），随后推进到唤醒提交
- **THEN** `ui.log` 有一行含 demo 与「唤醒失败」
- **AND** `ui.notify` 收到含「未能派诊断员」的通知

### Requirement: 错过的那一轮在下一次 tick 补发唤醒
唤醒或交模型那一轮结束时，若同一 change 的起飞锁被占用，插件 SHALL 记下这次错过。锁释放后，待命若仍在等那一轮，SHALL 标为「错过一轮」，并清掉已唤醒、已提交两项。之后的第一次 tick 或计时到点，SHALL 对它补发唤醒（任何类别，包括交模型）；已补发、尚未重试时给出等待；重试之前 SHALL 清掉「错过一轮」。

Feature: PR #57 LOW：撞锁时推进被直接丢掉，待命停在「已唤醒」直到 30 分钟过期。

#### Scenario: missed-turn-rewakes-on-tick
- **GIVEN** 一个已唤醒的 wait-baseline 待命，和一个已提交交模型的 model 待命
- **WHEN** 对两者分别调用 `afterMissedTurn`；然后各遇一次 tick；对已补发唤醒的再遇一次 tick；最后对其中之一调用 `beforeRetry`
- **THEN** `afterMissedTurn` 之后两者的已唤醒、已提交都为假，「错过一轮」为真
- **AND** 各遇 tick 时都给出 wake，正文含 change 名与「只回复「收到」」
- **AND** 补发后（已唤醒）再遇 tick 给出 wait；`beforeRetry` 之后「错过一轮」为假
