## Why

intent-driven 工作流当前有 6 个 code review 触发点，其中 4 个必发。它们的 diff 范围是**包含关系而非互补关系**：

- 逐 task 守门审「单 task 净 diff」
- full review 审「本 change 累计 diff」——**完全包含**前者审过的全部代码
- `/pr-ship` 评审审「PR ↔ target diff」——与累计 diff 几乎相同，只多出工件 commit

结果是同一份实现代码被**全量 review 3 次**，TDD 纪律维度被**触及 4 次**，每次都由同一个 `code-reviewer` agent 按同一套 rubric 从零重扫。浪费的不只是 token 与时长：重复上报同样的 finding 会稀释真问题的信号，也让「守门已通过」这个结论失去意义。

三条根因：

1. **范围包含而非互补**。`README.md` 第 213 行断言「一个定义服务三处，靠不同 diff 范围区分，不会把同一段代码白审两次」——但 `单 task ⊂ 累计 ≈ PR` 的包含关系恰恰意味着重复。该断言在文档里成立、在执行中不成立。
2. **跳过条件写成了软判断**。`openspec-subagent-apply-change` 给 full review 留的跳过条件之一是「用户计划立即 `/pr-ship`」。模型无法可靠判定「用户计划」，默认结果是两个都跑。另一条「只有 1 个 task」是硬条件、能生效，但覆盖面窄。
3. **全流程没有「已审到哪」的状态**。`code-reviewer` 的 system prompt 只规定了怎么审，**没有任何「不重复上报」的约束**，也拿不到「哪段范围已被守门通过」「哪些 finding 已被登记为 deferred」。它对拿到的 diff 全维度重扫，行为完全正确——只是被喂了重复的输入。

顺带暴露一处既有漂移：`commands/opsx-verify.md` 只有 3 个维度，而 `skills/openspec-verify-change/SKILL.md` 有 3 维 + Test Discipline Check，README 阶段 5 跟 skill 走。命令与 skill 已不一致。

## What Changes

引入 **review 水位线（review watermark）**：记录已被守门通过的 commit 边界与已处理的 finding，后续每个 review 点先读它再决定审什么。一条原则——**一份代码只被全量审一次，此后所有 review 只审增量，或只审上一次审不到的维度**。

- **新增水位线载体**：`openspec/changes/<change>/review-log.md`。逐 task 守门通过后由主会话追加记录（已审区间、结论、阻断并修复项数、deferred 清单）。已实测 `openspec validate --strict` / `status` / `list` 均忽略该文件。
- **整合审改为一次且位置明确**：全部 task 完成后用 AskUserQuestion 明确问下一步——选「立即 pr-ship」则**跳过本地 full review**，整合审交给 `/pr-ship`（那里本来就必须产出一份贴 PR 的报告）；选「暂不 ship」才在本地跑，且只审跨 task 维度。保留既有硬条件：task 数 = 1 恒跳过。
- **`/pr-ship` 评审改为水位线感知的三种模式**：水位线覆盖全部代码 commit → `integration`（只审跨 task 交互 / 整体一致性 / 端到端 spec 完整性 / 工件与实现一致性）；部分覆盖 → 未覆盖增量走全量、已覆盖部分只走整合维度；无水位线 → 保持今天的全量审，行为不变。
- **PR 评论呈现审查深度与 deferred 清单**：让人类 reviewer 知道 AI 审到什么程度，并把守门期间未阻断的 MEDIUM/LOW 带进 PR——**这是今天会丢失的信息**。
- **复审改为增量闭环复核**：`/pr-ship` 再走一轮时只审修复补丁 + 逐条核对上轮 CRITICAL/HIGH 是否闭环；逐 task 回灌复审同理，只审修复 commit。
- **修复统一新增 `fix:` commit、不再 `--amend`**：让增量区间锚点始终明确（task 全部通过后可在 PR 阶段 squash）。
- **`/opsx-verify` 的测试纪律检查按水位线降级**：走过守门 → 只验配对测试文件存在 + 抽样确认 GWT 注释存在；无水位线 → 保持完整抽查。同时把 `opsx-verify.md` 命令补上 Test Discipline 维度，修掉与 skill 的漂移。
- **`code-reviewer` agent 增加 review 模式与「不重复上报」铁律**：定义 `full` / `integration` / `follow-up` 三种模式各自的「必须报」与「不得报」；确认上游 finding 未真正闭环时仍可上报，但须标注「上游 review 未闭环」——保留纠错能力，堵掉无脑重扫。
- **文档同步**：`README.md` 与 `docs/WORKFLOW_zh.md` 的守门表改写为真实的水位线分层模型，删掉已不成立的「互补不重复」断言。

## Capabilities

### New Capabilities

- `review-orchestration`: 规约多个 code review 守门点之间的编排契约——每个守门点审什么 diff 范围、审查状态如何跨守门点传递（水位线）、评审模式如何约束上报范围、以及未阻断 finding 如何上浮到人类 reviewer。它回答的是「谁审什么、谁不再重复审谁」，而不是「怎么审」（后者属于 `code-reviewer` agent 的 rubric，本 change 不改）。

### Modified Capabilities

<!-- 无。`template/openspec/` 下尚无已归档 specs，本 change 引入的是全新的 review 编排契约层。 -->

## Impact

- **新增文件**：`template/openspec/changes/<change>/review-log.md` 的格式契约（由 skill 定义并生成，非本仓库静态文件）
- **skill（2）**：`openspec-subagent-apply-change/SKILL.md`（水位线写入 · 整合审硬判定 · 聚焦复核 · 修复不 amend）、`openspec-verify-change/SKILL.md`（测试纪律按水位线降级）
- **command（3）**：`pr-ship.md`（三模式评审 · 审查深度声明 · 增量复核）、`opsx-verify.md`（补 Test Discipline 维度）、`opsx-apply.md`（模式选项描述同步）
- **agent（1）**：`code-reviewer.md`（review 模式 + 不重复上报铁律）
- **文档（2）**：`README.md`、`docs/WORKFLOW_zh.md`
- **不影响**：`intent-gate.py` 门禁、`test-driven-development` skill 的 TDD 铁律、`code-reviewer` 的分级标准与 finding 格式、openspec schema、任何业务逻辑。全部为指令文案改动。
- **向后兼容**：无水位线时全部路径退回今天的行为，串行（轻量）模式与 `/opsx-bulk-apply` 不受影响。
- **依赖**：无新增依赖。
