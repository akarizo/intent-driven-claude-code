> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S3 + S4 + S5 + S6（并行，owns 不相交）；wave 2 = S2（与 S1 同改 `slice-gate.py`，基于 S1 的合回结果）。

## S1 门禁结论留存到 git ref，重派起跑时找回 · deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py`

- [ ] S1 `slice-gate.py`：gate 绿时写 `refs/flight/<change>/gate-<S>`（提交树唯一 `gate.json`、父提交 = 切片 commit）；`start --resume-checkpoint` 基点吻合即以 3 退出并原样打印；`record` 与首轮 `start` 清理；scenarios：gate-ok-records-result-ref · resume-start-returns-recorded-gate · resume-start-ignores-foreign-gate-record · record-and-fresh-start-clear-gate-ref

## S2 G7 以 scenario 测试的实际运行结果为准 · deps: S1 · verify: `python3 -m pytest -q tests/test_slice_gate.py`

- [ ] S2 `scenario_status` 对 `.py` 目标跑 `pytest -v` 逐条取实际结果，只认 PASSED；XFAIL / XPASS / SKIPPED / FAILED / ERROR / 未收集都记 G7；scenarios：g7-rejects-aliased-xfail · g7-rejects-imperative-skip · g7-gate-checks-own-slice-outcome

## S3 工作流：抛错按未返回重派、执行体一律隔离、fix 合回后再 final；文档同步 · deps: - · verify: `python3 -m pytest -q tests/test_agents_workflow.py tests/test_template_docs.py tests/test_ship_verdict.py`

- [ ] S3 `opsx-apply.js`：`agent()` 抛错按未返回重派一次，`iso` 一律 worktree，每 wave 合回，fix 隔离、finalize 先合回 fix 再 final；命令 / skill 回退路径、执行体开工段、integrator 第 1 项、git 纪律例外条款同步；scenarios：workflow-retries-when-executor-throws · workflow-blocks-after-retry-throws · apply-docs-describe-recovered-gate · single-slice-wave-runs-isolated · fix-runs-isolated-and-merges-before-final · apply-docs-mirror-always-isolate

## S4 批准链 Python 侧：指纹 glob 转义、账本异常对象判损坏与链尾单次解析、Workflow 派发守卫测试 · deps: - · verify: `python3 -m pytest -q tests/test_plan_fp.py tests/test_ledger.py tests/test_approval_gate.py`

- [ ] S4 `plan_fp.py` glob 前缀转义；`ledger.py` 按字节读、非 UTF-8 事件与悬空 ref 判损坏（exit 4）、`_read` 单次解析链尾；Workflow 派发守卫测试；scenarios：plan-fp-escapes-glob-metachars · ledger-non-utf8-event-is-corrupt · ledger-dangling-ref-is-corrupt · ledger-tip-matches-read-chain · takeoff-hook-guards-workflow-dispatch

## S5 flight 插件：可批准项优先、读不到版本给提示、路径规范化、守卫覆盖门禁结论 ref · deps: - · verify: `python3 -m pytest -q tests/test_flight_plugin.py`

- [ ] S5 `register.tsx`：topItem 优先可批准项、「另有」分开计数，读版本失败 toast，文件路径规范化后匹配，`LEDGER_REF` 覆盖 `gate-<S>`；版本 0.1.1、描述同步（含 marketplace.json）；同名 TS 测试；scenarios：band-prefers-approvable-item · version-unreadable-shows-notice · guard-normalizes-ledger-paths · guard-denies-gate-record-writes

## S6 install.sh：插件两步互不阻断、升级补缺失的 settings 顶层键 · deps: - · verify: `python3 -m pytest -q tests/test_install.py`

- [ ] S6 `install_flight_plugin` 的 marketplace add 失败只告警、仍 install，install 失败打印手动命令；`merge_settings` 补模板缺失的顶层键；文件头「用户数据」列入 settings.json；scenarios：plugin-install-continues-after-marketplace-failure · plugin-install-failure-keeps-exit-zero · upgrade-adds-missing-template-settings-keys
