# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-10T05:48:46Z | S3 | template/plugins/flight/hooks/envelope.ts:92 | 不解析引号，引号内的分隔符也会切段 | 误拒出现时再换成真正的 shell 词法分析。 |
| 2026-10-10T05:48:46Z | S3 | template/plugins/flight/hooks/envelope.ts:158 | 只读子命令里能写文件 / 起进程的选项按黑名单挡（-c、--output、-O） | 发现新的副作用选项时补进来 |
| 2026-10-10T05:48:46Z | S3 | template/plugins/flight/hooks/envelope.ts:177 | 路径按子串匹配，同前缀的兄弟目录也会被认作在飞树 | 误拒出现时改为带边界的匹配 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-10T05:46:40Z | S2 | ok | b29d6d2688 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:47:33Z | S5 | ok | c8a5205029 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:48:37Z | S4 | ok | f0b0fa7d58 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:48:46Z | S3 | ok | 959c612a58 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
