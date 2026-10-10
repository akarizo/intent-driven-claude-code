## Context

- **背景**：PR #39 合入后，插件 0.2.0 的状态机接管 `/opsx-apply`。本 change 是新引擎的第一次真实飞行，只修 #39 已暴露的问题，范围压小，给可能出现的引擎缺陷留余地（3a 的教训：首次规划就用满切片配额，修复无处可排）。
- **在用 ADR**：`DRAFT-flight-orchestrator-state-machine`、`DRAFT-flight-control-plane-in-mod`。本 change 不改变任何决定。
- **平台约束沿用 3a 实测**：`$` 不跨 import（只在 `orchestrator.tsx` 造 `Ctx` 闭包）；测试与插件是隔离实例；每插件一个 hooks 模块。

## Goals / Non-Goals

**Goals**：
- 判定器在一个分支两个 change 时不误判 final 过期；
- 新引擎落地 / 停飞打印飞行记录；
- 修掉 #39 评审的 MEDIUM-1 / 3 / 4 与一条 LOW。

**Non-Goals**：能力包络、`agent.spawn` 守卫、主会话只读（下一个 change `flight-envelope`）；测量协议（`flight-measure`）；其余 LOW。

## Decisions

### D1 · `_final_fresh` 的白名单按「任一 change 的记账文件」判
- final 记录提交到 HEAD 之间的每个改动路径，只要形如 `<changes 根>/<任一 change>/<记账文件>`，就放行。changes 根取本 change 目录的父目录。
- 记账文件在原有五项之外，加上 `slices/_interfaces.md`：它由控制面写，不是代码。
- **否决**：每个 change 记录提交后各自重跑 final。#39 实测这会互相打架，两个 change 永远对不齐。

### D2 · 飞行记录 = `timeline.py report` 加路由对账一行
- **来源**：落地逻辑跑 `timeline.py report --change-dir <changeDir>`（判定器取主 worktree）。路由对账来自 `core.routingFindings`（3a 已有，收口时也用它进 blocking）。
- **输出**：经新增的 `Ctx.log(text)` 打印，`orchestrator.tsx` 的 `ctxOf` 接到 `$.ui.log(text)`。它在转录里显示为一行暗色系统提示，不发给模型，终端显示前 2000 字。
- **时机**：落地时排在 `/pr-ship` 之前，人先看到记录，再看 PR。停飞时排在停飞提示之后。
- **否决**：塞进 `/pr-ship` 的参数里让模型转述。那是让模型转述机械数据（R1）。

### D3 · 派发前先提交记录
执行体（drive）与修复 agent（落地逻辑）的派发分支，在 `ensureWorktree` 之前先调用 `land.commitRecords(io, f, 'chore(flight): 记录')`。没有未提交记录时它不提交，所以多调用几次也无害。提交失败时：
- 执行体：记该切片 infra 阻断；
- 修复 agent：记 fix 的 infra 阻断。

### D4 · 起飞时的「仍在运行」检查不看是否已 land / halt
取最新 takeoff 那次飞行派出的全部 agentId，只要 `$.agent.list()` 里有一个是 pending / running / waiting，就拒绝起飞。插件没有终止 agent 的接口（`$.agent` 只有 spawn / list / register），只能等它们结束。

### D5 · 飞行中指纹失败
drive 计算 `fpNow` 时，`plan_fp.py` 非 0 或输出格式不对，直接交给落地逻辑停飞，原因写「计算计划指纹失败：<stderr 首行>」，不再交给状态机去比对指纹。

### D6 · MEDIUM-2 不改（核实为非问题）
插件文档（plugin-authoring reference「Developing one」一节）原文：*「where the hook had not called `next` the handler refuses, and where it had, `next(e)` replays what that call settled to and nothing runs twice」*。`turn.complete` hook 的 `.catch(($, e, next) => next(e))` 在 `next` 已调用时只重放结果，下游不会再执行一遍。

## Risks / Trade-offs

- [首飞撞上新引擎的未知缺陷] → 范围小、3 片 2 层，配额留足余量。人可以用 `/opsx-apply flight-hardening --engine=workflow` 显式改走旧引擎。飞行停在半路时，再发 `/opsx-apply` 即从账本接着飞。
- [本仓库没有注册 `/pr-ship` 命令]：本仓库根 `.claude/` 没有 commands 目录，`/pr-ship` 只在模板里。落地时插件运行 `/pr-ship` 可能报命令不存在，届时由主会话按命令文档完成。这一点会在首飞里如实记录。
- [`$.ui.log` 只显示前 2000 字] → 飞行记录主体是 timeline 报告，十几行；完整记录仍在 `timeline.md`。

## Migration Plan

合入后发布插件 0.2.1（版本号由 S3 提升）。人执行 `claude plugin marketplace update intent-driven && claude plugin update flight@intent-driven` 后 `/reload-plugins`。

## Open Questions

无。
