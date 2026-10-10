## ADDED Requirements

### Requirement: 账本追加失败后以新链尾为父重试
`update-ref` 因旧值不符失败时，控制面 SHALL 重新读取链尾，以新链尾为父重新 `commit-tree`，再以新链尾为旧值 `update-ref`。SHALL NOT 沿用第一次读到的链尾。
Feature: 并发追加时不能把别人刚写的事件挤掉（实测 S4：CAS 拒绝旧值不符）

#### Scenario: io-cas-rereads-tip
- **GIVEN** 第一次读到的链尾为 T1，`update-ref` 因旧值不符失败
- **AND** 第二次读到的链尾为 T2，`update-ref` 成功
- **WHEN** 追加一条事件
- **THEN** 链尾读了两次，第二次 `commit-tree` 以 T2 为父
- **AND** 两次 `update-ref` 的旧值依次为 T1、T2

### Requirement: 按 agent 找飞行只靠账本
控制面处理子 agent 的事件时，SHALL 从账本找出它属于哪次飞行：
1. 先查本进程的缓存；
2. 缓存里没有时，在会话所在仓库列出 `refs/flight/*/ledger`，读出还没有 land 或 halt 的账本，找 dispatch 事件中 `agent` 等于该 agentId 的那一个；
3. 用 takeoff 事件（branch、model、by.session）与 `git worktree list` 重建飞行上下文：主 worktree、change worktree（分支为 branch 的那一项）、changeDir、判定器目录。

模块内存里的登记 SHALL NOT 是唯一来源。
Feature: 模块重载、测试与插件是两个隔离实例（实测 X13），都不能让控制面丢失飞行

#### Scenario: io-finds-flight-from-ledger
- **GIVEN** 本进程没有登记任何飞行
- **AND** 仓库里有 `refs/flight/demo/ledger`，含 takeoff（branch worktree-demo、model opus）与 agent A 的 dispatch
- **AND** worktree 列表里主 worktree 为 /repo，分支 worktree-demo 的 worktree 为 /repo/.worktrees/demo
- **WHEN** 按 agent A 查找飞行
- **THEN** 找到 change demo，changeTree 为 /repo/.worktrees/demo，branch 为 worktree-demo，model 为 opus
- **AND** 按一个从未派发过的 agent 查找时，返回空
