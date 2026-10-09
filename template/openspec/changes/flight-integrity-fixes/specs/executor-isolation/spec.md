## ADDED Requirements

### Requirement: 所有执行体在隔离 worktree 里干活
工作流 SHALL 让每个切片执行体都在隔离 worktree 里运行（`isolation: 'worktree'`），不论所在 wave 有几片。每个 wave 跑完，只要有门禁通过的切片，就 SHALL 派 integrator 合回它们的 commit，并 record 门禁结论。主会话所在的 change worktree 在飞行中 SHALL NOT 出现切片标记。
Feature: 状态单一写者——change 分支只由 integrator 写
Rule: 落实 DRAFT-flight-control-plane-in-mod 的「状态单一写者」原则

#### Scenario: single-slice-wave-runs-isolated
- **GIVEN** waves 为 [[S1, S2], [S3]]，全部一次门禁绿，S3 的 commit 为 F
- **WHEN** 跑完整个工作流
- **THEN** S3 的派发带 `isolation: 'worktree'`
- **AND** wave 2 之后有一次合回派发，其 prompt 含 F

### Requirement: fix 阶段同样隔离，并在 final 之前合回
fix 执行体 SHALL 在隔离 worktree 里运行。finalize 的 integrator SHALL 先把 fix 返回的 commit 合回 change 分支（冲突则中止合并并在返回里写明），再运行全量门禁 final。
Feature: 批量修复也不直接写主会话的 worktree

#### Scenario: fix-runs-isolated-and-merges-before-final
- **GIVEN** waves 为 [[S1, S2], [S3]]，全部门禁绿
- **AND** S1 的评审给出 1 条 HIGH，fix 返回的 commit 为 N
- **WHEN** 跑完整个工作流
- **THEN** fix 的派发带 `isolation: 'worktree'`
- **AND** finalize 派发的 prompt 含 N，且合回 N 的指令出现在 `slice-gate.py final` 之前

### Requirement: 回退路径同步一律隔离
`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` 的回退路径 SHALL 写明：每个执行体（含单片 wave 与 fix）都带 `isolation: worktree`，每个 wave 都由 integrator 合回。原来「仅多切片 wave 隔离」的限定 SHALL 删除。`openspec-git-discipline` 的临时 worktree 例外条款 SHALL 同步覆盖每个执行体的临时 worktree，不再只限 wave 内并行切片。
Feature: 回退路径与脚本语义逐项一致，git 纪律不自相矛盾

#### Scenario: apply-docs-mirror-always-isolate
- **GIVEN** opsx-apply.md、openspec-apply-change/SKILL.md 与 openspec-git-discipline/SKILL.md
- **WHEN** 读两份回退路径段与 git 纪律的临时 worktree 例外条款
- **THEN** 两份回退路径都含 `isolation: worktree`，并点明单片 wave 与 fix 也隔离
- **AND** 两份回退路径都不再出现「同 wave 多切片各自」或「多切片 wave 各自」的限定
- **AND** 例外条款点明单片 wave 与 fix 的执行体同样适用
