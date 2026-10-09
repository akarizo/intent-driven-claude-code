## Why

2026-10-08 用本机 128 次 `opsx-apply` 飞行记录（`~/.claude/projects/*/*/workflows/wf_*.json` 的 `workflowProgress` / `result` 与子 agent 转录）做角色归因，发现飞行最大的失败来源不是模型或 effort，而是**执行体未返回**：

| 事实 | 数据 |
|---|---|
| 执行体未返回门禁 JSON | 56 次（Opus 5 40/243，Opus 5.5 16/239）；9 月 12.1%，10 月 7.4% |
| 其中停在第 40 轮（`maxTurns: 40`），最后一条 `stop_reason: tool_use`，在干活中途被截断 | 52 / 56 |
| 工作流对 `agent()` 返回 null 不重试，直接记 `infra` blocked | `opsx-apply.js` 只在 `r && !r.ok` 时重派 |
| 出现过这种 blocked 的飞行 | 35 次，连带 58 个下游切片因依赖被跳过，其中 31 次 final 红 |
| 未返回执行体的半成品 | 40 / 56 一次都没 commit；37 / 56 在临时 worktree 里，脚本拿不到 sha 与路径 |
| 正常返回的执行体（Opus 5.5）轮次 | 中位 16、p90 29、最大 39 |

只在脚本里补"未返回就重派"不够：临时 worktree 的半成品没有 commit，重派拿到新 worktree 只能从头做，大切片会再撞上限。按轮次提前收尾也走不通——官方文档没有暴露当前轮次的字段，按 `agent_id` 数工具调用会因一轮并行多调用而偏早。

## What Changes

- **快照**：`slice-gate.py` 新增子命令 `checkpoint`，注册为 `PostToolUse`（`Write|Edit|Bash`）与 `PostToolUseFailure`（`Bash`）hook。工作区有 `.openspec-slice` 标记时，把该切片 `owns` 内的改动（含未提交、未跟踪文件）用临时 index 拍成一个 commit，写到 `refs/flight/<change>/<S>`；不碰真实 index、HEAD 与工作区；没有标记或任何异常时静默退出 0。
- **恢复**：`slice-gate.py start` 新增 `--resume-checkpoint`。工作区已有同片标记时沿用既有 resume；否则若快照存在且 HEAD 是它的祖先，把快照相对 HEAD 的 owns 内改动恢复为未提交改动，stdout JSON 带 `checkpoint.restored`；基点不符则不恢复并在 `checkpoint.note` 说明。
- **生命周期**：首轮 `start`（写新标记、不带 `--resume-checkpoint`）先删本切片旧快照；`gate` 绿时删快照；红时保留。
- **重派**：`opsx-apply.js` 执行体 `agent()` 返回 null 时也重派一次，prompt 说明上一轮未返回、`start` 带 `--resume-checkpoint`、在恢复的半成品上继续；重派仍为 null 记 `infra` blocked，reason 写明已重派。门禁红的既有重试（cherry-pick 上一轮 commit + `--base`）不变。
- **同改**：`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` 的 Agent 回退路径写同一语义；`slice-executor.md` 开工段说明 `--resume-checkpoint` 与 `restored`；`template/.claude/hooks/hooks.json` 与本仓 dogfood 的 `.claude/settings.json` 注册 hook。

**不改**：`maxTurns: 40`；门禁红重试的 cherry-pick 路径；fix 阶段（历史 42 次 fix 未返回 0 次）；跨飞行接续（用户裁决：快照只在本次飞行内的重派里使用）；`takeoff-gate.py` / `stop-gate.py`。

## Capabilities

### New Capabilities

- `slice-checkpoint`：切片工作中 owns 内改动的自动快照、`start --resume-checkpoint` 的恢复判据、快照的创建与清理时机。
- `noreturn-retry`：工作流与 Agent 回退路径对"执行体未返回"的重派一次语义、执行体契约与 hook 注册。

### Modified Capabilities

无。既有 `slice-retry-resume`（门禁红重试接续）行为不变。

## Impact

- **代码**：`template/.claude/hooks/slice-gate.py`（`checkpoint` 子命令 + `start --resume-checkpoint` + 两处删 ref，约 90 行）· `template/.claude/workflows/opsx-apply.js`（重派条件与 prompt 分支，约 15 行）。
- **配置**：`template/.claude/hooks/hooks.json` 新增两条 hook；`install.sh` 按 command 幂等合并 hooks.json，下游升级即生效，无需改 install.sh。本仓 `.claude/settings.json` 同步注册用于 dogfood。
- **契约**：新 git 引用命名空间 `refs/flight/<change>/<S>`（本地，不 push）；`start` 新增 `--resume-checkpoint`，其 stdout JSON 新增 `checkpoint` 字段；工作流 blocked 的 reason 新增"已重派"写法。
- **文档**：`opsx-apply.md` / `openspec-apply-change/SKILL.md` 回退路径、`slice-executor.md` 开工段。
- **测试**：`tests/test_slice_gate.py` +6 · `tests/test_agents_workflow.py` +3。既有 `test_workflow_routes_models_explicitly`（`agent(` 数 = `model: models.` 数）、`test_workflow_start_carries_expect_branch`（G0 拒绝后重派不 cherry-pick）、`test_apply_docs_mirror_retry_and_preflight` 必须继续通过。
- **代价**：每次执行体 Write / Edit / Bash 多一次 python 启动与几条 git plumbing 命令；无标记的会话只多一次 `git rev-parse`。
- **依赖**：无新增，纯 stdlib + git。
