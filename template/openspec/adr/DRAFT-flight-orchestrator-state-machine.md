# DRAFT. 飞行编排由 flight 插件里的状态机执行，状态是账本事件的归约

- Status: accepted, supersedes DRAFT-apply-as-flight
- Date: 2026-10-09
- Supersedes: DRAFT-apply-as-flight（该 ADR 在 main 上尚未编号，按文件名引用）
- 关联：DRAFT-flight-control-plane-in-mod（本 ADR 是其第 5 条「再迁编排」的落地）· DRAFT-approval-bound-to-plan-fingerprint
- 评审记录：`docs/flight-orchestrator.html`（决策 D1–D10 · 2026-10-09 实测 X1–X11）

## Context

`DRAFT-apply-as-flight` 的第 3 条规定「调度用确定性脚本」：命名工作流 `opsx-apply.js` 按 DAG 分 wave 派发，Workflow 不可用时用 Agent 工具回退。Workflow 运行时按设计没有副作用权，于是合回、跑门禁、记账只能派模型做（integrator），门禁结论也只能经执行体之口传回脚本。2026-10-09 一天三次真实飞行（PR #35 / #36 / #37）里出现的问题都出在这里：执行体撞轮次上限后门禁结论丢失，只好加「门禁结论 ref」找回；integrator 抛错会让整个 wave 合不回去；隔离之后 evidence.log 回不到分支。

`DRAFT-flight-control-plane-in-mod` 已决定控制权迁入插件，并约定编排迁移时以新 ADR 取代本条。2026-10-09 在 Claude Code 2.1.295 上补测：插件注册或随插件发布的 agent 类型能强制工具白名单、effort、maxTurns；`classic.SubagentStop` 里跑 65 秒的门禁不超时，连续 block 3 次 agent 都续跑；撞 maxTurns 停下时不触发 SubagentStop；插件工具能被派发的 agent 调用且带调用方 agentId；`command.run` 能零 token 接管项目命令；会话结束时插件派发的 agent 一并终止，续接后看不到。

## Decision

继承 `DRAFT-apply-as-flight` 的第 1、2、4、5 条（规格可执行、切片有所有权、机械门禁、评审离关键路径）。第 3 条改为：

1. **编排由 flight 插件里的状态机执行。** 人照旧发 `/opsx-apply`，插件接管起飞检查与整个飞行，主会话的模型不参与编排。
2. **飞行状态是账本事件的归约。** 状态机把派发、门禁结论、agent 结束、合回、评审、阻断、final、落地、停飞都追加到 `refs/flight/<change>/ledger`，下一步做什么只由这些事件推出。插件是唯一写者：approve 事件仍只由人按批准按钮写入；评审员经评审回收工具只能写 review 事件。
3. **门禁由控制面在执行体收口时现跑。** 执行体不再汇报门禁结论。红则让同一 agent 带着失败项续修，至多 2 次。agent 没有经过收口就结束（如撞 maxTurns）时，控制面在它结束时补跑门禁，红则在同一切片 worktree 上重派一次。
4. **机械动作是插件代码。** 建 worktree、合回、写飞行记录、抽接口摘要、落地收口都由插件执行，零 token。合回冲突交给解冲突 agent，它的结果同样由控制面判门禁。
5. **判定器从主 worktree 运行。** takeoff-gate、plan_fp、ledger、slice-gate、timeline、session-model 一律用主 worktree 里的副本，不用正在被修改的 change worktree 里的副本。
6. **执行体、评审员、修复 agent 的定义随插件发布，由插件派发、对模型隐藏。** 每次派发显式指定会话主模型；各 agent 的实际模型记入账本，收口时机械对账。
7. **不自动回退。** 旧 Workflow 引擎在删除前，只能由人用 `--engine=workflow` 显式选择；插件缺席或版本低于下限时不起飞。

否决的方案：
- 状态放在插件会话内存，收口时落文件：会话中断即丢失；`$.state` 是明文、模型可改（阶段 0 实测）。
- 执行体收口后判红就派新 agent 重做：每次重派都要冷启动重读切片包，比让同一 agent 续修贵。
- 继续以 Workflow 为默认、插件为可选：两套语义并存是漂移源，`DRAFT-flight-control-plane-in-mod` 已否决。

## Consequences

- **更易**：门禁结论不再经模型之口，「门禁结论 ref」找回机制可以退役；机械角色 integrator 消失；中断后再发 `/opsx-apply` 就能从账本接着飞；判定器不会被它要判定的 change 改掉。
- **更难**：状态机成为可信计算基，它本身的 bug 直接影响每次飞行，必须由 scenario 测试覆盖（`claude plugin test` 可模拟派发与收口事件）；`$.process.run` 单次最长 10 分钟，更大的测试套件需要改用流式子进程。
- **中性**：飞行中执行体的权限仍随会话的权限模式；按 agentId 限写与 `tool.check` 权限策略在后续 change 落地。旧引擎与 integrator 在后续 change 删除，届时改写铁律 10。
