## ADDED Requirements

### Requirement: checkpoint 子命令是兼容空壳
`slice-gate.py checkpoint` SHALL 什么都不做并以 0 退出：不读写任何 ref 或文件、不输出任何内容。它只为兼容仍注册它的 settings 而保留。
Feature: 已安装项目与本仓库根 settings 仍注册 `slice-gate.py checkpoint`（PostToolUse / PostToolUseFailure）

#### Scenario: checkpoint-is-noop
- **GIVEN** 一个已 start 切片 S1 的仓库，S1 的 owns 内有未提交改动
- **WHEN** 以 PostToolUse 载荷运行 `slice-gate.py checkpoint`
- **THEN** 退出 0、stdout 与 stderr 为空
- **AND** 仓库里没有 `refs/flight/<change>/S1` 这类快照 ref

### Requirement: G5 只按账本判
`slice-gate.py gate` 的 G5 SHALL 只按账本里的控制面测量判定，`--evidence` 只接受 `ledger` 且为缺省；evidence.log 判据与 `hooks_missing` 字段 SHALL 删除。
Feature: 用户定：G5 只留账本判据

#### Scenario: g5-ledger-only
- **GIVEN** 一个已 start 切片 S1 的仓库，账本里没有 S1 的测量，S1 的 scenario 测试已实现并通过
- **WHEN** 不带 `--evidence` 运行 gate，再带 `--evidence log` 运行一次
- **THEN** 前者的 G5 失败项含「缺少本片起点测量」，输出的门禁 JSON 没有 `hooks_missing` 键
- **AND** 后者以非 0 退出，且没有输出门禁 JSON

### Requirement: 旧引擎的门禁机制删除
`slice-gate.py` SHALL 删除只为旧引擎服务的机制：start 的 `--resume-checkpoint`、门禁结论 ref 的保存与找回、`waves` 别名、`red_count`。
Feature: DRAFT-flight-orchestrator-state-machine：门禁结论 ref 找回机制退役

#### Scenario: retired-gate-mechanisms-gone
- **GIVEN** 一个账本里有 S1 起点测量与见红测量、S1 已实现并通过的仓库
- **WHEN** 以账本模式运行 gate S1，再分别运行 `slice-gate.py start S1 --resume-checkpoint` 与 `slice-gate.py waves`
- **THEN** gate 绿，且仓库里没有 `refs/flight/<change>/gate-S1`，门禁 JSON 没有 `red_count`
- **AND** 后两条命令都以非 0 退出
