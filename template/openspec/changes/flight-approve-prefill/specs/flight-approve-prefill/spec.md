## ADDED Requirements

### Requirement: 重复批准同样预填起飞命令
按「批准起飞」被判为重复批准（指纹相同、之后没有起飞过）时，插件 SHALL NOT 追加 approve 事件，SHALL toast 含「已批准」，并 SHALL 与正常批准一样调用 `$.prompt.fill` 预填 `/opsx-apply <change>`；预填失败时 SHALL 再 toast 一条含「请手动输入 /opsx-apply <change>」的提示。
Feature: #42 评审 LOW：第一次按完关掉了预填，第二次按就拿不到下一步提示

#### Scenario: approve-dedupe-prefills-command
- **GIVEN** demo 账本最后一条是指纹 F 的 approve，之后没有 takeoff；当前计划指纹仍为 F
- **WHEN** 人再按一次 demo 的「批准起飞」
- **THEN** 账本没有新增事件，toast 含「已批准」
- **AND** `$.prompt.fill` 收到 `/opsx-apply demo`
