# Gate Report

| 时间 | 切片 | 结论 | commit | failed | warnings |
|---|---|---|---|---|---|
| 2026-09-10T02:45:58Z | S1 | red | aa7bf27b3c | G4 GWT: tests/test_slice_gate.py::test_mod_adds 缺 Then:; G4 GWT: tests/test_slice_gate.py::test_gate_missing_gwt 缺 顺序不是 Given→When→Then | 工作树有未提交改动：.openspec-slice; G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T02:46:41Z | S1 | red | 5500f82000 | G6 ownership: emplate/openspec/changes/apply-flight/timeline.md 不在 owns 内 | 工作树有未提交改动：emplate/openspec/changes/apply-flight/timeline.md; G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T02:47:29Z | S1 | ok | 58fce0a03c | - | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T02:50:23Z | S2 | ok | 61ff74c7d7 | - | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T02:53:40Z | S3 | red | e05f921943 | G1 verify: exit 1 E         ...Full output truncated (123 lines hidden), use '-vv' to show)  tests/test_agents_workflow.py:43: AssertionError =========================== short test summary info ============================ FAILED tests/test_agents_workflow.py::test_workflow_script_valid - AssertionE... 1 failed, 3 passed in 0.04s | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T02:56:55Z | S3 | ok | d978167dcb | - | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T03:09:27Z | S5 | ok | 812a2567a1 | - | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T03:10:31Z | S4 | ok | ee62ffbc69 | - | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T03:12:55Z | S6 | ok | 92302cf729 | - | G5 evidence: 无本切片的测试运行留痕 |
| 2026-09-10T03:34:35Z | final | red | 91aae1c8f5 | G7 scenario: flight-apply#legacy-mode-optional → tests/test_docs_iron_rules.py::test_legacy_mode_optional 仍标记 xfail/skip; G7 scenario: executable-specs#claudemd-iron-rules → tests/test_docs_iron_rules.py::test_claudemd_iron_rules 仍标记 xfail/skip; G7 scenario: executable-specs#docs-updated → tests/test_docs_iron_rules.py::test_docs_updated 仍标记 xfail/skip | - |
| 2026-09-10T03:35:27Z | final | red | 91aae1c8f5 | G7 scenario: flight-apply#legacy-mode-optional → tests/test_docs_iron_rules.py::test_legacy_mode_optional 仍标记 xfail/skip; G7 scenario: executable-specs#claudemd-iron-rules → tests/test_docs_iron_rules.py::test_claudemd_iron_rules 仍标记 xfail/skip; G7 scenario: executable-specs#docs-updated → tests/test_docs_iron_rules.py::test_docs_updated 仍标记 xfail/skip | - |
| 2026-09-10T03:36:07Z | final | ok | 232d409add | - | - |
