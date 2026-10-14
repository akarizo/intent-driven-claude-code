<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4。

## 切片

- [x] S1 判定器：账本认识 shelve、起飞守卫拒飞「已搁置」、覆盖率未达标判不可度量 （deps: - · verify: `python3 -m pytest -q tests/test_shelve_judges.py tests/test_slice_gate_coverage.py tests/test_ledger.py tests/test_approval_gate.py tests/test_slice_gate.py tests/test_slice_gate_final.py tests/test_slice_gate_reuse_preflight.py`）
- [x] S2 插件起飞：改名行归为工件之外，拒绝信息与起飞回复逐行列出工件 （deps: - · verify: `python3 -m pytest -q tests/test_takeoff_dirty_reporting.py tests/test_flight_takeoff_commit.py tests/test_flight_land.py tests/test_flight_orchestrator.py`）
- [x] S3 批准带：「搁置」按钮与按键、读账本用主检出的判定器、逐行列出工件、事件表加 shelve （deps: - · verify: `python3 -m pytest -q tests/test_flight_band_shelve.py tests/test_flight_plugin.py tests/test_flight_resume.py tests/test_flight_io.py tests/test_flight_armed.py`）
- [x] S4 文档与版本：命令与 skill 写明「搁置」，插件补丁版本 +1 （deps: - · verify: `python3 -m pytest -q tests/test_shelve_followups_docs.py tests/test_dispatch_origin_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
