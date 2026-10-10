## ADDED Requirements

### Requirement: 批准带不重复记录同一指纹的批准
按「批准起飞」时，若账本里最近一次 takeoff 之后（没有 takeoff 则为全部）最后一条 approve 的指纹与这次相同，插件 SHALL NOT 追加 approve 事件，SHALL toast 含「已批准」；指纹不同或上次批准之后已起飞过时，照常追加。
Feature: flight-envelope 的账本里有两条相隔 1 秒的同指纹 approve（按钮连按）

#### Scenario: approve-press-dedupes-same-fingerprint
- **GIVEN** demo 的账本最后一条是指纹 F 的 approve，之后没有 takeoff；当前计划指纹仍为 F
- **WHEN** 人再按一次 demo 的「批准起飞」
- **THEN** 账本没有新增事件
- **AND** toast 含「已批准」
