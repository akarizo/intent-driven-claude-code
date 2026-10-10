<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2。等 `flight-measure` 合入后起飞：起飞前预合并 main、重跑 baseline；起飞前 `/reload-plugins` 并确认插件版本。

## 切片

- [x] S1 插件起飞：授权提交时只提交本 change 的工件；插件补丁版本 +1 （deps: - · verify: `python3 -m pytest -q tests/test_flight_takeoff_commit.py tests/test_flight_land.py tests/test_flight_orchestrator.py tests/test_flight_plugin.py`）
- [x] S2 文档：apply 写明「授权提交」，propose 交接写明可直接带「授权提交」起飞 （deps: - · verify: `python3 -m pytest -q tests/test_takeoff_commit_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
