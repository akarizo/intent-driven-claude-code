## Why

PR #39 合入后，flight 插件 0.2.0 的状态机接管了 `/opsx-apply`，本 change 是它的**第一次真实飞行**。所以范围有意压小，只修 #39 已经暴露、会在真实飞行里咬人的问题：

1. **判定器把另一个 change 的记录提交当成代码改动**：`slice-gate.py` 的 `_final_fresh` 只放行本 change 目录的记账文件。同一分支上有两个 change 时（#39 就是），一方的记录提交会让另一方判「final 过期」；插件刷新的 `slices/_interfaces.md` 也不在白名单里。
2. **新引擎落地时不打印飞行记录**：铁律 8 要求「每次 apply 收口打印飞行记录」。旧引擎由主会话跑 `timeline.py report`，新引擎落地、停飞都没有打印。
3. **飞行中算不出计划指纹时，停飞原因写错**（#39 评审 MEDIUM-1）：`plan_fp.py` 一次瞬时失败得到空串，会以「计划指纹已变：…当前（空）」停飞，误导人。
4. **下一个 wave 拿不到上一 wave 的接口摘要**（MEDIUM-3）：合回后刷新的 `_interfaces.md` 没提交，下一 wave 的切片 worktree 从已提交的尖端建出，看不到它。修复 agent 的 worktree 也一样。旧引擎每个 wave 合回后都会先提交记录，新引擎这里语义回退了。
5. **停飞后仍有 agent 在跑时可以重复起飞**（MEDIUM-4）：「正在飞」只检查未落地、未停飞的那次飞行。插件无法终止已派出的 agent，重新批准后立刻起飞，新旧执行体可能同写一个切片 worktree。
6. **事件校验没排除原型链上的键**（LOW）：`ev` 为 `toString` 等值时，字段表查出来不是 undefined，校验被放行。

#39 评审的 MEDIUM-2（`turn.complete` 的 `.catch` 二次调用 `next`）经核实不成立。引擎文档：`next` 已调用时，`.catch` 里的 `next(e)` 只重放结果，不会再跑一遍。本 change 不改。

## What Changes

- **判定器**：`_final_fresh` 放行同一 changes 根目录下**任一 change** 的记账文件；记账文件加上 `slices/_interfaces.md`。
- **落地逻辑**：
  - 落地与停飞时，用 `timeline.py report` 加路由对账一行组成飞行记录，经 `Ctx.log` 打印到转录；落地时在运行 `/pr-ship` 之前打印；
  - 派发修复 agent 前先提交飞行记录。
- **编排**：
  - 飞行中 `plan_fp.py` 失败时，以「计算计划指纹失败」停飞；
  - 派发执行体前先提交飞行记录；
  - 只要上一次飞行派出的 agent 还在运行，就不起飞，不论那次是否已停飞；
  - `Ctx.log` 接到 `$.ui.log`。
- **事件校验**：`ev` 必须是字段表自己的键。

无 BREAKING。

## Capabilities

### New Capabilities
- `ship-verdict-freshness`：final 新鲜度判定放行任一 change 的记账文件与接口摘要。
- `flight-landing-record`：落地与停飞打印飞行记录；派发修复 agent 前提交记录；事件校验不认原型链上的键。
- `flight-engine-hardening`：飞行中指纹失败的停飞原因如实；派发执行体前提交记录；有 agent 在跑时不重复起飞。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- `template/.claude/hooks/slice-gate.py`（`BOOKKEEPING`、`_final_fresh`）与 `tests/test_ship_verdict.py`。
- `template/plugins/flight/hooks/`：`core.ts`（`Ctx` 加 `log`）、`landing.tsx`、`io.ts`、`orchestrator.tsx`，以及对应的 TS 测试与 pytest 包装。
- **首飞须知**：本 change 由插件 0.2.0 的状态机执行。起飞前须在会话里 `/reload-plugins`，让插件换成 0.2.0；判定器取主 worktree（已是 58970ee）。
