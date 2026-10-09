## Why

飞行的编排器是 Workflow 脚本 `opsx-apply.js`，它按设计不能碰文件系统。合回、跑门禁、记账只能派模型去做，门禁结论也只能由执行体转述。2026-10-09 的三次真实飞行（PR #35 / #36 / #37）里出的问题都源于此：

- 执行体撞上轮次上限，门禁结论随之丢失，只好加「门禁结论 ref」去找回；
- integrator 是一个 sonnet agent，它抛错整个 wave 就合不回去；
- 执行体隔离之后，evidence.log 回不到分支。

`DRAFT-flight-control-plane-in-mod` 已决定把控制权迁进 flight 插件。阶段 3 设计评审（`docs/flight-orchestrator.html`，D1–D10 全按推荐）把编排迁移拆成三个 change，本 change 是第一个（3a）：用插件里的状态机取代 Workflow 与 integrator，派发、跑门禁、合回、记账全部由插件代码完成，模型只写代码、评审、修复、解冲突。

动手前在 Claude Code 2.1.295 上补测了 X1–X11，结论都已落实到本设计：

- 插件声明的 agent 类型能强制工具白名单、effort、maxTurns；
- 收口 hook 里跑 65 秒的门禁不超时，连续 block 能让同一 agent 续修；
- 撞 maxTurns 时不触发收口 hook，需要在 agent 结束时兜底；
- 插件能零 token 接管 `/opsx-apply`，落地后能用 `$.command.run` 接上 `/pr-ship`；
- `claude plugin test` 能模拟整个流程。

## What Changes

- **账本事件扩展**：`ledger.py` 接受飞行事件 takeoff / dispatch / gate / ended / merge / review / blocked / final / land / halt，逐类校验字段；approve 的判定不变。
- **状态机核心**（纯函数，不调用 `$`）：
  - 从账本事件推出飞行状态，再给出下一批动作；
  - 收口门禁红时，同一 agent 续修至多 2 次；
  - agent 没经过收口就结束时，补跑门禁，红则在同一 worktree 上重派一次；
  - 依赖被阻断的切片直接记阻断；
  - 合回后评审，有 CRITICAL / HIGH 就批量修复一次，然后跑 final；
  - final 绿则落地，final 红或计划指纹变了则停飞；
  - 再次起飞时接着上一次飞：已合回的切片跳过。
- **随插件发布的 agent 类型**：`flight:executor`、`flight:reviewer`、`flight:fixer`（插件目录 `agents/*.md`），由插件派发、对模型隐藏；提示词由纯函数生成。
- **副作用层**：
  - 判定器一律从主 worktree 运行；
  - 账本追加带 CAS 重试；
  - 切片 worktree 由控制面创建并持有。
- **合回与收口**：
  - 合回前提交飞行记录，`merge --no-ff` 之后用 `record` 写回门禁结论，并刷新接口摘要；
  - 冲突时退出合并，另开 worktree 交给解冲突 agent，判门禁后快进 change 分支；
  - 收口时写 `review-findings.json`、勾选 tasks.md、提交飞行记录、跑 ship 裁决。
- **接管 `/opsx-apply`**：
  - 起飞检查（批准、干净工作区、lint / preflight、主模型）由插件完成；
  - 派发执行体，在执行体收口时跑门禁，在它结束时兜底；
  - 状态行显示进度。
- **文档**：`/opsx-apply` 命令与同名 skill 写明插件接管。旧 Workflow 引擎只能用 `--engine=workflow` 显式选择，插件缺席即停飞。

**范围调整（2026-10-09，第一次飞行后经用户决定）**：评审回收、落地接线、版本升到 0.2.0，以及第一次飞行评审出的 5 条 HIGH，都移到后续 change `flight-orchestrator-wiring`（基于本分支），原因见 design.md「第一次飞行的结果与范围调整」。两个 change 合成一个 PR 进 main；本 change 不单独合入。

**BREAKING**（对使用者，两个 change 合入后生效）：装了 flight 插件 0.2.0 之后，`/opsx-apply` 默认由插件状态机执行；旧引擎需要显式加 `--engine=workflow`。

## Capabilities

### New Capabilities
- `flight-ledger-events`：账本接受并逐类校验飞行事件，approve 判定不受影响。
- `flight-state-machine`：飞行状态由账本事件推出，下一步动作由纯函数决定（续修上限、兜底重派、依赖阻断、评审 / 修复 / final / 落地 / 停飞、接着上一次飞）。
- `flight-agent-types`：执行体、评审员、修复 agent 的定义随插件发布，提示词由纯函数生成。
- `opsx-apply-plugin-engine`：命令与 skill 写明插件接管、显式旧引擎与停飞语义。
- `flight-io`：判定器从主 worktree 运行、账本追加 CAS 重试、切片 worktree 由控制面持有。
- `flight-integration`：合回、冲突交接、findings 校验、落地收口的机械过程。
- `flight-orchestrator`：插件接管 `/opsx-apply`，收口时现跑门禁，结束时兜底，冲突派解冲突 agent，状态行，类型对模型隐藏。
- （`flight-findings-intake` 已移至 `flight-orchestrator-wiring`。）

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **插件** `template/plugins/flight/`：
  - 新增 `hooks/core.ts`、`hooks/prompts.ts`、`hooks/io.ts`、`hooks/land.ts`、`hooks/orchestrator.tsx`、`hooks/landing.tsx`（空壳，由后续 change 填）；
  - 新增 `agents/executor.md`、`agents/reviewer.md`、`agents/fixer.md`；
  - `hooks/register.tsx` 只加两行接入；
  - 测试 `tests/*.test.ts(x)`。
- **判定器**：`template/.claude/hooks/ledger.py`。
- **文档**：
  - `template/.claude/commands/opsx-apply.md`；
  - `template/.claude/skills/openspec-apply-change/SKILL.md`；
  - 新 ADR `DRAFT-flight-orchestrator-state-machine`（取代 `DRAFT-apply-as-flight`）。
- **测试**：
  - `tests/test_ledger.py`；
  - 新增 `tests/test_flight_core.py`、`test_flight_agents.py`、`test_flight_io.py`、`test_flight_land.py`、`test_flight_orchestrator.py`、`test_opsx_apply_engine.py`；
  - `tests/test_flight_landing.py` 与 `tests/test_flight_plugin.py` 末尾的评审回收骨架留在分支里，由后续 change 解锁。
- **不在范围**（留给 3b / 3c）：
  - 测量协议、按 agentId 限写与 `tool.check` 权限策略、主会话只读、`agent.spawn` 路由守卫（3b）；
  - `/flight status | abort | resume`、飞行面板、删除 `opsx-apply.js` / integrator / Workflow 回退段 / 门禁结论 ref 找回 / 快照机制、改写铁律 10（3c）。
- **自举**：本 change 在旧机制上飞；合入并升级插件之后，3b 是新状态机的第一次实战。
