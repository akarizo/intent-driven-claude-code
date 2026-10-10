<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 · wave 2 = S3。新引擎（插件 0.2.0 状态机）的第一次真实飞行。

## 切片

- [ ] S1 ship 的 final 新鲜度放行任一 change 的记账文件与接口摘要 （deps: - · verify: `python3 -m pytest -q tests/test_ship_verdict.py tests/test_slice_gate.py`）
- [x] S2 落地与停飞打印飞行记录（Ctx.log）；派发修复 agent 前提交记录；事件校验只认字段表自己的键 （deps: - · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_io.py tests/test_flight_plugin.py`）
- [x] S3 编排加固：飞行中指纹失败如实停飞；派发执行体前提交记录；有 agent 在跑时不重复起飞；读缺失文件不停飞；版本 0.2.1 （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_plugin.py tests/test_flight_landing.py`）
