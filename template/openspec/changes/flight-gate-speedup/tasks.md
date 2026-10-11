<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S3 + S4 + S5 · wave 2 = S2。起飞前须 `/reload-plugins` 并确认插件版本 ≥ 0.3.2（#42 的 Bash 改写已生效）。

## 切片

- [x] S1 final 先判 G7；全量测试按基线逐条差分 （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate_final.py tests/test_slice_gate.py tests/test_ship_verdict.py`）
- [x] S2 final --reuse-fix；baseline 运行标记与 preflight；gate.test 必填 （deps: S1 · verify: `python3 -m pytest -q tests/test_slice_gate_reuse_preflight.py tests/test_slice_gate_final.py tests/test_slice_gate.py tests/test_ship_verdict.py`）
- [x] S3 新引擎：有计划切片 blocked 时评审收齐后停飞 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py tests/test_flight_plugin.py`）
- [x] S4 新引擎 final 动作带 --reuse-fix，修复体收口门禁不带；插件补丁版本 +1 （deps: - · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_plugin.py`）
- [x] S5 propose 先交审批页、baseline 后台跑；schema 写明 gate.test 必填与测试差分 （deps: - · verify: `python3 -m pytest -q tests/test_template_docs.py tests/test_docs_iron_rules.py`）
