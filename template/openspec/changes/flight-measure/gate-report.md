# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-10T16:01:25Z | S4 | template/plugins/flight/hooks/envelope.ts:111 | 不识别带参数的前缀选项（如 `env -C <dir>`、`exec -a <name>`），参数会被当成程序名 | 出现漏拒时按命令补选项表。 |
| 2026-10-10T16:01:25Z | S4 | template/plugins/flight/hooks/envelope.ts:135 | 只认整段一层引号，不解析反斜杠转义与 `-c` 文本后的位置参数（多出的词让引号不配对而拒） | 误拒或漏拒出现时换成 shell 词法分析。 |
| 2026-10-10T16:01:25Z | S4 | template/plugins/flight/hooks/envelope.ts:285 | 只认 export（不认 declare -x / typeset -x / set -a） | 出现漏拒时补进来 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-10T15:57:45Z | S6 | ok | 500ddade00 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T15:58:52Z | S5 | ok | 1c45c32593 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:00:18Z | S8 | ok | d2b169bd52 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:00:57Z | S1 | ok | e98044a8fe | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:01:25Z | S4 | ok | 8bb13ac4fa | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:02:54Z | S3 | ok | bd6f0ee3f0 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
