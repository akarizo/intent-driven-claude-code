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
> - wave 1 = S1 + S2 + S3：纯模块、小修、orchestrator 加固与起飞闭包，owns 互不相交；
> - wave 2 = S4（依赖 S1、S3）+ S5（依赖 S3）+ S6（依赖 S3）：待命接线、批准带、文档并行；S4 改 orchestrator，S5 改 register / io，彼此只经 `takeoffNow` 的签名耦合。
>
> **飞行条件**：
> - 在已安装的插件 0.9.0 上飞；主检出须快进到 `7fd26b0` 或更新（判定器要认识 heal / triage）；
> - 本 change 改的是 worktree 里的插件，不影响本次飞行的控制面；本次飞行享受 0.9.0 的自愈，但还享受不到待命；
> - 只在本会话起飞；起飞前会话停在本 change 的 worktree，飞行中不要 cd。

## 切片

- [ ] S1 纯模块 armed.ts：起飞拒绝分类、待命的预算与推进 （deps: - · verify: `python3 -m pytest -q tests/test_flight_armed.py`）
- [ ] S2 小修：提交工件对已暂存的删除成立；integ 提示词按 spec 原样的护栏用例 （deps: - · verify: `python3 -m pytest -q tests/test_flight_land.py tests/test_flight_agents.py tests/test_flight_takeoff_commit.py`）
- [ ] S3 orchestrator 加固：诊断员包络与计时、看门狗停飞补停、计时器去重；起飞闭包 takeoffNow 与类型 （deps: - · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_abort.py tests/test_flight_watchdog.py tests/test_flight_plugin.py`）
- [ ] S4 orchestrator 待命接线：被拒即待命、按事件自动重试、交模型、放弃与取消 （deps: S1, S3 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_takeoff_commit.py tests/test_flight_versions.py tests/test_flight_abort.py`）
- [ ] S5 批准带：三个按钮按下即起飞、「起飞」按钮、停飞判定修正、续飞前停诊断员 （deps: S3 · verify: `python3 -m pytest -q tests/test_flight_resume.py tests/test_flight_plugin.py tests/test_approval_gate.py tests/test_flight_io.py`）
- [ ] S6 文档与发布：命令、skill、README、WORKFLOW、propose 交接写清起飞待命与按下即起飞，插件 0.10.0 （deps: S3 · verify: `python3 -m pytest -q tests/test_armed_docs.py tests/test_unattended_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_flight_entry_docs.py tests/test_ledger_guards_docs.py tests/test_ship_ledger_docs.py tests/test_retire_workflow_docs.py tests/test_measure_followups_docs.py tests/test_flight_interaction_docs.py tests/test_opsx_apply_engine.py tests/test_measure_strict_docs.py tests/test_takeoff_commit_docs.py`）
