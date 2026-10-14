## ADDED Requirements

### Requirement: 计划缺陷停飞不给续飞
最新 attempt 以 kind 为 blocked 的 halt 结束，且本 attempt 有切片的 blocked 原因同时含「G5 measure」与「在改生产代码之前就已通过」时，控制面 SHALL 判为计划缺陷，并在计划指纹与最新 takeoff 相同时不给续飞：
- `/flight resume <change>` SHALL 拒绝、SHALL NOT 写 takeoff，回复含「计划需修订」与该原因首行，SHALL NOT 含「未批准」「计划已变」；
- 批准带 SHALL 显示「计划需修订：<原因首行>」，SHALL NOT 显示「续飞」按钮，SHALL 仍显示「搁置」按钮。
计划指纹变化后，照现有规则显示「批准修订并续飞」。

Feature: flight-shelve-followups 的 S3 因同一条 G5 原因连停三次（attempt 2、3 由人按「续飞」触发），共耗 131 分钟。判据只看账本 blocked 原因文字（零 token），诊断员结论仍只供展示（design D6）。

#### Scenario: resume-refused-on-plan-defect
- **GIVEN** demo 的 attempt 1 以 kind 为 blocked 的 halt 结束，S1 的 blocked 原因为「G5 measure: cap#s → tests/test_a.py::test_s 在改生产代码之前就已通过：若它描述的行为在 base 上本已成立，应在计划里标为护栏」；当前计划指纹等于 attempt 1 的 takeoff 指纹，起飞守卫放行
- **WHEN** 人发出 `/flight resume demo`
- **THEN** 回复含「计划需修订」与「在改生产代码之前就已通过」，不含「未批准」与「计划已变」
- **AND** 账本没有 attempt 2 的 takeoff

#### Scenario: band-shows-plan-defect-without-resume
- **GIVEN** gamma 的最新 attempt 以 kind 为 blocked 的 halt 结束，同 attempt 有一条 blocked，原因为上面的 G5 原文；计划未改（当前与最近批准都为 F）；本会话已认领 gamma
- **WHEN** 批准带刷新并绘制
- **THEN** 有含「计划需修订」的文字，没有 key 以 resume: 开头的按钮
- **AND** 有 key 为 shelve:gamma:<F> 的按钮
