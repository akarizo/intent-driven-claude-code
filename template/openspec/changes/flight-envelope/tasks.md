<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4 + S5 · wave 2 = S6。在已安装的插件 0.2.1 上飞；本 change 的修复与包络在合入并更新到 0.3.0 后生效。

## 切片

- [ ] S1 G3 配对检查不把切片标记当源码 （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py tests/test_ship_verdict.py`）
- [ ] S2 落地交接 /pr-ship 失败不停飞；飞行记录拼装有兜底 （deps: - · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_plugin.py`）
- [ ] S3 能力包络的纯策略模块 envelope.ts （deps: - · verify: `python3 -m pytest -q tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [ ] S4 续飞零 token 补跑门禁、保留原 base；起飞前提交遗留记录；终态短路 （deps: - · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_core.py tests/test_flight_plugin.py`）
- [ ] S5 命令、skill 与 ADR 写明飞行中的权限边界 （deps: - · verify: `python3 -m pytest -q tests/test_opsx_apply_engine.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
- [ ] S6 包络接入引擎事件：tool.call / tool.check / agent.spawn，加在飞集合与 agent 归属缓存；版本 0.3.0 （deps: S3, S4 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_io.py tests/test_flight_plugin.py`）
