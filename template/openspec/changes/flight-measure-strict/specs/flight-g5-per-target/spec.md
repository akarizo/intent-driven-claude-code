## ADDED Requirements

### Requirement: G5 逐目标要求生产代码未改时的红
账本模式的 G5 SHALL 对每个非护栏的 pytest 目标逐个要求：存在一次本片、本 base 的控制面测量，`source` 为空且该目标为 FAILED 或 ERROR；`source` 非空的测量里的红 SHALL NOT 计入。原来的整片判定（「每次见红时都已改动生产代码」）与「起点已通过即免于先红」的隐式豁免 SHALL 删除。
Feature: 铁律 3 · 用户定：逐目标先红（#47 S5 的「删实现→测红→恢复」被整片判定放过）

#### Scenario: g5-red-after-source-not-counted
- **GIVEN** 切片 S1 映射目标 T1、T2，均非护栏；起点测量里两者为 XFAIL
- **AND** 一次 `source` 为空的测量里 T1 为 FAILED、T2 为 XFAIL
- **AND** 之后一次 `source` 含 `src/mod.py` 的测量里 T2 为 FAILED；两者现已实现并通过
- **WHEN** 以账本模式运行 gate
- **THEN** 门禁红，G5 失败项点名 T2 并含「只在改了生产代码之后测到红」
- **AND** 不点名 T1

#### Scenario: g5-unguarded-pass-before-source-red
- **GIVEN** 切片 S1 映射目标 T1、T2，均非护栏；起点测量里 T1 为 PASSED、T2 为 XFAIL
- **AND** 一次 `source` 为空的测量里 T1 为 PASSED、T2 为 FAILED；两者现已通过
- **WHEN** 以账本模式运行 gate
- **THEN** 门禁红，G5 失败项点名 T1，含「在改生产代码之前就已通过」与「护栏」
- **AND** 警告里没有「免于先红」

### Requirement: 护栏目标须在起点测量里已通过
`slices.json` 切片 `guards` 列出的 scenario（护栏）所映射的目标 SHALL 免于先红，前提是它在本片某次起点测量（`changed` 为空）里为 PASSED，此时记警告，警告含该目标与「护栏」；否则 SHALL 判红，失败项含「护栏」与「起点测量里未通过」。
Feature: 用户定：免于先红只给人批准过的护栏，且须由控制面测到

#### Scenario: g5-guard-exempt-when-passing-at-start
- **GIVEN** 切片 S1 的 `guards` 为 [cap#one]（T1）；起点测量里 T1 为 PASSED、T2 为 XFAIL
- **AND** 一次 `source` 为空的测量里 T2 为 FAILED；两者现已通过
- **WHEN** 以账本模式运行 gate
- **THEN** G5 无失败项、门禁绿
- **AND** 警告点名 T1 并含「护栏」

#### Scenario: g5-guard-must-pass-at-start
- **GIVEN** 切片 S1 的 `guards` 为 [cap#one]（T1）；起点测量里 T1、T2 都为 XFAIL
- **AND** 一次 `source` 为空的测量里 T1、T2 都为 FAILED；两者现已通过
- **WHEN** 以账本模式运行 gate
- **THEN** 门禁红，G5 失败项点名 T1，含「护栏」与「起点测量里未通过」
