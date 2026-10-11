## ADDED Requirements

### Requirement: 测量工具在归属判不出时提示稍后重试
`mcp__flight__measure` 的调用处理 SHALL 先查调用者的归属：结果为判不出（在飞账本读取失败）时，SHALL 拒绝并回复含「暂时无法判定」与「稍后重试」的理由，SHALL NOT 回复「只有本次飞行的执行体可以请求测量」；不运行测量、不记事件。
Feature: #46 full 评审 LOW：误导理由可能让执行体放弃测量，之后 G5 永远拿不到先红证据

#### Scenario: measure-unknown-owner-says-retry
- **GIVEN** demo 在飞，agent-1 是 S1 的执行体；`ledger.py show` 对 demo 退出 5
- **WHEN** agent-1 调用 `mcp__flight__measure`
- **THEN** 调用被拒，理由含「暂时无法判定」与「稍后重试」，不含「只有本次飞行的执行体」
- **AND** 没有运行 `slice-gate.py measure`
