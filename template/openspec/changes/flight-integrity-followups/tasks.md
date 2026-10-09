> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2（并行，owns 不相交）。

## S1 G7 沿用项目的 pytest 运行方式，带超时与诊断；找回门禁结论的守卫测试 · deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py`

- [ ] S1 `slice-gate.py`：G7 运行方式按 `gate.pytest` > 从 `gate.test` 推导 > 退回会话 python3（warnings 说明）；超时（`FLIGHT_G7_TIMEOUT` / 3×全量耗时且 ≥120 秒 / 600 秒）、进程组整组杀；无结果附 `rc=` 与错误行；`scenario_status` 返回 warnings；schema tasks 指令补 `gate.pytest`；scenarios：g7-uses-runner-from-gate-test · g7-prefers-explicit-pytest-config · g7-falls-back-with-warning · g7-times-out · g7-reports-collection-failure-detail · resume-start-refuses-record-after-replan

## S2 工作流：integrator / final-gate 抛错重派一次，评审员抛错只记录；回退路径同步 · deps: - · verify: `python3 -m pytest -q tests/test_agents_workflow.py tests/test_template_docs.py tests/test_ship_verdict.py`

- [ ] S2 `opsx-apply.js`：integrator 与 final-gate 抛错或无结果重派一次（`:retry`），仍失败记 blocked infra；评审员抛错记 blocked `review:<S>` 不重派；命令与 skill 回退路径同步；scenarios：mechanical-roles-retry-once · mechanical-roles-blocked-after-retry · reviewer-failure-recorded · apply-docs-mirror-agent-failure-handling
