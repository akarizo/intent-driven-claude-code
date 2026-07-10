# context-lifecycle-discipline

模板分发的主会话上下文与会话生命周期纪律：规约「随模板下发的 `CLAUDE.md.snippet` 应包含哪些上下文管理约束」这一可验证契约，覆盖 `[1m]` 变体下的人工 compact/clear 闸门、挂机会话重启、subagent 上下文封顶。

## ADDED Requirements

### Requirement: 上下文纪律随模板分发

模板携带的可分发指令片段（`CLAUDE.md.snippet`）MUST 包含一段「上下文纪律」，覆盖四类约束：`[1m]` 变体下失去 autocompact 自动兜底、故人工 compact/clear 阈值成为唯一闸门、挂机长会话跨天重启、subagent 单任务上下文封顶。使下游项目获得与调查结论一致的上下文管理纪律。

Rule: 主会话采用 `[1m]` 长上下文变体是合理默认（1M 无加价、长任务不被 200k 硬切），但代价是失去 200k autocompact 的自动兜底——上下文闸门完全落到人工纪律上。该段的目的是把这套人工纪律讲清，防止单个会话或 subagent 背几十万 token 历史被反复 cache read。

#### Scenario: 下游项目采用模板的 CLAUDE.md 片段并含上下文纪律段

- GIVEN 一个把 `CLAUDE.md.snippet` 并入自身 CLAUDE.md 的下游项目
- WHEN 该项目的主会话在这些指令约束下工作
- THEN 指令中包含一段「上下文纪律」
- AND 该段说明主会话用 `[1m]` 变体时无 200k autocompact 自动兜底，故人工 compact/clear 是唯一的上下文闸门

#### Scenario: 上下文纪律段规约 compact/clear 阈值

- GIVEN `CLAUDE.md.snippet` 已含上下文纪律段
- WHEN 主会话上下文增长
- THEN 该段要求上下文超 150k 时主动 `/compact`
- AND 切换到新任务时用 `/clear` 而非在同一会话续命

#### Scenario: 上下文纪律段规约挂机会话重启

- GIVEN `CLAUDE.md.snippet` 已含上下文纪律段
- WHEN 一个会话跨天挂机或长时间不重启
- THEN 该段要求跨天必重启会话
- AND 说明原因：`model` 配置不热更新（仅 `env` 热更新），旧会话会一直停在启动时的模型层级

#### Scenario: 上下文纪律段规约 subagent 上下文封顶

- GIVEN `CLAUDE.md.snippet` 已含上下文纪律段
- WHEN 派发或规划子 agent 工作
- THEN 该段要求子 agent 单任务 scoped
- AND 预计超 ~100 轮或上下文超 150k 的工作先拆阶段、每阶段新开 agent 收束汇报，禁止马拉松 subagent
