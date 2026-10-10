## Why

`flight-orchestrator-core`（阶段 3a）第一次飞行停在 final 34/41：S1–S7 门禁绿，S8（评审回收与落地接线）门禁红，修复 agent 两次撞 40 轮上限没有返回。实测出两条插件平台约束，原接线方式因此不成立：

- **X12**：`$` 只能传进同一文件里声明的函数，跨 import 会被 `claude plugin validate` 拒绝。所以编排模块调不了 `runLandingAction($, …)`：drive 永远不派评审员、不跑 final、不落地。
- **X13**：`claude plugin test` 里测试与插件是两个隔离的模块实例。靠模块内存登记飞行的写法测不通，模块重载后也会丢失飞行。

评审还给出 5 条 HIGH：
1. 评审员 `git show` 合并提交看不到 diff，独立评审实际失效；
2. CAS 重试测试拦不住「只读一次链尾」的回归；
3. final 前接口摘要没提交，ship 必判 draft；
4. drive 没接上落地逻辑；
5. 起飞异常会落回模型，旧引擎会把同一 change 再飞一遍。

剩余工作排不进 3a 的切片配额，用户决定拆出本 change。本 change 基于 3a 的分支，两者合成一个 PR 进 main。

## What Changes

- **落地逻辑不碰 `$`**（`landing.tsx`）：
  - 导出以上下文对象 `Ctx` 为参数的三个函数：评审回收（`onFindings`）、评审员 / 修复 agent 收口（`onLandingStop`）、落地动作（`runLandingAction`：派评审员、派修复 agent、final、落地接 `/pr-ship`、停飞）；
  - final 前先提交飞行记录；
  - 删除 `registerLanding`，`register.tsx` 不再调用它。
- **合回过程**（`land.ts`）：导出只提交飞行记录的函数；准备解冲突现场时，合并因非冲突原因失败要报错，不再返回空冲突列表。
- **评审员看第一父 diff**（`prompts.ts`、`agents/reviewer.md`）：用 `git diff <commit>^1 <commit>`；取不到 diff 时提交 HIGH 的「取 diff 失败」，不得提交空列表放行。
- **按 agent 找飞行只靠账本**（`io.ts`）：
  - 缓存未命中时，从 `refs/flight/*/ledger` 重建飞行上下文；
  - 删除以 `$` 为参数、跨文件无法调用的 `ioOf` 与 `spawnAgent`；
  - CAS 测试改为验证「失败后以新链尾为父重试」。
- **接线**（`orchestrator.tsx`，唯一注册飞行 hook 的文件）：
  - 从 `$` 造 `Ctx`；注册 `submit_findings` 工具并转给 `onFindings`；
  - 评审员 / 修复 agent 的收口转给 `onLandingStop`；
  - drive 把落地动作交给 `runLandingAction`；
  - 起飞或 drive 抛异常时，回复含「异常」的文本，不落回模型；
  - 一轮没有新增账本事件就停止。
- **收窄批准带断言**：插件注册的工具恰为 `submit_findings`，没有斜杠命令；它写不了 approve。
- **版本**：插件升到 0.2.0，marketplace 描述同步。

## Capabilities

### New Capabilities
- `flight-findings-intake`：评审回收工具只认本次飞行的评审员；评审员不提交就收口时提醒一次；修复 agent 收口跑 final；落地前提交记录、落地接 `/pr-ship`；final 红停飞；唯一的工具写不了批准（从 3a 移入）。

### Modified Capabilities
`openspec/specs/` 下没有已归档的规格。下面四项以 ADDED 补充 3a 同名能力（两个 change 合并后归档）：
- `flight-io`：账本追加失败后以新链尾为父重试；按 agent 找飞行只靠账本。
- `flight-integration`：飞行记录可单独提交；解冲突现场不吞合并失败。
- `flight-orchestrator`：起飞异常不落回模型，drive 接上落地且不空转。
- `flight-agent-types`：评审员看的是切片相对第一父的改动。

## Impact

- **插件** `template/plugins/flight/`：`hooks/landing.tsx`、`land.ts`、`prompts.ts`、`io.ts`、`orchestrator.tsx`、`core.ts`（加 `Ctx` 类型）、`register.tsx`（删一行接入）、`agents/reviewer.md`、`.claude-plugin/plugin.json`，以及对应的 TS 测试。
- **仓库根**：`.claude-plugin/marketplace.json`。
- **测试**：`tests/test_flight_land.py`、`test_flight_agents.py`、`test_flight_io.py`、`test_flight_landing.py`、`test_flight_orchestrator.py`、`test_flight_plugin.py`。
- **不在范围**：3a 评审的其余 MEDIUM / LOW（随 PR 贴出）；3b / 3c 的内容。
