## ADDED Requirements

### Requirement: 判定器从主 worktree 运行
控制面运行判定器（takeoff-gate、plan_fp、ledger、slice-gate、timeline、session-model）时，SHALL 使用主 worktree（`git worktree list` 的第一项）里的副本：
- 优先 `<主 worktree>/.claude/hooks`；
- 没有则用 `<主 worktree>/template/.claude/hooks`。

SHALL NOT 使用 change worktree 或切片 worktree 里的副本。命令的工作目录是被判定的那个 worktree。
Feature: 判定器不能被它要判定的 change 改掉（ADR：飞行永远运行已安装的稳定版本）

#### Scenario: io-runs-judges-from-main-worktree
- **GIVEN** 主 worktree /repo 只有 `template/.claude/hooks/slice-gate.py`
- **AND** change worktree /repo/.worktrees/demo 里也有一份 slice-gate.py
- **WHEN** 对切片 worktree /repo/.claude/worktrees/flight-demo-S1 跑 S1 的门禁
- **THEN** 运行的是 `python3 /repo/template/.claude/hooks/slice-gate.py gate S1 --change-dir …`
- **AND** 工作目录是 /repo/.claude/worktrees/flight-demo-S1

### Requirement: 账本追加带 CAS 重试
控制面追加账本事件时，SHALL 用 git plumbing 依次执行：
1. `hash-object -w --stdin` 写入事件 JSON；
2. `mktree` 建只含 `event.json` 的树；
3. `commit-tree` 以当前链尾为父；
4. `update-ref` 带旧值。

`update-ref` 失败时 SHALL 重读链尾再试，至多 3 次；3 次都失败 SHALL 返回失败，不伪造成功。
Feature: 同一账本可能有多个 hook 并发追加（实测 S4：CAS 天然防写坏）

#### Scenario: io-appends-event-with-cas-retry
- **GIVEN** 第一次 `update-ref` 因旧值不符失败，第二次成功
- **WHEN** 追加一条 dispatch 事件
- **THEN** 重读链尾后成功，写入的 blob 内容就是该事件的 JSON
- **AND** 在 3 次都失败的情形下，返回失败，且恰好尝试了 3 次

### Requirement: 切片 worktree 由控制面持有
切片 S 的 worktree SHALL 位于 `<主 worktree>/.claude/worktrees/flight-<change>-<S>`，分支为 `flight/<change>/<S>`，基于 change 分支尖端创建：
- 不存在时，SHALL 用 `git worktree add -b` 创建；
- 已存在时，SHALL 原样复用（续接），SHALL NOT 重建或删除。
Feature: worktree 不随 agent 消失，续接不需要快照

#### Scenario: io-creates-or-reuses-slice-worktree
- **GIVEN** change demo 的分支为 worktree-demo，切片 S1 的 worktree 不存在
- **WHEN** 准备 S1 的 worktree
- **THEN** 运行 `git worktree add -b flight/demo/S1 /repo/.claude/worktrees/flight-demo-S1 worktree-demo`
- **AND** 该路径已存在时，不运行 `git worktree add`，返回同一路径
