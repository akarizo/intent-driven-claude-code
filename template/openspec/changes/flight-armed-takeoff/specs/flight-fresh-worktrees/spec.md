## ADDED Requirements

### Requirement: 另起切片 worktree 依次尝试五个候选名
`io.ts` 的 `freshWorktree(io, f, name, attempt)` SHALL 依次尝试以下五个名字：`<name>`、`<name>-a<attempt>`、`<name>-a<attempt>-r2`、`<name>-a<attempt>-r3`、`<name>-a<attempt>-r4`。它 SHALL 取第一个 worktree 与分支都未被占用的名字建 worktree。五个都被占用时，SHALL 返回错误「worktree 已存在：<最后一个候选的路径>」，且不执行 `git worktree add`。

Feature: 重述 flight-measure-followups 的同名规格。#53 修复轮为了让续飞 attempt 里的重派建得出 worktree，把「两个名字都被占用即报错」改成了五个候选，规格当时没有跟上（PR #53 whole-r1 MEDIUM）。主规格目录不存在，在此以 ADDED 重述。行为在 base 上已经成立，属于护栏。

#### Scenario: fresh-worktree-candidates
- **GIVEN** 主 worktree `/repo`、change demo；`flight-demo-S1` 已存在
- **WHEN** 以 attempt 2 依次为 S2、S1 另起 worktree；再在 `flight-demo-S1-a2` 也已存在时为 S1 另起；再在五个候选都已存在时为 S1 另起
- **THEN** S2 按原名建；S1 改建 `S1-a2`，不碰旧树
- **AND** 两个都在时改建 `S1-a2-r2`
- **AND** 五个都在时返回错误、不执行 `git worktree add`

#### Scenario: fresh-worktree-branch-left
- **GIVEN** S1 的旧 worktree 已删，但分支 `flight/demo/S1` 还在；另一份世界里 `flight/demo/S1-a2` 的分支也在
- **WHEN** 以 attempt 2 为 S1 另起 worktree
- **THEN** 改建 `S1-a2`
- **AND** 两个分支都在时改建 `S1-a2-r2`
