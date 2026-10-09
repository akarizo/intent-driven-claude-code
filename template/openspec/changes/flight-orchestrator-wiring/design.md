## Context

- **前置**：本 change 基于 `flight-orchestrator-core`（3a）的分支，两者合成一个 PR 进 main。3a 已有：
  - 状态机核心 `core.ts`；
  - 副作用层 `io.ts`；
  - 合回过程 `land.ts`；
  - 提示词 `prompts.ts`；
  - 编排 `orchestrator.tsx`（接管 `/opsx-apply`、收口门禁、结束兜底、合回与解冲突、状态行、类型隐藏）。
  
  `landing.tsx` 还是空壳；`orchestrator.tsx` 用本文件内的空壳 `landingHere` 承接落地动作。
- **3a 第一次飞行实测的约束**：
  - **X12**：`$` 只能传进同一文件里声明的函数，跨 import 会被 `claude plugin validate` 拒绝；闭包可以跨文件传。
  - **X13**：`claude plugin test` 里测试与插件是两个隔离的模块实例。
  - **X11**：每个插件只能有一个 hooks 模块（入口 `register.tsx`）。
  - **同一事件的第二个 hook 须带 matcher**：执行体报告，未独立核实；`orchestrator.tsx` 的 turn.complete 已带 `{ agentId: /./ }`。
- **在用 ADR**：`DRAFT-flight-orchestrator-state-machine`（3a 新增）、`DRAFT-flight-control-plane-in-mod`。本 change 不改变其中任何决定，只是落地方式服从 X12 / X13。

## Goals / Non-Goals

**Goals**
- 编排能从起飞一路走到落地：派评审员、回收 findings、批量修复、final、落地接 `/pr-ship`、停飞。
- 关闭 3a 评审的 5 条 HIGH，每条都由一个 scenario 测试钉住（见文末对照表）。
- 落地逻辑可以不经 hook，直接用假 `Ctx` 测试，绕开 X13。

**Non-Goals**：3a 评审的其余 MEDIUM / LOW；3b / 3c 的内容。

## Decisions

### D1 · `$` 只在 `orchestrator.tsx` 里出现，其他模块收 `Ctx`

```
register.tsx ── registerOrchestrator(on) ──► orchestrator.tsx   唯一注册飞行 hook 的文件；ctxOf($) 造 Ctx
                                                │  Ctx = { io, now, spawn, status, toast, runCommand }（全是闭包）
                                                ├─► core.ts      纯函数 + 类型（新增 Ctx、Found）
                                                ├─► io.ts        只收 Io（删除收 $ 的 ioOf / spawnAgent）
                                                ├─► land.ts      只收 Io
                                                ├─► prompts.ts   纯函数
                                                └─► landing.tsx  onFindings / onLandingStop / runLandingAction，只收 Ctx
```

- `Ctx` 放在 `core.ts`（类型层），与 `Io` 并列：
  - `Found = { flight: Flight; events: FlightEvent[] }` 是「这个 agent 属于哪次飞行」的查找结果；
  - 由 hook 层调用 `io.flightOfAgent` 得到，再传给 landing。
- **否决**：每个需要 `$` 的模块各写一份 `ioHere`。3a 已经出现 `io.ts` 与 `orchestrator.tsx` 两份等价实现，再多一份更容易漂移。

### D2 · 查飞行只靠账本（`io.flightOfAgent`）

- 先查进程缓存 `flights`；未命中时：
  1. `git for-each-ref --format=%(refname) refs/flight/`，取以 `/ledger` 结尾的；
  2. 对每个 change：`trees(io, '.')`（会话 cwd）取主 worktree → `judgesDir` → 找分支为 takeoff.branch 的 worktree → 探测 changeDir → `readLedger`；
  3. 跳过已 land / halt 的账本，找 dispatch.agent 匹配者，重建 `Flight` 并写回缓存。
- 签名不变（`flightOfAgent(io, agentId)`），3a 的调用点不用改。

### D3 · drive 的出路闭合

- **落地动作**：dispatch reviewer / fixer、final、land、halt 交给 `runLandingAction(ctxOf($), f, a)`；`landingHere` 删除。
- **防空转**：每轮记下读到的事件数；执行完本轮动作后再读一次，数量没变就停止。
- **起飞异常**：`command.run` 的 hook 内 `try/catch` 包住 takeoff；hook 再加 `.catch`，两处都回复「flight：起飞异常，不起飞（<首行>）」。任何路径都不 `next(e)`，只有 `--engine=workflow` / `--gate=per-task` 例外。

### D4 · 落地逻辑（`landing.tsx`）

- **复用代码**：大部分逻辑来自 3a S8 那次未合入的提交 `bcb74e6`（可用 `git show` 读），改为收 `Ctx` 与 `Found`。
- **提醒状态**：「评审员已提醒过」记在模块内的 Set 里。生产环境只有一个模块实例；测试用不同的 agentId。
- **final 前**：先 `land.commitRecords`（3a 评审 HIGH 3）。

### D5 · 评审员看第一父 diff

`prompts.reviewerPrompt` 与 `agents/reviewer.md` 都改为 `git diff <commit>^1 <commit>`；取不到 diff 或为空时，提交 HIGH 的「取 diff 失败」（3a 评审 HIGH 1 与相关 MEDIUM）。

## HIGH → 关闭它的 scenario

| 3a 评审 HIGH | 关闭它的 scenario |
|---|---|
| 1 评审员 `git show` 合并提交看不到 diff | `flight-agent-types#prompts-reviewer-diffs-against-first-parent` · `#reviewer-body-treats-missing-diff-as-high` |
| 2 CAS 重试测试拦不住回归 | `flight-io#io-cas-rereads-tip` |
| 3 final 前接口摘要没提交 | `flight-integration#land-commits-only-records` · `flight-findings-intake#landing-runs-pr-ship`（final 前先提交记录） |
| 4 drive 没接上落地逻辑 | `flight-orchestrator#drive-hands-landing-actions` |
| 5 起飞异常落回模型 | `flight-orchestrator#takeoff-exception-stays-grounded` |

## Risks / Trade-offs

- [新的平台约束未被发现] → 每个切片的 verify 都含 `tests/test_flight_plugin.py`（它跑 `claude plugin validate`），加载失败会立即变红。
- [执行体撞 40 轮上限] → 切片拆小，单片最多 6 个 scenario；切片包给出精确签名与可复用的提交。
- [mod 灰度开关被存成关闭] → 门禁大面积红时，先跑一次 `claude -p` 联网刷新，再判代码。

## Migration Plan

1. 本 change 在旧机制上飞（与 3a 相同：Workflow 加稳定快照）。
2. 落地后，本分支包含 3a 与本 change，一个 PR 进 main。3a 的 5 条 HIGH 由上表的 scenario 证明关闭，PR 评审再独立复核。
3. 合入后发布插件 0.2.0，3b 用新状态机飞。

## Open Questions

无。
