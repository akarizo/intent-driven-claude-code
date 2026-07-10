## Why

2026-07-10 对本机 24h token 用量的实测调查（103 个会话转录、8848 条计费消息逐条聚合）发现：PR #20 的 subagent 模型路由**已生效**，但仍有两处未被模板覆盖的浪费源——(1) 主会话长上下文失控（44% 的 prompt 量发生在 >200k 上下文）。主会话采用 `[1m]` 长上下文变体是刻意保留的合理默认（1M 无加价、长任务不被 200k 硬切），但代价是失去 200k autocompact 的自动兜底——上下文闸门完全落到人工纪律上，而当前缺这套纪律：不主动 compact、挂机会话不重启、马拉松 subagent。(2) 现有 Model 路由段的描述与官方优先级**相反**：它暗示可给 subagent 传 `model: opus` 升级，但官方 code.claude.com/docs sub-agents 已核实 `CLAUDE_CODE_SUBAGENT_MODEL` env var 优先级最高，锁 sonnet 后传参无效——这是一条会导致"以为升了 opus 实则 sonnet"返工的死条款。模板应把这些纪律与更正下发给所有使用者。

## What Changes

- **新增「上下文纪律」段**到 `template/CLAUDE.md.snippet`：主会话用 `[1m]` 变体时无 200k autocompact 自动兜底，故人工纪律是唯一闸门——>150k 主动 `/compact`，切任务用 `/clear` 而非同会话续命；挂机长会话跨天必重启（`model` 不热更新，`env` 才热更新）；子 agent 单任务 scoped，预计超 ~100 轮或上下文 150k 先拆阶段、每阶段新开 agent 收束汇报，禁马拉松 subagent。
- **BREAKING（对模板语义）修正现有「Model 路由（省 token）」段**：把"派发时给 subagent 传 `model: opus` 升级"更正为官方优先级——`CLAUDE_CODE_SUBAGENT_MODEL` env var > Task 显式 `model` 参数 > agent frontmatter > 继承主会话；env 锁 sonnet 后所有 subagent（含内置 general-purpose/Explore/Plan）一律 Sonnet，传 `model:` 无效；确需 Opus 级子任务 → 主会话直接做，或临时把 env 改 `inherit` 再派发。

## Capabilities

### New Capabilities
- `context-lifecycle-discipline`: 模板下发的主会话上下文与会话生命周期纪律——`[1m]` 变体下的人工 compact/clear 闸门、挂机会话重启、subagent 上下文封顶。

### Modified Capabilities
- `model-routing-defaults`: 更正 subagent 模型解析优先级的描述——env var 优先级最高、压过 Task 显式 `model` 参数，原"派发时升 opus"路由失效。

## Impact

- 文件：`template/CLAUDE.md.snippet`（下发内容变更，影响所有 install 该模板的项目）。
- 无代码/API/依赖变更，纯文档契约。
- 依据：本机 24h 用量调查 + 官方文档 code.claude.com/docs sub-agents 优先级核实。
