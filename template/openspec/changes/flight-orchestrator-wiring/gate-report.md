# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-09T15:43:50Z | S3 | template/plugins/flight/hooks/io.ts:112 | 未命中（含非飞行 agent）时逐个读全部未登记 change 的账本 | 非飞行 subagent 频繁或账本数多时，按 change 缓存负结果 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-09T15:43:50Z | S1 | ok | 5fc92ab27e | - | - |
| 2026-10-09T15:43:50Z | S2 | ok | 262d5f5ce9 | - | - |
| 2026-10-09T15:43:50Z | S3 | ok | 010ed7f7c2 | - | - |
| 2026-10-09T15:46:52Z | S4 | ok | 795b959abe | - | - |
| 2026-10-09T15:56:18Z | S5 | ok | c915c3ef5a | - | G5 evidence: 未见 RED 先于 GREEN 的测试运行记录 |
