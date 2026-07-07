# DRAFT. 模板分发的模型路由默认策略

- Status: accepted
- Date: 2026-07-07

## Context

模板通过 `.claude/`（commands / skills / agents）与 `CLAUDE.md.snippet` 分发给不特定下游项目。任务在两处消耗模型：主会话（所有 slash command 跟随用户当前 `/model` 层级）与 subagent（Agent 工具派发）。此前模板缺乏统一的模型路由默认：

- subagent 的 Sonnet 兜底只存在于维护者个人机器的环境变量，未随模板分发 → 下游派出的机械 subagent 默认跑 Opus。
- 低推理命令（渲染 / 探索 / 同步）无任何降级引导，主会话在 Opus 时全程 Opus。
- 路由纪律未进 `CLAUDE.md.snippet`，下游拿不到「简单活降级」约束。

后果是低推理任务系统性错配到 Opus，token 成本约 5× 浪费。需要一条跨后续变更都成立的默认策略，供以后新增命令 / subagent 时对齐，避免每次重新决策或再次错配。

## Decision

模板采用「**面兜底 + 点加固 + 主会话软引导**」三层模型路由默认，且**主会话侧只引导不强制**：

1. **subagent 兜底（面）**：模板携带可分发的 `.claude/settings.json`，设 `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`。所有未显式声明 `model:` 的 subagent 默认 Sonnet；下游零操作生效；用户 settings.local 显式配置仍优先。
2. **纯机械 subagent 显式降级（点）**：对 delta 搬运、读文件核验这类零推理派发点，在派发指令中显式标注 Sonnet，使意图自解释、且兜底缺失时仍正确。**需推理的 subagent 保留 inherit**——实现类用 `general-purpose`、评审类用 `code-reviewer`（其定义已 `model: inherit`）。
3. **主会话低推理命令软引导**：低推理命令 / skill 用引用块引导「建议 `/model sonnet`」，**不得**通过 frontmatter 强制锁 `model:`，保留用户使用 Opus 的选择权（遵循「确定性配置压过软约束、但软约束不越权强制」）。
4. **路由纪律下发**：`CLAUDE.md.snippet` 携带精简版路由纪律（默认 Sonnet 的任务类别 / 仅复杂升 Opus / 主会话自查手动切换）。

任务分层判据：搜索 · 读文件 · 探索 · 渲染 · 机械同步 · 按固定判据打分 → Sonnet；复杂多步重构 · 架构决策 · 难 bug 根因 · 长链设计 → Opus。

## Consequences

- **更易**：下游装模板即获得成本合理的默认路由，无需手动配置；新增命令 / subagent 时有明确判据（低推理→引导 Sonnet / 纯机械 subagent→显式 Sonnet / 需推理→inherit）。
- **更易**：机械 subagent 与低推理命令的 token 成本显著下降（约 5×）。
- **更难 / 代价**：主会话软引导不能保证生效（用户可忽略）——这是刻意保留选择权的代价，由 subagent 侧硬兜底与显式降级补偿。
- **约束后续变更**：新增 subagent 派发点须按性质选层级；新增低推理命令须带引导块且不锁 frontmatter；`settings.json` 的 env 段是下游可合并的最小集，安装时不应覆盖下游既有 settings。
- 若未来引入运行期模型自动切换或更细的路由机制，应记录一条新 ADR supersede 本条，而非修改本文件。
