<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 · wave 2 = S4 · wave 3 = S5（各 wave 内 owns 不相交）。本 change 基于 `flight-orchestrator-core` 的分支。

## 切片

- [x] S1 land.ts 导出只提交飞行记录的函数；准备解冲突现场不吞非冲突的合并失败 （deps: - · verify: `python3 -m pytest -q tests/test_flight_land.py tests/test_flight_plugin.py`）
- [x] S2 评审员看第一父 diff：提示词与 reviewer 定义改用 git diff <commit>^1 <commit>，取不到报 HIGH （deps: - · verify: `python3 -m pytest -q tests/test_flight_agents.py tests/test_flight_plugin.py`）
- [x] S3 io.ts：按 agent 找飞行只靠账本；删除收 $ 的 ioOf / spawnAgent；CAS 测试改验以新链尾为父 （deps: - · verify: `python3 -m pytest -q tests/test_flight_io.py tests/test_flight_orchestrator.py tests/test_flight_plugin.py`）
- [x] S4 landing.tsx 改为只收 Ctx 的落地逻辑：评审回收、评审员与修复收口、派评审员与修复、final（先提交记录）、落地接 /pr-ship、停飞 （deps: S1 · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_core.py tests/test_flight_plugin.py`）
- [x] S5 接线：orchestrator.tsx 造 Ctx、注册 submit_findings、收口与落地动作转给 landing、起飞异常不落回模型、drive 不空转；收窄批准带断言；版本 0.2.0 （deps: S3, S4 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_plugin.py tests/test_flight_landing.py tests/test_flight_io.py`）

## R PR #39 评审修复 · 2026-10-10 用户授权追加（不在 slices.json 内；来源：PR #39 full 评审的 HIGH）

- [x] R1 起飞先算计划指纹：plan_fp.py 非 0 或输出不是 64 位十六进制 → 回复「计算计划指纹失败，不起飞」，不记 approve、不写 takeoff 事件
- [x] R2 appendEvent 写入前按 ledger.py 的逐类字段表校验事件，不合规返回 false、不写任何 git 对象
