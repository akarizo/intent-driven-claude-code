## Why

flight-approval-ledger 的实战飞行（PR #35）暴露出三处让飞行记录**静默失真**的缺陷：

1. 执行体撞轮次上限、没交回结构化结果时，Workflow 的 `agent()` 直接抛错。重派写在 `.then` 里，被抛错跳过了；blocked 原因却仍写「已重派一次」。
2. G7 用源码正则判断 scenario 骨架是否解锁，别名装饰器 `@XF` 看不出来。结果 final 报「36/36」，实际还有 18 条处于 xfail。
3. 单片 wave 的执行体直接在主会话 worktree 里写切片标记，Stop hook 因此误拦主会话和评审员。

另有 PR #35 两轮评审留下的 7 条 MEDIUM 与 3 条 follow-up LOW。它们都在批准链与分发链上，最严重的一条（计划指纹的 glob 没转义）会让「批准绑定计划指纹」在某些路径下失效。

这些问题不先修，接下来编排迁入 mod 的大 change 会在同一套机制上再踩一遍。

## What Changes

- **执行体未返回的恢复**
  - 工作流把 `agent()` 抛错当作「未返回」，照常重派一次；blocked 原因与实际一致。
  - 门禁通过时，slice-gate 把结论 JSON 写进 `refs/flight/<change>/gate-<S>`。重派的 `start --resume-checkpoint` 先找这条记录：基点吻合就以 3 退出、原样打印结论，执行体按「start 非 0 → 原样返回」交回。
- **执行体一律隔离**
  - 单片 wave 与 fix 阶段的执行体也在隔离 worktree 里干活，由 integrator 合回。
  - 主会话 worktree 在飞行中不再出现切片标记，落实已接受的「状态单一写者」原则。
- **G7 按实际运行结果判定**：对映射到 `.py` 的 scenario 测试单独跑一次 pytest，只认 PASSED；XFAIL / XPASS / SKIPPED / FAILED / 未被收集到都判未通过。原有的源码文本检查保留。
- **批准链加固**
  - 计划指纹对 change 目录做 glob 转义。
  - 账本：非 UTF-8 事件与悬空 ref 都判账本损坏（exit 4）；链尾只解析一次。
  - 批准带：可批准的项优先显示，有问题的项不再挡住它们；读不到版本时给出提示。
  - 账本守卫匹配路径前先规范化（反斜杠、`//`、`/./`）；新的门禁结论 ref 与账本 ref 同受守卫。
  - 补上起飞门禁对 Workflow 派发的测试。
- **插件安装与升级**
  - `marketplace add` 失败不再阻止后续的 `install`；两步都失败时仍以 0 退出，并打印手动命令。
  - `--upgrade` 把模板 settings.json 里用户缺失的顶层键补上，已有键一律不动；settings.json 在文件头的「用户数据」清单里列明。
- flight 插件版本升到 0.1.1，描述与新的守卫范围一致。

无 BREAKING。

## Capabilities

### New Capabilities
- `executor-noreturn-recovery`：执行体调用抛错按未返回重派；门禁结论留存到 git ref，重派时找回；执行体与回退路径的文档同步。
- `executor-isolation`：所有执行体（含单片 wave 与 fix）在隔离 worktree 里干活，由 integrator 合回。
- `scenario-outcome-gate`：G7 以 scenario 测试的实际运行结果为准。
- `approval-chain-hardening`：计划指纹、账本读取、起飞门禁测试与批准带插件的加固。
- `install-plugin-robustness`：插件安装的失败路径，以及升级时 settings.json 的补键。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格；上一 change 的同名行为在本 change 中以新增能力的形式加固。）

## Impact

- **代码**
  - `template/.claude/hooks/slice-gate.py`（门禁结论 ref、start 找回、record 清理、G7 实际结果）
  - `template/.claude/workflows/opsx-apply.js`
  - `template/.claude/hooks/plan_fp.py`、`ledger.py`
  - `template/plugins/flight/**`
  - `install.sh`、`.claude-plugin/marketplace.json`
- **文档**
  - `template/.claude/commands/opsx-apply.md` 与 `skills/openspec-apply-change/SKILL.md` 的回退路径（同改）
  - `template/.claude/agents/slice-executor.md`、`integrator.md`
- **测试**
  - `tests/test_slice_gate.py`、`test_agents_workflow.py`（工作流模拟器改为忠实复现运行时：`agent()` 抛错、`parallel` 逐个兜底）
  - `test_plan_fp.py`、`test_ledger.py`、`test_approval_gate.py`、`test_flight_plugin.py`、`test_install.py`
- **运行代价**
  - 每个单片 wave 多一次 sonnet 合回，约 20 秒。
  - gate / final 多跑一遍映射到的 scenario 测试。
- **不在范围**：PR #35 `review-findings.json` 里剩余的 11 条 LOW，以及 follow-up 评审的 LOW-5（`deferred` 条目没有闭环标记），留给后续 change。
