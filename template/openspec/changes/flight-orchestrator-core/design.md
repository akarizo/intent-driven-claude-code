## Context

- **现状**：`/opsx-apply` 由主会话的模型手走命令 step 0–7。它启动命名工作流 `opsx-apply.js`，脚本派发执行体、integrator（sonnet）、评审员、修复 agent，所有机械动作都经模型完成。根因诊断与原则见 `docs/flight-control-plane.html`，阶段 3 决策 D1–D10 与补测 X1–X11 见 `docs/flight-orchestrator.html`。
- **在用的 ADR**：
  - `DRAFT-flight-control-plane-in-mod`：控制面迁入插件、判定器保持纯 Python、账本放在 git ref、控制面缺席即停飞、分阶段迁移、飞行运行已安装的稳定版本；
  - `DRAFT-approval-bound-to-plan-fingerprint`：批准即按钮写入账本、绑定计划指纹；
  - `DRAFT-apply-as-flight`：本 change 以新 ADR `DRAFT-flight-orchestrator-state-machine` 取代它，第 1、2、4、5 条继承。
- **约束**：
  - 插件只能挂一个 hooks 模块（X11）；
  - `$.process.run` 单次最长 10 分钟；
  - hook 自身预算 10 秒，`$` 调用在途不计（X2）；
  - 撞 maxTurns 不触发 SubagentStop（X1）；
  - 会话结束时 agent 一并终止，续接后看不到（X4）。

## Goals / Non-Goals

**Goals**
- 装了插件 0.2.0 后，`/opsx-apply` 从起飞检查到 `/pr-ship` 都由插件执行，主会话的模型 0 回合。
- 门禁结论只来自控制面自己跑的门禁；机械动作零 token；飞行状态只来自账本。
- 状态机核心是纯函数，整个流程可以用 `claude plugin test` 模拟（X6）。

**Non-Goals**（3b / 3c）
- 测量协议、按 agentId 限写、`tool.check` 权限策略、主会话只读、`agent.spawn` 路由守卫；
- `/flight` 命令与面板；
- 删除 `opsx-apply.js`、integrator、快照与门禁结论 ref 机制；
- 改写铁律 10。

## Decisions

### D1 · 分层（单入口模块 + 纯核心）

```
hooks.json → register.tsx（唯一模块：批准带 + 两行接入）
                ├─ registerOrchestrator(on)   orchestrator.tsx   起飞 · 执行体/解冲突收口门禁 · 结束兜底 · 合回 · 状态行 · 类型隐藏 · drive
                └─ registerLanding(on)        landing.tsx        submit_findings · 评审员收口 · 修复收口(final) · final · 落地 · /pr-ship · 停飞
   core.ts      纯函数：reduce(events) → State；next(state, plan, fpNow) → Action[]；stopVerdict；事件构造；路由对账；Io / Flight 类型
   prompts.ts   纯函数：executor / continuation / reviewer / resolver / fixer 提示词
   io.ts        $ 适配：Io 实现 · 判定器路径 · 账本读（ledger.py show）/ 写（CAS）· worktree 准备 · 派发
   land.ts      过程（只依赖 Io 接口）：合回 · 冲突交接 · 快进 · findings 校验 · 落地收口
agents/executor.md · reviewer.md · fixer.md   → flight:executor / flight:reviewer / flight:fixer
```

- 纯核心与副作用分开：状态机的判断能穷举测试；副作用层用测试世界（mock）测。
- 只有一个 hooks 模块，所以 `register.tsx` 引入两个注册函数（X11）。
- **否决**：所有逻辑写在 `register.tsx` 里。不可测，切片之间所有权冲突。

### D2 · 状态 = 账本事件的归约（D1 决策落地）

- **事件表**：见 spec `flight-ledger-events`。每次状态转移都先写账本、再动手，或者动手后立即补记，`reduce` 的输入只有账本。
- **attempt**：每次 takeoff 加 1。
  - 合回与评审跨 attempt 生效：已合回的切片不再飞；
  - 派发、门禁、阻断只在本 attempt 内生效：上次被阻断的切片重新派发；
  - 上次派发了、没有结论的切片，在原 worktree 上续接。
- **agent 映射**：靠 dispatch 事件里的 `agent`（agentId）把 agent 对应到 slice / role / worktree，不靠模块内存。所以模块重载、或两个注册函数各自处理事件，都不需要共享内存。
- **读账本**：经 `ledger.py show`，它顺带校验整条链。账本损坏时停飞。
- **写账本**：io.ts 的 CAS 追加（与批准带同一套 plumbing）。approve 只由批准带写；本 change 的代码 SHALL NOT 构造 approve 事件。
- **否决**：状态放在 `$.state`。明文、模型可改，会话中断即丢。

### D3 · 收口门禁与兜底（D2 决策落地）

- **执行体 / 解冲突 agent 收口**：SubagentStop → io 跑 `slice-gate.py gate <S> --change-dir <dir>`（cwd 为切片或解冲突 worktree，判定器取主 worktree 的副本，超时 600 秒）→ 记 gate 事件 → `core.stopVerdict`：
  - 红且本 agent 被续修少于 2 次 → block，文本含 failed；
  - 否则放行。
- **结束**：turn.complete（带 agentId 且在账本里）→ 记 ended（`usage.model`）→ drive。
- **drive**：循环执行 `core.next` 给出的动作，每轮重读账本，直到没有新动作为止。没有收口结论的执行体，会得到「跑门禁」动作；红则续接重派一次。
- **串行**：drive 经模块内的 Promise 队列串行，避免同一时刻两次合回。账本另有 CAS 兜底。
- **门禁 JSON**：完整记入 gate 事件（含 `warnings`、`ceilings`、`base`），合回后原样交给 `record --json`。
- **否决**：在 turn.complete 判红后派新 agent 重做（D2-B）。冷启动成本高。

### D4 · 合回与冲突（D5 决策落地）

- 门禁绿的切片，在它的执行体结束后立即合回，不等整个 wave；合回后立即派发评审员。下一个 wave 在本 wave 全部合回或阻断之后才派发。
- **冲突**：
  1. `merge --abort`；
  2. 在主 worktree 下另开 `flight-<change>-<S>-resolve` worktree，在其中重做合并，保留冲突现场；
  3. 派发 `flight:fixer`（role resolver）；
  4. 它收口时同样跑该切片门禁；
  5. 绿且结束后，在 change worktree 里 `--ff-only`。

  冲突现场不放在人所在的 change worktree。
- **接口摘要**：用 grep 级的正则抽取，由插件完成（integrator 第 2 项本来就是 `cx symbols` 或 grep 的回退）。

### D5 · 评审、修复、final、落地（D6 决策落地）

- **评审员**：
  - `flight:reviewer` 的 cwd 为 change worktree，提示词给出被审 commit；
  - 用 `submit_findings` 提交，事件进账本；
  - 未提交就收口时 block 一次，结束时仍未提交，记 `review:<S>` 阻断（infra）。
- **修复**：
  - 全部 wave 结束、全部评审都有结果后，有 CRITICAL / HIGH 就在 `flight-<change>-fix` worktree 里派一个 `flight:fixer`；
  - 它收口时跑 `slice-gate.py final`，续修上限同执行体；
  - 绿且结束后 `--no-ff` 合回，并记 timeline 的 fix 事件。
- **final**：在 change worktree 里跑 `slice-gate.py final`。
  - 绿 → land.closeout（写 review-findings.json、勾选、apply-done、收口提交、ship 裁决）→ land 事件 → 清除状态行 → `$.command.run({command: 'pr-ship', args: change})`（X10）。
  - 红 → halt（铁律 5：final 红不收口），提示原因。
- **路由对账**：收口时，对每个 ended 事件比较实际模型与 takeoff 的 model：实际 id 含期望别名即一致，不一致或缺失 → HIGH 进 blocking。这取代 `session-decompose --expect-models` 在新引擎里的作用。

### D6 · 起飞（D9 决策落地）

- command.run 接管 `/opsx-apply`（X7）。检查依次是：
  1. 版本下限（与批准带相同，2.1.295）；
  2. 参数；
  3. change worktree（分支 `worktree-<name>`）；
  4. changeDir（`template/openspec/changes/<name>` 或 `openspec/changes/<name>`，取存在的）；
  5. takeoff-gate；
  6. 工作区干净；
  7. lint、preflight；
  8. 主模型。
- **主模型**：`session-model.py` 由插件运行，传入 `CLAUDE_CODE_SESSION_ID=$.session.id()`；不改铁律 11 的判定来源（3b 再迁到引擎事实）。
- **正在飞**：账本里本 attempt 未落地或停飞，且 `$.agent.list()` 里有运行中的本次飞行 agent → 回复「正在飞」，不重复起飞。
- **回复**：一行起飞摘要（change、切片数、wave 数、主模型）。之后整个飞行由事件驱动，主会话空闲。

### D7 · 判定器路径（新增，安全）

判定器一律取主 worktree 的副本：先 `.claude/hooks`，再 `template/.claude/hooks`。原来的命令文档用 change worktree 里的相对路径，意味着一个修改 `slice-gate.py` 的 change 会被它自己修改后的门禁判定。ADR「飞行运行已安装的稳定版本」要求判定器在飞行之外。

### D8 · agent 类型随插件发布（D4 的一半提前）

- 插件目录 `agents/*.md` 声明类型（X8），安装后的副本不在仓库里，模型改不到。
- 每次派发显式传 model，它优先于类型里的 model（X1）；所以定义里不写 model，避免两处真相。
- effort、maxTurns、tools 写在定义里（spawn 不接受这三项）。
- `agent.offer` 对三个类型回答不提供，模型派不出飞行角色。
- 执行体权限仍随会话模式；`tool.check` 权限策略在 3b。

### D9 · 测试

- `claude plugin test` 的配方（X6）：
  - 测试侧 `agent.spawn` 底层收到的是 Agent 工具参数（`subagent_type`），答复须带 `{model, agentId, result: {status: 'async_launched', agentId, ...}}`；
  - op 类（process.run、fs.*、session.*）答复包在 `{value}` 里；
  - `classic.SubagentStop` 底层答 `{}`。
- 每个 scenario 对应一个同名 TS 测试；pytest 侧用 `tests/test_flight_plugin.py` 的 `assert_ts_passed` 断言它通过。这一做法沿用批准带 change，因为 `claude plugin test` 没有 xfail。
- Python 判定器（ledger.py）仍是 pytest 直测。
- TS 事件形状与 Python 校验的一致性，由两侧各自对照 spec 表的测试保证（core-builds-ledger-events 与 ledger-accepts-flight-events）。

## Risks / Trade-offs

- [状态机成为可信计算基] → 纯核心 + 41 个 scenario 测试；3a 合入后的第一次实战（3b）由人盯着；旧引擎可用 `--engine=workflow` 显式回退。
- [hook 在用户按 Esc 时被放弃，动作做了一半] → 每个动作都先查事实、可重复执行（worktree 复用、`record` 防重复、合回前查是否已合回）。drive 从账本重算，再发一次 `/opsx-apply` 即可接着飞。
- [门禁超过 10 分钟] → 本仓库全量约 63 秒；超时按门禁红记（failed 写明超时），不伪造绿；大型下游的流式子进程留到 3b。
- [TS 写出 ledger.py 不认的事件] → 账本损坏会让 takeoff-gate 停飞（fail-closed）；两侧都对照同一张表测试。
- [评审员 cwd 为 change worktree，与人共享] → 评审员只读（无 Edit / Write）；Bash 越界写入的硬限制在 3b。
- [会话在飞行中关闭] → agent 全部终止（X4）；worktree 与账本都在，再发 `/opsx-apply` 即接着飞。

## Migration Plan

1. 本 change 在旧机制（Workflow + 插件 0.1.1 批准带）上飞，状态机只由测试验证。
2. 合入后发布插件 0.2.0；人执行 `claude plugin marketplace update intent-driven && claude plugin update flight@intent-driven`。
3. 3b 用新状态机飞，这是第一次实战。出问题时，人可以用 `--engine=workflow` 显式改用旧引擎；3c 删除旧引擎。
4. **回滚**：降回插件 0.1.1。账本里多出的飞行事件，旧版 ledger.py 会判损坏，所以回滚时要连同 ledger.py 一起回退；也可以删除对应的 `refs/flight/<change>/ledger`（由人执行）。

## Open Questions

- 被阻断切片的 worktree 与已合回切片的 worktree 都不删（铁律 6）。落地报告会列出它们，清理命令交给人。是否由控制面在落地后自动清理自己建的 worktree，留到 3c 与铁律 10 一并讨论。
