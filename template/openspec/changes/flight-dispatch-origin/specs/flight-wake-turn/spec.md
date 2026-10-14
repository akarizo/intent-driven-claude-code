## ADDED Requirements

### Requirement: 定时到点只唤醒，在唤醒那一轮结束时重试起飞
起飞待命的定时到点（等待类的 60 秒 tick、偶发类的 10 秒重试）SHALL NOT 直接起飞或派发 agent。条件满足时，插件 SHALL 以自己的名义提交一轮唤醒对话：正文含 change 名与「只回复「收到」」，且不要求模型做任何别的事。提交时刻之后开始的主会话那一轮结束时，插件 SHALL 重试起飞。等待类在唤醒前 SHALL 先零 token 检查条件：基线仍在跑、或上一次的 agent 仍在运行时，不唤醒。同一待命已唤醒、尚未重试时，后续的定时到点 SHALL NOT 再次唤醒。

Feature: 插件只有在处理外部事件、尚未返回的 hook 里派发，派出的 agent 才经过包络与 measure。定时器回调里派发会绕过它们（flight-armed-followups 实测）。

#### Scenario: transient-timer-wakes-then-retries
- **GIVEN** demo 已批准；plan_fp.py 第一次以 1 退出（计算计划指纹失败），之后正常；人发出 `/opsx-apply demo`，demo 进入偶发类待命
- **WHEN** 时钟推进 10 秒，随后主会话一轮结束（开始时刻不早于唤醒的提交时刻）
- **THEN** 时钟推进之后、那一轮结束之前：`prompt.submit` 恰收到一次，正文含 demo 与「只回复「收到」」；plan_fp.py 仍只运行过 1 次；没有派发任何 agent
- **AND** 那一轮结束之后：账本追加 takeoff，并派出了执行体

#### Scenario: baseline-tick-probes-before-waking
- **GIVEN** demo 因「基线仍在跑」进入待命；之后 slice-gate preflight 的第一次检查仍报「基线仍在跑」，再往后都通过
- **WHEN** 时钟依次推进 60 秒三次（三次 tick），随后主会话一轮结束
- **THEN** 第一次 tick 之后没有提交唤醒
- **AND** 第二次 tick 之后恰提交一次唤醒，第三次 tick 之后仍只有这一次
- **AND** 那一轮结束之后账本追加 takeoff

### Requirement: 看门狗停飞后经唤醒轮派诊断员
看门狗在定时器里停飞时，SHALL NOT 在定时器回调里派诊断员。它 SHALL 记下待派的诊断，并提交一轮唤醒对话（正文含 change 名、「诊断员」与「只回复「收到」」）。提交时刻之后开始的主会话那一轮结束时，插件 SHALL 派出只读诊断员。唤醒提交失败时 SHALL 通知人，SHALL NOT 重试。

#### Scenario: watchdog-triage-via-wake
- **GIVEN** 账本预置 attempt 1 的 3 条 heal（自愈预算已用尽）；demo 起飞，agent-1 的模型请求一直不结束
- **WHEN** 时钟推进 661 秒（看门狗停飞），随后主会话一轮结束
- **THEN** 停飞之后、那一轮结束之前：没有派出诊断员；`prompt.submit` 收到含 demo 与「诊断员」的唤醒
- **AND** 那一轮结束之后：账本有 role diagnostician、slice triage 的 dispatch

### Requirement: 交模型与唤醒的提交只作用于安排它的那次待命
提交修复请求或唤醒文本之后，插件 SHALL 先核对当前待命是否仍是安排这次提交的那一次（同一 since）。成功时，只给那一次标记已提交；失败时，只放弃那一次。待命已被替换时，SHALL NOT 改动或放弃新的待命。

Feature: PR #56 MEDIUM：提交在安排它的待命之外运行，成功或失败后都按 change 重读待命，可能误标或误弃新待命。

#### Scenario: stale-submit-keeps-new-arm
- **GIVEN** demo 因 lint 红进入交模型待命甲；甲的修复请求正在提交中（测试世界扣住 `prompt.submit`）
- **WHEN** 时钟推进 1 秒后，人再发 `/opsx-apply demo`，再次因 lint 红进入新待命乙；随后放行甲的提交，并让它失败
- **THEN** 待命乙仍在：最后一次状态行仍含 demo 与「起飞待命」
- **AND** 没有含「提交修复请求失败」的放弃通知

### Requirement: 待命纯判定在定时事件上不给出起飞
`armed.ts` 的 `nextStep` 遇 `tick` 或 `timer` 事件时 SHALL NOT 给出 `retry`：
- 本该重试的，给出 `wake`（附唤醒正文）；
- 已唤醒（`awaitingWake`）的，给出 `wait`；
- 遇 `main-turn` 且已唤醒的，给出 `retry`。

`beforeRetry` SHALL 清掉已唤醒标记。

#### Scenario: timer-steps-never-retry
- **GIVEN** wait-baseline、wait-agents、transient 三类待命各一个，都未唤醒；另有一个已唤醒的 wait-baseline 待命
- **WHEN** 前三个依次遇 tick、tick、timer；第四个分别遇 tick 与 main-turn，再对它调用 beforeRetry
- **THEN** 前三个都给出 wake，正文含 change 名与「只回复「收到」」
- **AND** 第四个遇 tick 给出 wait，遇 main-turn 给出 retry；beforeRetry 之后已唤醒标记为假
