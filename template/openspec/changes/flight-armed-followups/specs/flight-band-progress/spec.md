## ADDED Requirements

### Requirement: 批准带显示进行中，不能重复按
批准带上一项从按下起，直到起飞回复返回为止（续飞时包括基线阶段），SHALL 显示进行中文字，SHALL NOT 渲染按钮：
- 起飞阶段显示「起飞中…」；
- 基线阶段显示「基线运行中（已 N 分钟）」。

返回之后，按批准带的显示规则恢复。

Feature: 用户定 Q3 A。`Button` 没有禁用属性（CLI 2.1.296），「不可按」的做法是不渲染按钮。PR #54 MEDIUM：按键起飞没有「进行中」状态；续飞按钮在基线阶段没有锁，再按一次会并发跑两个基线。

#### Scenario: band-shows-busy-while-taking-off
- **GIVEN** demo 未批准；测试世界让 takeoff-gate.py 迟迟不答
- **WHEN** 按下「批准起飞」，在起飞返回前让批准带重绘；随后放行
- **THEN** 重绘时 demo 一项含「起飞中…」，没有按钮
- **AND** 放行之后，demo 一项不再显示「起飞中…」

### Requirement: 基线进度显示在状态行与批准带
续飞按钮触发的基线运行期间，插件 SHALL 每 60 秒更新一次：
- 状态行为「flight · 续飞准备中 <change> · 基线已跑 N 分钟（上次全量约 M 分钟）」，M 取 `slices.json` 的 `gate.full_suite_sec`；
- 批准带该项显示「基线运行中（已 N 分钟）」。

基线结束后 SHALL 停止更新。

Feature: 用户定 Q5 A。用户在本会话里问过「为啥我没看到基线在跑的证据」。

#### Scenario: band-shows-baseline-progress
- **GIVEN** 甲已停飞、计划改过；测试世界让基线迟迟不结束；`slices.json` 的 `gate.full_suite_sec` 为 132
- **WHEN** 按下「批准修订并续飞」，推进时钟 60 秒，再放行基线
- **THEN** 推进后状态行含「基线已跑 1 分钟」与「上次全量约 2 分钟」，批准带甲一项含「基线运行中」、没有按钮
- **AND** 基线进程只启动了一次
- **AND** 放行后不再更新基线进度

### Requirement: 去重分支如实提示
按「批准起飞」时，若指纹已批准（去重分支），toast SHALL 为「flight：<change> 已批准（指纹相同），直接起飞」，然后起飞；SHALL NOT 提示「无需重复按」。

Feature: PR #54 LOW：现在先提示「无需重复按」，接着又起飞，提示与行为矛盾。

#### Scenario: band-dedupe-toast-says-takeoff
- **GIVEN** demo 的批准带显示「批准起飞」，但同一指纹的 approve 已在账本里（另一次按键刚写入）
- **WHEN** 按下「批准起飞」
- **THEN** toast 含「已批准（指纹相同），直接起飞」，不含「无需重复按」
- **AND** 插件随后起飞（测试世界记到对 demo 的 takeoff-gate.py 调用）
