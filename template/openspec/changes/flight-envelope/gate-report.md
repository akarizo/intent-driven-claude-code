# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-10T05:48:46Z | S3 | template/plugins/flight/hooks/envelope.ts:92 | 不解析引号，引号内的分隔符也会切段 | 误拒出现时再换成真正的 shell 词法分析。 |
| 2026-10-10T05:48:46Z | S3 | template/plugins/flight/hooks/envelope.ts:158 | 只读子命令里能写文件 / 起进程的选项按黑名单挡（-c、--output、-O） | 发现新的副作用选项时补进来 |
| 2026-10-10T05:48:46Z | S3 | template/plugins/flight/hooks/envelope.ts:177 | 路径按子串匹配，同前缀的兄弟目录也会被认作在飞树 | 误拒出现时改为带边界的匹配 |
| 2026-10-10T06:02:14Z | S6 | template/plugins/flight/hooks/io.ts:130 | 两张表只在本进程内维护，进程重启后要等下一次 takeoff 才重建在飞集合 | 需要跨重启强制时，从账本 refs/flight/* 重建 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-10T05:46:40Z | S2 | ok | b29d6d2688 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:47:33Z | S5 | ok | c8a5205029 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:48:37Z | S4 | ok | f0b0fa7d58 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:48:46Z | S3 | ok | 959c612a58 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T05:49:05Z | S1 | ok | cb5613767d | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T06:02:14Z | S6 | ok | c9935f2a0e | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T06:14:10Z | final | ok | 7ca205eb83 | - | - |
| 2026-10-10T06:45:36Z | final | ok | f2c240a3db | - | - |
