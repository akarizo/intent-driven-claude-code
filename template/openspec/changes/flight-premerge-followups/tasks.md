<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` / `// Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1 + S2 + S3；wave 2 = S4 + S5；wave 3 = S6。
>
> **飞行条件**：在已安装的插件 0.11.0 上飞；只在本会话起飞；飞行中会话停在本 change 的 worktree，不要 cd。

## 切片

- [ ] S1 判定器：账本认识 premerge 事件与停飞 kind premerge （deps: - · verify: `python3 -m pytest -q tests/test_premerge_judges.py tests/test_ledger.py tests/test_approval_gate.py tests/test_shelve_judges.py tests/test_timeline_render.py`）
- [ ] S2 预合并主路径：收口在第一次 final 前预合并目标分支、拉取失败与冲突停飞、全量评审起点用目标提交、计划缺陷判定函数 （deps: - · verify: `python3 -m pytest -q tests/test_flight_premerge.py tests/test_flight_orchestrator.py tests/test_flight_landing.py tests/test_flight_io.py tests/test_flight_core.py tests/test_flight_plugin.py`）
- [ ] S3 文档与版本：命令与 skill 写明预合并、/flight recheck、计划需修订；pr-ship 第 4 步；插件 0.12.0 （deps: - · verify: `python3 -m pytest -q tests/test_premerge_docs.py tests/test_band_session_scope_docs.py tests/test_shelve_followups_docs.py tests/test_artifact_files_docs.py tests/test_dispatch_followups_docs.py tests/test_dispatch_origin_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
- [ ] S4 预合并冲突交解冲突 agent、/flight recheck、计划缺陷拒绝续飞、改名行的拒绝出路 （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_premerge_resolve.py tests/test_flight_premerge.py tests/test_flight_orchestrator.py tests/test_flight_land.py tests/test_flight_landing.py tests/test_flight_takeoff_commit.py tests/test_flight_armed.py tests/test_flight_plugin.py`）
- [ ] S5 批准带：计划缺陷显示「计划需修订」、不给续飞；命令认领 hook 保留下游错误 （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_plan_defect_band.py tests/test_flight_plugin.py tests/test_flight_resume.py tests/test_flight_band_scope.py tests/test_flight_band_shelve.py tests/test_approval_gate.py`）
- [ ] S6 测试卫生：插件 TS 测试零失败纳入全量 pytest，修掉 orchestrator.test.tsx 收尾的未处理拒绝 （deps: S4, S5 · verify: `python3 -m pytest -q tests/test_flight_plugin_suite.py tests/test_flight_plugin.py tests/test_flight_orchestrator.py tests/test_flight_armed.py tests/test_flight_resume.py`）
