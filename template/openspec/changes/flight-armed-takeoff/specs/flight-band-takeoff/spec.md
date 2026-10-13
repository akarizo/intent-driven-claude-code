## ADDED Requirements

### Requirement: 批准带的显示规则
批准带 SHALL 对每个候选 change 按下表决定按钮，自上而下取第一条命中：

| 账本与指纹 | 按钮（key 前缀） | 说明行 |
|---|---|---|
| 最新 attempt 以 halt 结束（同 attempt 无 land，且 halt 的 kind 不是 `abort`），当前指纹 ≠ 最近批准 | 「批准修订并续飞」（`replan:`） | 含「提交本 change 的工件」「重跑基线」 |
| 同上，当前指纹 = 最近批准 | 「续飞」（`resume:`） | — |
| 最近一次 approve 晚于最近一次 takeoff（或从未起飞），且当前指纹 = 该 approve | 「起飞」（`takeoff:`） | 有未提交工件时为「按下会提交本 change 的 N 个工件并直接起飞」，否则为「按下直接起飞」 |
| 当前指纹未批准 | 「批准起飞」（`approve:`） | 同「起飞」 |
| 其余 | 不显示 | — |

`io.ts` 的 `stoppedNow` SHALL 在同一 attempt 同时有 land 与 halt 时返回 `land`。N 按 `land.ts` 的 `classifyDirty` 口径计。

Feature: 用户定 Q2、Q3；修 0.9.0 批准带给已落地的旧 change（落地后被补记 halt）挂「续飞」的缺陷（2026-10-13 实际发生，被判定器版本核对拦下）。

#### Scenario: band-offers-takeoff-for-approved
- **GIVEN** demo 已批准：最近 approve 的指纹为 F，晚于最近一次 takeoff，当前指纹为 F；工作区有 demo 的 2 个工件未提交
- **WHEN** 批准带刷新并显示 demo，随后按下它的按钮
- **THEN** 按钮为「起飞」，说明行含「提交本 change 的 2 个工件」
- **AND** 按下后账本没有追加 approve；插件以 `[demo, 授权提交]` 起飞（测试世界记到对 demo 的 takeoff-gate.py 调用）；输入框没有被预填

#### Scenario: band-ignores-landed-and-aborted
- **GIVEN** 计划都未改的三个 change：
  - 甲：最新 attempt 先 land、1 秒后又记 halt（0.2.x 的旧账本）；
  - 乙：最新 attempt 以 halt 结束，kind 为 abort；
  - 丙：最新 attempt 以 halt 结束，kind 为 blocked
- **WHEN** 批准带刷新
- **THEN** 甲、乙都不显示，丙显示「续飞」
- **AND** `stoppedNow` 对甲返回 land

### Requirement: 按钮按下即起飞
按下按钮 SHALL 先核对指纹与绘制时一致，然后按钮各自如下：
- `approve:`：追加 approve，再在后台调用 `takeoffNow([change, '授权提交'])`；
- `takeoff:`：不追加 approve，在后台调用 `takeoffNow([change, '授权提交'])`；
- `replan:`：追加 approve，在后台运行 `resumeFlight(…, {replan: true})`；
- `resume:`：不追加 approve，在后台运行 `resumeFlight(…, {replan: false})`。

`resumeFlight` 的 `takeoff` 依赖 SHALL 为 `takeoffNow(args, {resume: true})`。起飞回复的首行 SHALL 经 toast 与 `ui.notify` 告诉人。输入框 SHALL NOT 被预填。`register.tsx` SHALL NOT 把 `$` 传给其他文件的函数。

Feature: 用户定 Q2：三个按钮都按下即起飞。起飞经 orchestrator 交出的闭包 `takeoffNow`（插件里 `$` 不出文件；闭包可以跨文件传，已实测）。

#### Scenario: band-approve-takes-off
- **GIVEN** demo 未批准，当前指纹为 F
- **WHEN** 按下「批准起飞」，推进时钟让后台起飞跑完
- **THEN** 账本追加 approve，fp 为 F
- **AND** 插件以 `[demo, 授权提交]` 起飞（测试世界记到对 demo 的 takeoff-gate.py 调用）
- **AND** toast 含起飞回复的首行；输入框没有被预填

#### Scenario: band-resume-takes-off
- **GIVEN** 甲已停飞、计划改过（指纹 F2），基线退出 0；乙已停飞、计划未改
- **WHEN** 按下甲的「批准修订并续飞」与乙的「续飞」，推进时钟让后台续飞跑完
- **THEN** 甲的账本追加 approve（fp F2），跑过基线，并以续飞方式起飞（测试世界记到对甲的 takeoff-gate.py 调用）
- **AND** 乙的账本没有追加 approve，没有跑基线，并以续飞方式起飞
- **AND** 输入框没有被预填；断言不依赖两次续飞的先后顺序

### Requirement: 续飞前停掉在跑的诊断员
续飞（`replan:` 或 `resume:`）SHALL 在起飞之前，对本 attempt 派出、未结束、引擎里仍在跑的诊断员逐个调用 TaskStop。

Feature: 补 #53 的覆盖缺口：`stopLive` 的真实实现此前没有用例覆盖（PR #53 MEDIUM）。

#### Scenario: band-resume-stops-diagnostician
- **GIVEN** 甲已停飞、计划未改；账本本 attempt 有诊断员 d1 的 dispatch，没有 d1 的 ended；引擎 agent 列表里 d1 为 running
- **WHEN** 按下甲的「续飞」，推进时钟让后台续飞跑完
- **THEN** 起飞之前对 d1 调用了一次 TaskStop
