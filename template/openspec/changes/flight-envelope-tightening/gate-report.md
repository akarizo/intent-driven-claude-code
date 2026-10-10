# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-10T09:00:33Z | S3 | template/plugins/flight/hooks/io.ts:232 | 未命中（含非飞行 agent）时逐个读全部未登记 change 的账本；ownership 按 agentId 缓存未命中，任一 dispatch 写入即全清 | 派发频繁时按 change 失效 |
| 2026-10-10T09:03:29Z | S1 | template/plugins/flight/hooks/envelope.ts:147 | 不识别带参数的解释器选项（如 `python3 -W x -`） | 出现漏拒时按解释器补选项表。 |
| 2026-10-10T09:03:29Z | S1 | template/plugins/flight/hooks/envelope.ts:200 | 只要带一个只读选项就放行（`--list --add` 之类的混用不细分） | 出现混用绕过时改为逐项校验 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-10T09:00:02Z | S2 | ok | 7015514edb | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T09:00:33Z | S3 | ok | ce4b77291c | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T09:02:10Z | S6 | ok | dd5a6424d3 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T09:03:29Z | S1 | ok | b06dd109c7 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T09:04:30Z | S5 | ok | 9d8c23f65f | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T09:09:19Z | S4 | ok | f3ae271344 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
