## ADDED Requirements

### Requirement: 只有确实在驱动的飞行才判「正在飞」
`/opsx-apply` 与 `/flight resume` 遇到以下情形时 SHALL 拒绝：本会话起飞、最新 attempt 既未落地也未停飞、且 change 在本进程的在飞集合里，并且满足以下任一条：
- drive 正在跑这个 change；
- 本 attempt 至少有一个派出的 agent 在引擎里仍在运行。

拒绝回复 SHALL 含「正在飞」「/flight abort <change>」与「/flight resume <change>」。两条都不满足时，SHALL 视为飞行卡住，照常续飞。

Feature: 用户定 Q4 A。PR #54 MEDIUM：只看在飞集合时，drive 提前返回、agent 全部结束的飞行会被误拒，回复也没说下一步。PR #54 LOW：这条拒飞出口当时没有 scenario。

#### Scenario: driving-flight-refused
- **GIVEN** demo 由本会话起飞、attempt 1 未结束、在在飞集合里；派出的 agent a1 在引擎里仍在运行
- **WHEN** 分别发 `/opsx-apply demo` 与 `/flight resume demo`
- **THEN** 两次回复都含「正在飞」「/flight abort demo」与「/flight resume demo」
- **AND** 账本没有追加 takeoff

#### Scenario: stuck-flight-resumes
- **GIVEN** demo 由本会话起飞、attempt 1 未结束、在在飞集合里；drive 不在跑；本 attempt 派出的 agent 都已结束
- **WHEN** 发 `/flight resume demo`
- **THEN** 不回复「正在飞」，账本追加 attempt 2 的 takeoff

### Requirement: 进程重启后回到原会话可以续飞
进程重启后，在飞集合为空，本会话未结束的 attempt SHALL NOT 被判为「正在飞」，SHALL 照常走活 agent 检查与续飞。

Feature: PR #54 修复轮新增的行为，当时没有 scenario（whole-r1 LOW）。行为在 base 上已经成立，属于护栏。

#### Scenario: restart-resumes
- **GIVEN** 账本里 demo 的 attempt 1 由本会话起飞、未结束；本进程的在飞集合为空（模拟重启）
- **WHEN** 发 `/flight resume demo`
- **THEN** 不回复「正在飞」，照常续飞
