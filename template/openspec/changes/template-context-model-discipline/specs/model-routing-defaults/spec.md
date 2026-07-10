# model-routing-defaults

模板分发的模型路由默认层：规约「哪类任务应跑哪个模型层级」这一可验证契约，覆盖 subagent 兜底、低推理命令的模型引导、纯机械 subagent 的显式降级、以及随模板下发的路由纪律。

## MODIFIED Requirements

### Requirement: 模型路由纪律随模板分发

模板携带的可分发指令片段（`CLAUDE.md.snippet`）MUST 包含一段精简的模型路由纪律，且该纪律 MUST 如实反映官方 subagent 模型解析优先级——`CLAUDE_CODE_SUBAGENT_MODEL` env var > Task 显式 `model` 参数 > agent frontmatter > 继承主会话。该段 MUST NOT 暗示「派发时给 subagent 传 `model: opus` 可升级」，因为在 `settings.json` 锁定 `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` 时该传参无效（含内置 general-purpose / Explore / Plan）。使下游项目获得与官方优先级一致、不产生返工误导的路由约束。

Rule: env var 优先级最高，压过一切。确需 Opus 级子任务的正确做法是「主会话直接做」或「临时把 env 改 `inherit` 再派发」，而非给 subagent 传 `model:` 参数。

#### Scenario: 下游项目采用模板的 CLAUDE.md 片段

- GIVEN 一个把 `CLAUDE.md.snippet` 并入自身 CLAUDE.md 的下游项目
- WHEN 该项目的主会话在这些指令约束下工作
- THEN 指令中包含精简版 Model 路由段
- AND 该段说明：搜索 / 读文件 / 探索 / 渲染 / 机械同步默认 Sonnet；主会话对低推理命令需手动 `/model sonnet`（因环境变量管不到主会话）

#### Scenario: 路由段如实反映 env var 优先级

- GIVEN `CLAUDE.md.snippet` 已含 Model 路由段
- WHEN 下游读者查阅如何给某个 subagent 使用 Opus
- THEN 该段声明 `CLAUDE_CODE_SUBAGENT_MODEL` env var 优先级最高，压过 Task 显式 `model` 参数与 agent frontmatter
- AND 该段说明在 env 锁 sonnet 时，给 subagent 传 `model: opus` / `model: haiku` 无效（含内置 general-purpose / Explore / Plan）

#### Scenario: 路由段给出获取 Opus 级子任务的正确做法

- GIVEN 一个确需 Opus 级推理的子任务（复杂多步重构 / 架构决策 / 难 bug 根因 / 长链推理设计 / 跨大量文件语义综合）
- WHEN 下游主会话依据路由段决定如何执行
- THEN 该段建议主会话直接做，或临时把 env 改 `inherit` 后再派发
- AND 该段不建议依赖「派发一个 opus subagent」的失效路径
