## ADDED Requirements

### Requirement: 批准带按键在按键处理之内完成起飞与续飞
按「批准起飞」「起飞」「批准修订并续飞」「续飞」后，插件 SHALL 在这次按键处理返回之前完成起飞或续飞（含续飞前的基线），SHALL NOT 转到定时器回调里再做。起飞与续飞 SHALL 带上这次按键取得的派发凭证。

Feature: 按键处理在定时器回调里起飞时，派出的执行体绕过包络与 measure（flight-armed-followups 首轮实况）。交互实测：按键处理挂起 120 秒，人照常输入。

#### Scenario: press-takes-off-before-returning
- **GIVEN** demo 未批准，批准带显示「批准起飞」
- **WHEN** 按下「批准起飞」，等这次按键处理返回（期间不推进时钟）
- **THEN** 按键返回时，账本已有 approve，起飞守卫（takeoff-gate.py）已以 demo 运行恰一次
- **AND** 起飞回复的首行已经 toast

#### Scenario: resume-press-takes-off-before-returning
- **GIVEN** alpha 已停飞、计划已改，批准带显示「批准修订并续飞」；基线判定器立即以 0 退出
- **WHEN** 按下「批准修订并续飞」，等这次按键处理返回（期间不推进时钟）
- **THEN** 按键返回时，基线已对 alpha 运行恰一次，起飞守卫已以 alpha 运行恰一次

### Requirement: 起飞或续飞进行中再按被拒
同一 change 的起飞或续飞尚未结束时，再按它的按钮，SHALL 立即回 toast「flight：<change> 正在起飞，稍候」，SHALL NOT 再起飞一次。

Feature: PR #56 MEDIUM。实测按键是并发处理的，引擎可能在重绘前就交付旧按钮的按键。

#### Scenario: second-press-while-busy-refused
- **GIVEN** demo 未批准，批准带显示「批准起飞」；起飞守卫（takeoff-gate.py）要等放行后才作答
- **WHEN** 按「批准起飞」，等到起飞守卫已被调用、尚未作答（第一次按键还没返回），再按一次同一按钮；随后放行起飞守卫。期间都不推进时钟
- **THEN** 第二次按键在放行之前就已返回，并得到含「正在起飞」的 toast
- **AND** 起飞守卫总共只以 demo 运行一次

### Requirement: 重绘失败不留下「进行中」
按键处理里批准带重绘失败时，起飞或续飞 SHALL 照常进行。处理结束时，SHALL 删除该 change 的进行中记录，之后的重绘不再显示「起飞中…」。

Feature: PR #56 MEDIUM：重绘抛错后，进行中记录永久留着。

#### Scenario: refresh-failure-clears-busy
- **GIVEN** demo 已批准、未起飞，批准带显示「起飞」；按键之后的第一次批准带重绘会抛错（测试世界让重绘所用的读取抛错一次）
- **WHEN** 按下「起飞」并等它返回，随后再重绘批准带
- **THEN** 起飞守卫已以 demo 运行（起飞照常尝试）
- **AND** 重绘后的批准带不含「起飞中…」

### Requirement: 续飞结束后状态行不再停在基线进度
续飞结束时（起飞成功、被拒、基线红或抛错），插件 SHALL 按「还有待命就显示其一；否则有在飞的 change 就显示其进度；都没有才清空」恢复状态行，SHALL NOT 留下「续飞准备中」。

Feature: PR #56 MEDIUM：基线红或起飞被拒后，「flight · 续飞准备中 …」一直留在状态行。

#### Scenario: baseline-status-restored
- **GIVEN** alpha 已停飞、计划已改，批准带显示「批准修订并续飞」；基线判定器以 1 退出（基线红）；没有别的待命，也没有在飞的 change
- **WHEN** 按下「批准修订并续飞」并等它返回
- **THEN** 最后一次状态行不含「续飞准备中」
