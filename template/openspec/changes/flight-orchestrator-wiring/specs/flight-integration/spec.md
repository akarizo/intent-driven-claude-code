## ADDED Requirements

### Requirement: 飞行记录可单独提交
land SHALL 导出只提交飞行记录的函数：
- change 目录内的飞行记录文件（timeline.md、gate-report.md、evidence.log、slices/_interfaces.md）有未提交改动时，只 add 这些文件并提交 `chore(flight): 记录`；
- 没有改动时不提交；
- change 目录外的改动不碰。

落地逻辑跑 final 之前 SHALL 先调用它，使 final 对齐的 HEAD 已包含接口摘要等记录。否则收口时 ship 会判「final 过期」，飞行必然落成 draft。
Feature: 飞行记录与 ship 的新鲜度判定一致

#### Scenario: land-commits-only-records
- **GIVEN** change 目录里 `slices/_interfaces.md` 有未提交改动，change 目录外的 `src/x.py` 也有
- **WHEN** 提交飞行记录
- **THEN** 只 add 了 change 目录内的记录文件，并提交 `chore(flight): 记录`
- **AND** 没有未提交的记录时，不运行 `git commit`

### Requirement: 解冲突现场不吞合并失败
在解冲突 worktree 里重做合并时，`git merge` 退出非 0 且没有未合并文件，说明是非冲突原因（如分支不存在）。此时准备解冲突现场的函数 SHALL 返回错误，含 git stderr 的首行；SHALL NOT 返回空的冲突列表，否则调用方会拿着空列表派发解冲突 agent。
Feature: 失败原因不能在中途丢失

#### Scenario: land-prepare-resolve-reports-non-conflict-failure
- **GIVEN** 在解冲突 worktree 里重做 S2 的合并时，`git merge` 退出非 0，stderr 首行为「merge: flight/demo/S2 - not something we can merge」，且没有未合并文件
- **WHEN** 准备 S2 的解冲突现场
- **THEN** 返回错误，含该 stderr 首行
- **AND** 不返回冲突列表
