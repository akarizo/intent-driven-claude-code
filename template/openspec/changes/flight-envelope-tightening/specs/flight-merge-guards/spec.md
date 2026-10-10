## ADDED Requirements

### Requirement: 合回前拒绝绕过 integrate 的改动
合回切片前，change 分支自切片分叉点以来的第一父链上，若有改动本片 owns（飞行记录除外）的非合并提交，插件 SHALL 拒绝合回并写明提交与文件；合并结果树等于 HEAD 的树（合回对第一父无变更）时，插件 SHALL 拒绝合回。
Feature: #41 的执行体在 change worktree 里直接提交，integrate 全部成了空合并（修复体 225f847 / 99d9e75 已实现，此处补规格）

#### Scenario: merge-refuses-direct-commits-in-owns
- **GIVEN** S2 分叉点以来，第一父链上的非合并提交 466cf98 改了 S2 owns 内的文件
- **WHEN** 合回 S2
- **THEN** 不运行 merge 与 record，返回失败并指出 466cf98 与该文件

#### Scenario: merge-refuses-empty-merge
- **GIVEN** S5 的合并结果树与 HEAD 的树相同
- **WHEN** 合回 S5
- **THEN** 不运行 merge 与 record，返回失败并写明合回对第一父无变更

### Requirement: 已合回判定只认 integrate 合并
切片分支尖端是 HEAD 第一父链上某个合并提交的非第一父时，插件 SHALL 视为已合回：跳过 merge 与上述检查，照常 record、刷新接口摘要并返回 ok；零提交的切片分支（尖端在第一父链上）SHALL NOT 视为已合回。
Feature: 续飞补跑门禁的已合回情形（PR #41 R2、R3）

#### Scenario: merge-records-already-integrated
- **GIVEN** S1 分支尖端是第一父链上合并提交的第二父，账本缺 merge 事件
- **WHEN** 合回 S1
- **THEN** 不运行 merge，照常 record 并返回 ok

#### Scenario: merge-refuses-zero-commit-as-integrated
- **GIVEN** S2 分支没有自己的提交，尖端就是派发时的 change 分支尖端
- **WHEN** 合回 S2
- **THEN** 不 record、不 merge，返回失败并写明合回对第一父无变更

### Requirement: 派发提示词首行写明 worktree
插件派发任一飞行 agent 时，提示词首行 SHALL 写明它自己的 worktree 绝对路径，并要求读写一律用该目录下的绝对路径、git 一律作用于该目录。
Feature: 修复体 2405f49 已实现，此处补规格

#### Scenario: spawn-prompt-names-worktree
- **GIVEN** demo 已批准，waves 为 [[S1, S2], [S3]]
- **WHEN** 人发出 `/opsx-apply demo`，派发 S1、S2 的执行体
- **THEN** 每份提示词首行写明自己的切片 worktree 绝对路径与 `git -C` 该路径
