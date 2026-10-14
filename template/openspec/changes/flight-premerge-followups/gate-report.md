# Gate Report

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-14T09:32:25Z | S1 | ok | d3bf20ef17 | - | - |
| 2026-10-14T09:33:00Z | S3 | ok | 67a88c77c5 | - | - |
| 2026-10-14T09:39:05Z | S2 | ok | 0e1cd73af5 | - | - |
| 2026-10-14T09:49:34Z | S4 | ok | c07d344880 | - | - |
| 2026-10-14T09:53:55Z | S5 | red | 16025ad23f | G1 verify: exit 1 E       assert 'claim-hook-keeps-downstream-error' in {'abort-during-drive-stops-late-dispatch', 'abort-halts-then-stops-live-agents', 'abort-refuses-without-own-flight', 'abort-stops-agents-before-draining', 'abort-stops-residual-agents', 'abort-waits-for-retry', ...}  tests/test_flight_plugin.py:29: AssertionError =========================== short test summary info ============================ FAILED tests/test_flight_plan_defect_band.py::test_claim_hook_keeps_downstream_error 1 failed, 57 passed in 19.45s; G7 scenario: flight-small-fixes#claim-hook-keeps-downstream-error → tests/test_flight_plan_defect_band.py::test_claim_hook_keeps_downstream_error 实际结果 FAILED（未真正通过） | 工作树有未提交改动：template/plugins/flight/hooks/register.tsx, template/plugins/flight/tests/flight.test.tsx, template/plugins/flight/types/index.d.ts, tests/test_flight_plan_defect_band.py |
| 2026-10-14T10:23:32Z | S5 | red | 16025ad23f | G1 verify: exit 1 E       assert 'claim-hook-keeps-downstream-error' in {'abort-during-drive-stops-late-dispatch', 'abort-halts-then-stops-live-agents', 'abort-refuses-without-own-flight', 'abort-stops-agents-before-draining', 'abort-stops-residual-agents', 'abort-waits-for-retry', ...}  tests/test_flight_plugin.py:29: AssertionError =========================== short test summary info ============================ FAILED tests/test_flight_plan_defect_band.py::test_claim_hook_keeps_downstream_error 1 failed, 57 passed in 29.88s; G7 scenario: flight-small-fixes#claim-hook-keeps-downstream-error → tests/test_flight_plan_defect_band.py::test_claim_hook_keeps_downstream_error 实际结果 FAILED（未真正通过） | 工作树有未提交改动：template/plugins/flight/hooks/register.tsx, template/plugins/flight/tests/flight.test.tsx, template/plugins/flight/types/index.d.ts, tests/test_flight_plan_defect_band.py |
| 2026-10-14T12:31:22Z | S5 | ok | 9f4c3d8db7 | - | - |
| 2026-10-14T12:37:37Z | S6 | ok | 5f2c165061 | - | - |
| 2026-10-14T12:38:38Z | final | ok | 9fca67d4ca | - | - |
| 2026-10-14T12:51:10Z | fix-r1 | ok | c9fd473ecd | - | - |
| 2026-10-14T12:51:19Z | final | ok | db2dec8d2e | - | G2 test: 复用修复门禁 c9fd473ecd 的全量结论（其后只有记账改动） |
