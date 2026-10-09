<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4 · wave 2 = S5 + S6 · wave 3 = S7（各 wave 内 owns 不相交）。

## 切片

- [x] S1 账本接受并逐类校验飞行事件，approve 判定不变 （deps: - · verify: `python3 -m pytest -q tests/test_ledger.py tests/test_approval_gate.py`）
- [x] S2 状态机核心：账本事件归约、下一批动作、续修上限与兜底、事件构造、路由对账 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py`）
- [x] S3 随插件发布的 agent 类型与提示词纯函数 （deps: - · verify: `python3 -m pytest -q tests/test_flight_agents.py`）
- [x] S4 /opsx-apply 命令与同名 skill 写明插件接管、显式旧引擎与停飞 （deps: - · verify: `python3 -m pytest -q tests/test_opsx_apply_engine.py tests/test_template_docs.py tests/test_agents_workflow.py`）
- [x] S5 副作用层：判定器路径、账本读写、切片 worktree；register.tsx 接入两个注册函数（空壳） （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_io.py tests/test_flight_plugin.py`）
- [x] S6 合回、冲突交接与快进、findings 校验、落地收口的机械过程 （deps: S2 · verify: `python3 -m pytest -q tests/test_flight_land.py`）
- [x] S7 编排接线：接管 /opsx-apply、收口现跑门禁、结束兜底、合回与解冲突、状态行、类型隐藏 （deps: S3, S5, S6 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_plugin.py`）

> 2026-10-09 第一次飞行后经用户决定收窄：原 S8（评审回收与落地接线）连同接线与 5 条 HIGH 的修复移至后续 change `flight-orchestrator-wiring`（本分支之上），见 design.md「第一次飞行的结果与范围调整」。
