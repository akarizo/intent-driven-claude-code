## 1. 修正 Model 路由段（model-routing-defaults）

- [x] 1.1 在 `template/CLAUDE.md.snippet` 的「## Model 路由（省 token）」段，把「派发时给 subagent 传 model 参数升 opus」的描述改为官方优先级铁律：`CLAUDE_CODE_SUBAGENT_MODEL` env var > Task 显式 `model` 参数 > agent frontmatter > 继承主会话；env 锁 sonnet 后传 `model:opus`/`model:haiku` 无效（含内置 general-purpose/Explore/Plan）
- [x] 1.2 在同段补上「获取 Opus 级子任务的正确做法」：主会话直接做，或临时把 env 改 `inherit` 再派发；删除或改写任何暗示「派发 opus subagent」的措辞
- [x] 1.3 保留原有「主会话对低推理命令手动 /model sonnet」的引导（该行未失效）

## 2. 新增上下文纪律段（context-lifecycle-discipline）

- [x] 2.1 在 `template/CLAUDE.md.snippet` 新增一段「## 上下文纪律」，位置紧邻 Model 路由段
- [x] 2.2 该段写入 `[1m]` 变体的上下文闸门语义：`[1m]` 是合理默认（1M 无加价、长任务不被 200k 硬切），但失去 200k autocompact 自动兜底，故 compact/clear 等人工纪律成为唯一闸门
- [x] 2.3 该段写入 compact/clear 阈值：>150k 主动 `/compact`；切任务用 `/clear` 而非同会话续命
- [x] 2.4 该段写入挂机会话重启：跨天必重启会话，注明 `model` 不热更新（仅 `env` 热更新）导致旧会话停在启动时模型
- [x] 2.5 该段写入 subagent 上下文封顶：子 agent 单任务 scoped，预计超 ~100 轮或上下文 150k 先拆阶段、每阶段新开 agent 收束汇报，禁马拉松 subagent

## 3. 验证与收束

- [x] 3.1 排版遵循 CLAUDE.md 层级规范：一事一行、`**bold**` 起头、⚠ 标危；两段落在自由扩展区顺序合理
- [x] 3.2 运行 `openspec validate template-context-model-discipline --type change --strict` 全绿
- [x] 3.3 人工复核改后的 snippet：Model 路由段无「传 model:opus 可升级」的残留误导，上下文纪律段四类约束齐全
