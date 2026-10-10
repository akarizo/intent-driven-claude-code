<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S5 + S6 · wave 2 = S4。在已安装的插件 0.3.0 上飞（Bash 改写尚未生效）：飞行期间主会话停在已作废的 `.worktrees/flight-envelope-followups`（停车位）、不 cd。

## 切片

- [x] S1 envelope.ts 收紧：Bash 改写函数、git 作用目标、拒绝表补齐、白名单收紧、读取免询问限于仓库内 （deps: - · verify: `python3 -m pytest -q tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [x] S2 合回检查补规格；清理 land 测试里失效的 --is-ancestor 预设 （deps: - · verify: `python3 -m pytest -q tests/test_flight_land.py tests/test_flight_plugin.py`）
- [x] S3 io.ts：agent 归属的登记中状态与未命中缓存 （deps: - · verify: `python3 -m pytest -q tests/test_flight_io.py tests/test_flight_plugin.py`）
- [x] S4 接线：Bash 固定在自己的 worktree、git 作用目标与读取判定、登记中拒绝、git 版本检查；版本 0.3.1 （deps: S1, S3 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_io.py tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [x] S5 批准带去重 （deps: - · verify: `python3 -m pytest -q tests/test_flight_plugin.py`）
- [x] S6 agent 定义、命令、skill 与新 ADR 写明收紧后的包络 （deps: - · verify: `python3 -m pytest -q tests/test_opsx_apply_engine.py tests/test_flight_agents.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
