## ADDED Requirements

### Requirement: 按键在入口同步登记，连按被拒
批准带按键处理 SHALL 在解析出 change 之后、任何 await 之前，就登记「该 change 正在处理」。已登记时再按，SHALL 立即回 toast「flight：<change> 正在起飞，稍候」并返回，SHALL NOT 再核对指纹、写 approve 或起飞。处理结束（含异常）时 SHALL 删除登记。

Feature: PR #57 MEDIUM：现在先查后登记，查与登记之间隔着读批准带、算指纹、写 approve 几次 await。并发的第二次按键能通过检查，走到去重分支后又起飞一次。

#### Scenario: rapid-second-press-refused
- **GIVEN** demo 未批准，批准带显示「批准起飞」；计划指纹的计算（plan_fp.py）要等放行后才作答
- **WHEN** 按「批准起飞」，等到 plan_fp.py 已被调用、尚未作答时，再按一次同一按钮；随后放行。期间都不推进时钟
- **THEN** 第二次按键在放行之前就已返回，并得到含「正在起飞」的 toast
- **AND** plan_fp.py 只因按键运行一次，账本只追加一条 approve，起飞守卫只以 demo 运行一次

### Requirement: 批准修订已批准时直接续飞
按「批准修订并续飞」时，若账本里同指纹的 approve 已经存在（例如另一次按键刚写入），插件 SHALL 回 toast「flight：<change> 已批准（指纹相同），直接续飞」，并按已批准的修订续飞（含基线），SHALL NOT 只提示而不做。

Feature: PR #56 LOW：这时 toast 说「直接起飞」，实际什么也不做。

#### Scenario: replan-duplicate-resumes
- **GIVEN** alpha 已停飞、计划已改，批准带显示 alpha 的「批准修订并续飞」（当前指纹 G）；按下前，账本在停飞之后已有一条指纹为 G 的 approve；基线立即以 0 退出
- **WHEN** 按下「批准修订并续飞」并等它返回
- **THEN** 有一条 toast 含「已批准（指纹相同），直接续飞」
- **AND** 基线已对 alpha 运行一次，起飞守卫已以 alpha 运行一次

### Requirement: 恢复状态行不冲掉别的 change 的基线进度
某 change 的续飞结束、恢复状态行之后，若批准带上还有别的 change 正处于基线相位，插件 SHALL 立即把状态行写回那个 change 的基线进度行（「续飞准备中 <change> · 基线已跑 N 分钟」），SHALL NOT 等到它下一次 60 秒刷新。

Feature: PR #57 LOW：`restoreStatusNow()` 只看待命与在飞的 change，不认批准带自己的基线相位。

#### Scenario: other-baseline-line-kept
- **GIVEN** alpha 与 beta 都已停飞；按下 beta 的「批准修订并续飞」后，beta 的基线迟迟不结束（处于基线相位）；alpha 计划未改，批准带显示 alpha 的「续飞」
- **WHEN** 按下 alpha 的「续飞」并等它返回
- **THEN** 最后一次状态行含「续飞准备中 beta」
