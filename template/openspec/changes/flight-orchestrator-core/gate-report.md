# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-09T12:56:11Z | S6 | template/plugins/flight/hooks/land.ts:111 | 解冲突 worktree 已存在（上次中断留下）时直接报错 | 需要续用时改为检测 worktree list 并复用现场 |
| 2026-10-09T12:56:11Z | S6 | template/plugins/flight/hooks/land.ts:125 | change 分支在解冲突期间前进（如同 wave 其他切片已合回）时 --ff-only 失败并记阻断 | 需要时改为在解冲突 worktree 先 rebase/merge change 分支再快进 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-09T12:40:01Z | S1 | ok | bf56f3583d | - | - |
| 2026-10-09T12:40:01Z | S2 | ok | f4f9a8333b | - | - |
| 2026-10-09T12:40:01Z | S3 | ok | a607220d2d | - | - |
| 2026-10-09T12:40:01Z | S4 | ok | d9619de216 | - | - |
| 2026-10-09T12:56:11Z | S5 | ok | 14d579cba7 | - | G5 evidence: 未见 RED 先于 GREEN 的测试运行记录 |
| 2026-10-09T12:56:11Z | S6 | ok | c1d65adb13 | - | - |
