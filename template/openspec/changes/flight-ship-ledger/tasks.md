<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4（靠 `slices/_interfaces.md` 的约定对接）· wave 2 = S5（依赖 S2、S3、S4）+ S6（依赖 S1：同改 `tests/test_ship_verdict.py`）。在已安装的插件 0.7.0 上飞，主检出须在 ac5d051；全量评审与 ship 工具在本次飞行里还不存在。落地交接 `/flight:pr-ship` 时主会话只提交记录、推送分支、不建 PR（用户定：与 change 2 叠成一个 PR）。飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd，只在本会话起飞。

## 切片

- [x] S1 判定器：ship 只读账本（全量评审最新一轮、路由对账、评审新鲜度）、ship 事件、ship-ledger 能力、--reuse-fix 认修复轮、PR 用时取账本 （deps: - · verify: `python3 -m pytest -q tests/test_ship_verdict.py tests/test_slice_gate_reuse_preflight.py tests/test_ledger.py tests/test_evidence_timeline.py`）
- [x] S2 状态机：final 绿后全量评审、CRITICAL/HIGH 自动修至多 2 轮并复核；面板加全量评审 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py tests/test_flight_plugin.py`）
- [x] S3 落地执行：全量评审与复核的提示词和派发、修复轮的派发收口与合回、closeout 按 ship 输出写记录、reviewer.md （deps: - · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_land.py tests/test_flight_agents.py tests/test_flight_plugin.py`）
- [x] S4 ship 工具纯模块：核对 PR 头、按账本裁决、贴评论、切换 draft / ready、记 ship 事件；事件字段表加 ship （deps: - · verify: `python3 -m pytest -q tests/test_flight_ship.py tests/test_flight_io.py tests/test_flight_plugin.py`）
- [x] S5 接线：注册 ship 工具且只认主会话、修复轮按 slice 合回、per-task 指引、起飞核对 ship-ledger、不变量、删 closeoutLists、0.8.0 （deps: S2, S3, S4 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_versions.py tests/test_flight_core.py tests/test_flight_takeoff_commit.py tests/test_flight_plugin.py`）
- [x] S6 文档：/flight:pr-ship 飞行模式交给 ship 工具；apply 文档写明全量评审与账本裁决、来源规则各一处；README 与 WORKFLOW （deps: S1 · verify: `python3 -m pytest -q tests/test_ship_ledger_docs.py tests/test_ship_verdict.py tests/test_template_docs.py tests/test_flight_entry_docs.py tests/test_docs_iron_rules.py tests/test_retire_workflow_docs.py tests/test_measure_followups_docs.py tests/test_flight_interaction_docs.py tests/test_opsx_apply_engine.py`）
