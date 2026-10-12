<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S5 + S6 · wave 2 = S4。在已安装的插件 0.5.0 上飞；主检出须在 f42ebcb（判定器为 G5 逐目标与 guards 版本）。S2 合回后 orchestrator.test.tsx 的起飞用例因世界缺 features 应答而红，attempt 1 停飞后改计划时已补上。飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd，只在本会话起飞。

## 切片

- [ ] S1 slice-gate features：判定器声明能力（evidence-ledger-only · g5-per-target · guards） （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py`）
- [ ] S2 versions.ts：起飞核对判定器能力，过旧或缺能力即拒飞并提示更新主检出 （deps: - · verify: `python3 -m pytest -q tests/test_flight_versions.py tests/test_flight_plugin.py`）
- [ ] S3 core：summarize / summaryLines 从账本归约飞行进度 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py tests/test_flight_plugin.py`）
- [ ] S4 /flight 命令接线（status · panel · abort · resume）、写账本的子命令只认人、起飞自动开面板；0.6.0 （deps: S3, S6 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_landing.py tests/test_flight_plugin.py`）
- [ ] S5 文档：/flight 用法；#49 三条 MEDIUM（Guardrails 一致、读到即停飞分自然语言、install 提示退役文件不受保护） （deps: - · verify: `python3 -m pytest -q tests/test_flight_interaction_docs.py tests/test_install.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_retire_workflow_docs.py tests/test_opsx_apply_engine.py`）
- [ ] S6 abort.ts：人工中止，先记停飞再停在飞的 agent；非本会话或无在飞 attempt 不动作 （deps: - · verify: `python3 -m pytest -q tests/test_flight_abort.py tests/test_flight_plugin.py`）
