## Why

PR #36 的评审留下两处会把整次飞行拖垮的问题，都出在 #36 新引入的机制上：

1. **G7 用会话的 `python3` 跑 scenario 测试**（`slice-gate.py:568`）。下游项目的测试依赖装在 venv 或 uv 里时，收集阶段就会失败，所有 scenario 都被判「未被收集运行」，每次飞行都被拦死。这一步也没有超时，失败时把输出全部丢掉，执行体无从排查。
2. **工作流里 integrator、评审员、final-gate 的 `agent()` 仍是裸调用**（`opsx-apply.js` 173 / 184 / 223 行）。运行时实测：agent 没交回结构化结果时 `agent()` 会抛错。任何一处抛错，整个工作流都会 reject，前面实现的切片全部白跑。阶段 3 本身还要在这套工作流上飞，这条会直接威胁它。

评审还提了第三条：找回的门禁结论没绑定计划。实测发现，改计划后重飞时分支尖端必然前移，重派 worktree 的 HEAD 不会等于旧 base，基点核对已经挡住了这条路径。所以这条不改实现，只补一条守卫测试，把这个性质钉住。

## What Changes

- **G7 沿用项目的测试环境**
  - 运行方式按顺序取：
    1. `slices.json` 的可选配置 `gate.pytest`（如 `"uv run pytest"`）；
    2. 从 `gate.test` 推导到 pytest 为止的前缀（如 `uv run pytest`、`python3 -m pytest`、`.venv/bin/pytest`）；
    3. 前缀里有 shell 语法或找不到 pytest 时，才退回会话的 `python3 -m pytest`，并在 warnings 里说明。
  - 加超时：默认取全量测试耗时的 3 倍且不少于 120 秒，没有耗时记录时用 600 秒；环境变量 `FLIGHT_G7_TIMEOUT` 可覆盖。
  - 没收集到结果时，失败文案附上 pytest 的退出码和输出里的错误行。
  - schema 的 tasks 指令补上 `gate.pytest` 的说明。
- **工作流其余 `agent()` 抛错兜底**
  - integrator 与 final-gate 抛错或无结果时重派一次，仍失败记 blocked（infra），工作流照常走完。
  - 评审员抛错不重派，记一条 blocked（infra，「切片 S 评审未返回」）进 PR 正文；切片级评审缺失由 `/pr-ship` 的整 PR 评审兜住。
  - 命令与同名 skill 的回退路径同改。
- **守卫测试**：改计划后重飞时，重派不会找回旧计划下的门禁结论。

无 BREAKING。本仓库的 `gate.test` 推导结果与现在一致。

## Capabilities

### New Capabilities
- `g7-runner-environment`：G7 实跑 scenario 测试时沿用项目的 pytest 运行方式，带超时与诊断。
- `workflow-agent-failure-tolerance`：integrator / final-gate 抛错重派一次，评审员抛错只记录，工作流不因单个 agent 抛错而崩溃。
- `recovered-gate-scope`：找回门禁结论只限同一基点，改计划重飞不会找回。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **代码**：`template/.claude/hooks/slice-gate.py`（`_pytest_outcomes`、`scenario_status` 及其两个调用方）、`template/.claude/workflows/opsx-apply.js`。
- **文档**：
  - `template/openspec/schemas/intent-driven/schema.yaml`（tasks 指令补一行 `gate.pytest`）；
  - `template/.claude/commands/opsx-apply.md` 与 `skills/openspec-apply-change/SKILL.md` 的回退路径。
- **测试**：`tests/test_slice_gate.py`、`tests/test_agents_workflow.py`。
- **不在范围**：#36 评审的另外 3 条 MEDIUM（evidence.log 回不到分支、路径规范化不处理 `..` 与大小写、缺 `baseRef` 无提示），以及各轮遗留的 LOW。
