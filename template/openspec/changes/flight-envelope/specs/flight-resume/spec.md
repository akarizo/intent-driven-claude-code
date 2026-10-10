## ADDED Requirements

### Requirement: 续飞时控制面用原 base 补跑门禁
续飞时，若一个切片在上一 attempt 派过执行体且未被记阻断、本 attempt 尚未派过执行体，且它最近一次门禁为绿、切片 worktree 仍在，控制面 SHALL 在该 worktree 里以那次门禁的 base 运行 `slice-gate gate <S> --base <base>`，结果记为本 attempt 的 gate 事件（`agent` 为 `regate`），SHALL NOT 为它派发执行体；补跑为绿 SHALL 照常合回，补跑为红 SHALL 续派执行体，且 `slice-gate start` SHALL 带 `--base <原 base>`。
Feature: 首飞 attempt 2 里，门禁早已绿的 S1、S2 被续派执行体后 base 被重置为当前 HEAD，判成假红

#### Scenario: resume-regates-green-slice
- **GIVEN** attempt 1 派过 S1 的执行体，S1 最近一次门禁 ok（base 为 B），账本没有 S1 的 merge，attempt 1 已 halt；attempt 2 已起飞，S1 的切片 worktree 仍在
- **WHEN** drive 处理 attempt 2
- **THEN** 在 S1 的 worktree 里运行了带 `--base B` 的 `slice-gate gate S1`，attempt 2 没有派发 S1 的执行体
- **AND** 账本依次有 attempt 2 的 S1 gate（ok，agent 为 regate）与 S1 的 merge（ok）

#### Scenario: resume-red-regate-dispatches-with-original-base
- **GIVEN** 同上，但补跑的门禁为红
- **WHEN** drive 处理 attempt 2
- **THEN** 派发了 S1 的续接执行体
- **AND** 这次派发前的 `slice-gate start S1` 带 `--base B`

### Requirement: 起飞前提交遗留的飞行记录
起飞检查发现工作区不干净时，若每个脏路径都是本 change 目录下的飞行记录文件（`timeline.md`、`gate-report.md`、`evidence.log`、`slices/_interfaces.md`），插件 SHALL 先以 `chore(flight): 记录` 提交它们再继续起飞；存在任何其他脏路径时 SHALL 照旧拒绝起飞且不写账本。
Feature: 停飞路径不提交记录，会话中断也会留下记录；首飞因此需要人工提交才能再起飞

#### Scenario: takeoff-commits-leftover-records
- **GIVEN** demo 已批准，attempt 1 已 halt；change worktree 里只有 `<change 目录>/timeline.md` 与 `<change 目录>/gate-report.md` 未提交
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** `chore(flight): 记录` 的 `git commit` 排在 takeoff 事件之前，回复含「✈ 起飞」
- **AND** 另一情形：未提交的还有 `src/x.py` 时，回复含「工作区不干净」，账本没有新的 takeoff

### Requirement: 终态之后 drive 不再计算计划指纹
drive SHALL 先判断本 attempt 是否已有 land 或 halt，有则直接返回，SHALL NOT 运行 `plan_fp.py`，SHALL NOT 追加任何事件。
Feature: PR #40 评审 MEDIUM：已停飞的飞行，残留 agent 每结束一次就可能再记一条 halt

#### Scenario: drive-stops-after-terminal-without-fp
- **GIVEN** demo 的 attempt 1 已因指纹失败 halt，它派出的 agent-2 仍在运行，`plan_fp.py` 仍以 1 退出
- **WHEN** agent-2 结束（turn.complete）
- **THEN** 没有运行 `plan_fp.py`
- **AND** 账本里 attempt 1 的 halt 仍只有 1 条
