<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4 + S6 · wave 2 = S5。在已安装的插件 0.4.2 上飞（起飞前主检出须快进到 36d91c3，判定器才是 G5 逐目标与 guards 版本）。S6 含本仓库第一个护栏 scenario（per-task-passes-through，已预写测试、起点即通过）。飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd，只在本会话起飞。

## 切片

- [x] S1 slice-gate：删 checkpoint、门禁结论 ref、--resume-checkpoint、waves、red_count 与 G5 的 evidence.log 模式；checkpoint 留空壳；G5 只按账本 （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py tests/test_slice_gate_final.py tests/test_slice_gate_reuse_preflight.py`）
- [x] S2 hook：takeoff-gate 的 hook 模式与 stop-gate 改为兼容空壳；test-evidence 只记飞行外；hooks.json 去掉退役注册；删 session-decompose.py （deps: - · verify: `python3 -m pytest -q tests/test_evidence_timeline.py tests/test_approval_gate.py`）
- [x] S3 install.sh：合并 settings 前移除退役 hook 注册，列出退役文件不代删 （deps: - · verify: `python3 -m pytest -q tests/test_install.py`）
- [x] S4 /opsx-apply 命令与 skill、git 纪律 skill、/pr-ship、code-reviewer 只讲插件路径 （deps: - · verify: `python3 -m pytest -q tests/test_retire_workflow_docs.py tests/test_opsx_apply_engine.py tests/test_template_docs.py tests/test_ship_verdict.py`）
- [x] S5 铁律 3 / 10 / 11、template/CLAUDE.md.snippet、README、docs/WORKFLOW_zh.md 与新 ADR （deps: S3, S4 · verify: `python3 -m pytest -q tests/test_docs_iron_rules.py tests/test_retire_workflow_docs.py tests/test_template_docs.py tests/test_install.py`）
- [x] S6 删 opsx-apply.js、integrator、slice-executor 与其测试（code-reviewer 用例迁出）；插件拒绝 --engine=workflow、per-task 照旧透传；0.5.0 （deps: - · verify: `python3 -m pytest -q tests/test_retired_engine.py tests/test_code_reviewer_agent.py tests/test_flight_orchestrator.py tests/test_flight_plugin.py`）
