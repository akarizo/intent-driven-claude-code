## Context

2026-07-10 对本机 24h token 用量的逐条聚合调查显示：PR #20（ADR「模板分发的模型路由默认策略」）的 subagent Sonnet 兜底已生效，但两处未被模板覆盖：

1. **主会话长上下文**——44% 的 prompt 量发生在 >200k 上下文。主会话用 `[1m]` 变体是刻意保留的合理默认（1M 无加价、长任务不被 200k 硬切），但代价是失去 200k autocompact 的自动兜底——会话可自然涨到 400–554k，上下文闸门完全落到人工纪律上；而当前缺这套纪律：不主动 compact、挂机会话不重启（`model` 配置不热更新）、马拉松 subagent（实测单个 688 消息/344k ctx/1.15 亿 cache reads）。
2. **Model 路由段的描述错误**——现有 `CLAUDE.md.snippet` 的路由段暗示「派发时给 subagent 传 `model: opus` 升级」，但官方 code.claude.com/docs sub-agents 已核实 `CLAUDE_CODE_SUBAGENT_MODEL` env var 优先级最高、压过 Task 显式 `model` 参数，锁 sonnet 后传参无效。这是一条会导致返工的死条款。

当前唯一 in-force ADR 是 `DRAFT-model-routing-defaults-for-template.md`（accepted，未被 supersede）。本变更是对其第 4 条「路由纪律下发」的**描述精化**（把 env 优先级写对）+ 新增一段上下文纪律，未改变其三层策略架构，因此不需要新 ADR supersede。

## Goals / Non-Goals

**Goals:**
- 让 `CLAUDE.md.snippet` 下发的路由纪律如实反映官方 env-var 优先级，消除「传 model:opus 升级」的误导。
- 新增上下文纪律段，把 `[1m]` 变体下的人工 compact/clear 闸门、挂机重启、subagent 上下文封顶下发给下游。

**Non-Goals:**
- 不改主会话默认使用 `[1m]` 变体——这是刻意保留的合理选择（1M 无加价、长任务不被 200k 硬切），本变更只补上因此缺失的人工上下文闸门纪律。
- 不改 `settings.json` 的 `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` 兜底（它是正确的，本变更只是把文档写对）。
- 不引入任何运行期自动切换 / hook 强制机制——上下文纪律是主会话软约束（与 ADR 的「主会话只引导不强制」一致）。
- 不 supersede 现有 ADR。

## Decisions

**决策 1：Model 路由段改为「优先级铁律 + 正确做法」而非「传参升级」。**
- 理由：官方优先级 env var > Task 参数 > frontmatter > 继承。锁 sonnet 后 subagent 传 `model:` 无效，原描述会让下游写出无效代码并返工。
- 备选（已否）：保留原描述但加注「本机已锁 sonnet」——仍会让不了解优先级的下游误解，且模板面向不特定下游（有的没锁），不如把优先级本身讲清。
- 正确做法写入：确需 Opus 级子任务 → 主会话直接做，或临时把 env 改 `inherit` 再派发。

**决策 2：上下文纪律作为独立新段，而非塞进 Model 路由段。**
- 理由：上下文管理（compact/clear/[1m]/会话生命周期）与模型选择是两个正交关注点，混在一段会稀释各自的可执行性；`context-lifecycle-discipline` 独立成 capability 也让后续演进独立。
- 备选（已否）：合并进 Model 路由段——违反「一段一关注点」，且 snippet 尺寸会失衡。

**决策 3：上下文纪律是软约束，不加 hook 强制。**
- 理由：与 ADR 第 3 条「主会话只引导不强制、保留用户选择权」一致；`[1m]` 与 compact 时机需人判断，硬闸门会误伤超长合法任务。
- 补偿：subagent 上下文封顶那条给出可执行的拆分判据（>100 轮 / >150k 先拆阶段），比纯口号更易落地。

## Risks / Trade-offs

- **[软约束不保证生效]** → 与 ADR 既有取舍一致；上下文纪律面向主会话（本就无法硬管），提供明确阈值降低忽略概率。
- **[snippet 变长，逼近尺寸预算]** → 新增一段 + 改写一段，净增约 6–8 行；仍在 snippet 合理范围，若超预算后续 `/claudemd-distill`。
- **[下游已 fork 旧 snippet 不会自动更新]** → 模板变更的固有特性；本变更通过 PR 合入后由下游自行 re-install/同步，不追求热更新。

## Migration Plan

- 纯文档变更，改 `template/CLAUDE.md.snippet` 一个文件。
- 部署：PR 合入 main 后，新 install 的项目自动获得；已有项目按各自节奏同步 snippet。
- 回滚：单文件 git revert 即可，无状态、无数据迁移。

## Open Questions

- 无。现有 in-force ADR 无需 revisit——本变更在其架构内做描述精化。
