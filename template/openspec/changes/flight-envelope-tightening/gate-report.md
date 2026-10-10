# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-10T09:00:33Z | S3 | template/plugins/flight/hooks/io.ts:232 | 未命中（含非飞行 agent）时逐个读全部未登记 change 的账本；ownership 按 agentId 缓存未命中，任一 dispatch 写入即全清 | 派发频繁时按 change 失效 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-10T09:00:02Z | S2 | ok | 7015514edb | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T09:00:33Z | S3 | ok | ce4b77291c | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
