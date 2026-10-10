# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-10T16:01:25Z | S4 | template/plugins/flight/hooks/envelope.ts:111 | 不识别带参数的前缀选项（如 `env -C <dir>`、`exec -a <name>`），参数会被当成程序名 | 出现漏拒时按命令补选项表。 |
| 2026-10-10T16:01:25Z | S4 | template/plugins/flight/hooks/envelope.ts:135 | 只认整段一层引号，不解析反斜杠转义与 `-c` 文本后的位置参数（多出的词让引号不配对而拒） | 误拒或漏拒出现时换成 shell 词法分析。 |
| 2026-10-10T16:01:25Z | S4 | template/plugins/flight/hooks/envelope.ts:285 | 只认 export（不认 declare -x / typeset -x / set -a） | 出现漏拒时补进来 |
| 2026-10-10T23:22:42Z | S9 | template/plugins/flight/hooks/envelope.ts:121 | 选项按前缀命令查表，短选项簇（如 `env -iv`）与短选项粘参数（如 `-uFOO`）一律判为无法判定；`-S` 只去引号不做真正分词 | 误拒或漏拒出现时补表或换 shell 词法分析。 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-10T15:57:45Z | S6 | ok | 500ddade00 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T15:58:52Z | S5 | ok | 1c45c32593 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:00:18Z | S8 | ok | d2b169bd52 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:00:57Z | S1 | ok | e98044a8fe | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:01:25Z | S4 | ok | 8bb13ac4fa | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:02:54Z | S3 | ok | bd6f0ee3f0 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:07:02Z | S2 | ok | 152be827b5 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
| 2026-10-10T16:27:35Z | final | red | ad4d9f5668 | G7 scenario: flight-measure#measure-tool-records-event → tests/test_flight_orchestrator.py::test_measure_tool_records_event 仍标记 xfail/skip; G7 scenario: flight-measure#measure-tool-only-for-flight-executors → tests/test_flight_orchestrator.py::test_measure_tool_only_for_flight_executors 仍标记 xfail/skip; G7 scenario: flight-measure#measure-tool-upgraded-for-executor → tests/test_flight_orchestrator.py::test_measure_tool_upgraded_for_executor 仍标记 xfail/skip; G7 scenario: flight-measure#fresh-dispatch-takes-start-measure → tests/test_flight_orchestrator.py::test_fresh_dispatch_takes_start_measure 仍标记 xfail/skip; G7 scenario: flight-gate-evidence#gate-runs-with-ledger-evidence → tests/test_flight_orchestrator.py::test_gate_runs_with_ledger_evidence 仍标记 xfail/skip; G7 scenario: flight-version-check#takeoff-checks-versions → tests/test_flight_orchestrator.py::test_takeoff_checks_versions 仍标记 xfail/skip; G7 scenario: flight-ownership-fail-closed#unknown-owner-fails-closed → tests/test_flight_orchestrator.py::test_unknown_owner_fails_closed 仍标记 xfail/skip | - |
| 2026-10-10T23:22:42Z | S9 | ok | d2b5b38332 | - | G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对 |
