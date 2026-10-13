# Gate Report

## 天花板

| 时间 | 切片 | 位置 | 限制 | 升级路径 |
|---|---|---|---|---|
| 2026-10-13T08:35:47Z | S3 | template/plugins/flight/hooks/orchestrator.tsx:795 | 旧计时器不会被取消，仍按周期空转 | 引擎给出计时器句柄的存活状态或取消接口后改为按句柄判、取消旧计时器 |

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-10-13T08:24:14Z | S2 | ok | c2d2d23dae | - | G5 measure: tests/test_flight_agents.py::test_integ_prompts_spec_given 为护栏（计划已批准），起点测量已通过，免于先红 |
| 2026-10-13T08:24:33Z | S1 | ok | b1fccc51da | - | - |
| 2026-10-13T08:35:47Z | S3 | ok | ce4674aa95 | - | - |
| 2026-10-13T08:39:23Z | S6 | red | 762dd6e85d | G1 verify: exit 1 E         + 0.10.0  tests/test_unattended_docs.py:36: AssertionError =========================== short test summary info ============================ FAILED tests/test_unattended_docs.py::test_plugin_version_0_9_0 - AssertionEr... 1 failed, 55 passed in 0.11s | - |
| 2026-10-13T08:39:37Z | S6 | red | 762dd6e85d | G1 verify: exit 1 E         + 0.10.0  tests/test_unattended_docs.py:36: AssertionError =========================== short test summary info ============================ FAILED tests/test_unattended_docs.py::test_plugin_version_0_9_0 - AssertionEr... 1 failed, 55 passed in 0.11s | - |
| 2026-10-13T08:39:47Z | S6 | red | 762dd6e85d | G1 verify: exit 1 E         + 0.10.0  tests/test_unattended_docs.py:36: AssertionError =========================== short test summary info ============================ FAILED tests/test_unattended_docs.py::test_plugin_version_0_9_0 - AssertionEr... 1 failed, 55 passed in 0.10s | - |
| 2026-10-13T08:44:54Z | S5 | ok | 2c181e0cec | - | G5 measure: tests/test_flight_io.py::test_fresh_worktree_never_reuses_old 为护栏（计划已批准），起点测量已通过，免于先红; G5 measure: tests/test_flight_io.py::test_fresh_worktree_branch_left 为护栏（计划已批准），起点测量已通过，免于先红 |
| 2026-10-13T08:45:09Z | S4 | ok | f71b296280 | - | - |
| 2026-10-13T09:02:31Z | S6 | ok | 3aedee3f07 | - | - |
| 2026-10-13T09:09:25Z | fix | ok | 1192ea36f1 | - | - |
| 2026-10-13T09:09:32Z | final | ok | 65b3e1669e | - | G2 test: 复用修复门禁 1192ea36f1 的全量结论（其后只有记账改动） |
| 2026-10-13T09:20:47Z | fix-r1 | ok | 04c948860d | - | - |
| 2026-10-13T09:20:54Z | final | ok | 034d74f385 | - | G2 test: 复用修复门禁 04c948860d 的全量结论（其后只有记账改动） |
| 2026-10-13T09:27:37Z | fix-r2 | ok | 18deff009a | - | - |
| 2026-10-13T09:27:45Z | final | ok | 32240d4050 | - | G2 test: 复用修复门禁 18deff009a 的全量结论（其后只有记账改动） |
