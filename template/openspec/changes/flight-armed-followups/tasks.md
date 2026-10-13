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
> - wave 1 = S1 + S2 + S3：armed / land 小修、orchestrator（一）、文档与 0.10.1，owns 互不相交；
> - wave 2 = S4（依赖 S2）+ S5（依赖 S2）：orchestrator（二）与批准带并行。
>
> **飞行条件**：
> - 在已安装的插件 0.10.0 上飞（本次起飞享受待命与按下即起飞）；主检出须在 `a495374` 或更新；
> - 只在本会话起飞；起飞前会话停在本 change 的 worktree，飞行中不要 cd。

## 切片

- [x] S1 小修：放弃待命的做法保留参数、已暂存删除改读 porcelain -z、补记账用例 （deps: - · verify: `python3 -m pytest -q tests/test_flight_armed.py tests/test_flight_land.py tests/test_flight_takeoff_commit.py`）
- [x] S2 orchestrator（一）：起飞锁原文、abort 遇锁、交模型对准、旧待命清理、状态行；导出 scenarioFiles；类型 （deps: - · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_abort.py tests/test_flight_takeoff_commit.py tests/test_flight_plugin.py`）
- [x] S3 文档与发布：三处「按批准起飞后再发命令」残留照实改，插件 0.10.1 （deps: - · verify: `python3 -m pytest -q tests/test_armed_followups_docs.py tests/test_armed_docs.py tests/test_unattended_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_flight_entry_docs.py tests/test_ledger_guards_docs.py tests/test_ship_ledger_docs.py tests/test_retire_workflow_docs.py tests/test_measure_followups_docs.py tests/test_flight_interaction_docs.py tests/test_opsx_apply_engine.py tests/test_measure_strict_docs.py tests/test_takeoff_commit_docs.py`）
- [x] S4 orchestrator（二）：「正在飞」判据与卡住时续飞、诊断员登记窗口计时、tick 复查 （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_watchdog.py tests/test_flight_abort.py`）
- [x] S5 批准带：进行中显示、基线进度、去重提示；加强按键起飞的断言 （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_resume.py tests/test_flight_plugin.py tests/test_approval_gate.py`）
