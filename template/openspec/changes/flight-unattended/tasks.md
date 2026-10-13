<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` / `// Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：
> - wave 1 = S1 + S2 + S3：状态机、判定器、纯模块，测试文件互不相交；
> - wave 2 = S4（依赖 S1、S2、S3）+ S5a（依赖 S1、S2、S3）：落地与编排（一）并行，S4 的 verify 不跑 orchestrator 测试；
> - wave 3 = S5b（依赖 S5a）+ S6（依赖 S5a）+ S7（依赖 S4、S5a）。
> - S5 在 attempt 1 两次撞 maxTurns 40 后，拆为 S5a / S5b（2026-10-13）。
>
> **飞行条件**：
> - 在已安装的插件 0.8.0 上飞，主检出须快进到 `e5551f4`（判定器从主检出运行）；
> - 本 change 改的是 worktree 里的插件与判定器，不影响本次飞行的控制面，本次飞行享受不到自愈；
> - 只在本会话起飞。

## 切片

- [x] S1 状态机：合回失败重派、看门狗后的重派、自愈预算、整合修复、halt 分类；诊断员只读 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py tests/test_flight_envelope.py`）
- [x] S2 判定器：G9 整合护栏与 integ-guard、账本认 heal / triage、report 打印自愈与诊断 （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate_final.py tests/test_ledger.py tests/test_timeline_render.py tests/test_slice_gate.py tests/test_evidence_timeline.py`）
- [x] S3 纯模块：整合修复与诊断的提示词、诊断员定义、看门狗请求跟踪 （deps: - · verify: `python3 -m pytest -q tests/test_flight_agents.py tests/test_flight_watchdog.py`）
- [x] S4 落地：整合修复的派发与带护栏收口、专审评审、停飞与 PR 开出通知、事件表 （deps: S1, S2, S3 · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_ship.py tests/test_flight_io.py tests/test_flight_land.py`）
- [x] S5a 编排（一）：执行 heal、看门狗接线、停飞分类、起飞核对 integ-guard、跟上 S1 的 final 红 （deps: S1, S2, S3 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_versions.py tests/test_flight_abort.py tests/test_flight_takeoff_commit.py`）
- [x] S5b 编排（二）：停飞后派诊断员与 triage、终端通知 （deps: S5a · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_abort.py tests/test_flight_takeoff_commit.py`）
- [x] S6 批准带续飞：停飞态按钮、按下即批准并后台基线、预填续飞命令、resume.ts 顺序 （deps: S5a · verify: `python3 -m pytest -q tests/test_flight_resume.py tests/test_flight_plugin.py tests/test_approval_gate.py`）
- [x] S7 文档与发布：/opsx-apply 命令与 skill、README、WORKFLOW 写清自愈与续飞，插件 0.9.0 （deps: S4, S5a · verify: `python3 -m pytest -q tests/test_unattended_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_flight_entry_docs.py tests/test_ledger_guards_docs.py tests/test_ship_ledger_docs.py tests/test_retire_workflow_docs.py tests/test_measure_followups_docs.py tests/test_flight_interaction_docs.py tests/test_opsx_apply_engine.py`）
