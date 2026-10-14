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
> - wave 1 = S1 + S4：唤醒轮（orchestrator / armed / 类型）与文档、0.10.2，owns 互不相交；
> - wave 2 = S3（依赖 S1）：批准带在按键处理之内起飞，建 `lease.ts`，在 orchestrator 加两个导出；
> - wave 3 = S2（依赖 S1、S3）：派发凭证强制。
>
> **飞行条件**：
> - 在已安装的插件 0.10.1 上飞，主检出须在 `0d67541` 或更新；
> - ⚠ 0.10.1 的按键起飞会绕过包络，这正是本 change 要修的缺陷。批准带上只按「批准起飞」：它会写 approve 并起飞；
> - 只在本会话起飞；起飞前会话停在本 change 的 worktree，飞行中不要 cd。

## 切片

- [x] S1 唤醒轮：定时到点只唤醒、看门狗诊断经唤醒、提交绑定待命（armed / orchestrator / 类型） （deps: - · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_armed.py tests/test_flight_watchdog.py tests/test_flight_abort.py`）
- [x] S4 文档与发布：唤醒轮写进 opsx-apply / README / WORKFLOW，opsx-propose description 去旧字样，插件 0.10.2 （deps: - · verify: `python3 -m pytest -q tests/test_dispatch_origin_docs.py tests/test_armed_followups_docs.py tests/test_armed_docs.py tests/test_unattended_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_flight_entry_docs.py tests/test_ledger_guards_docs.py tests/test_ship_ledger_docs.py tests/test_retire_workflow_docs.py tests/test_measure_followups_docs.py tests/test_flight_interaction_docs.py tests/test_opsx_apply_engine.py tests/test_measure_strict_docs.py tests/test_takeoff_commit_docs.py`）
- [x] S3 批准带在按键处理之内起飞与续飞：带凭证、进行中再按被拒、重绘失败不留进行中、续飞后恢复状态行（register / lease.ts / orchestrator 两个导出） （deps: S1 · verify: `python3 -m pytest -q tests/test_flight_resume.py tests/test_flight_plugin.py tests/test_approval_gate.py`）
- [x] S2 派发凭证强制：guardedSpawn、ctxOf 带凭证、hook 入口取凭证并沿起飞 / drive 传下去 （deps: S1, S3 · verify: `python3 -m pytest -q tests/test_flight_lease.py tests/test_flight_orchestrator.py tests/test_flight_landing.py tests/test_flight_resume.py`）
