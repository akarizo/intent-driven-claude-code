## Why

2026-10-14 afa `cparam-native-subhz-layout` attempt 6 停飞，原因是插件缺陷，不是计划问题：

| 时间（UTC） | 事件 | 起点 base |
|---|---|---|
| 13:41 | S1 执行体甲派发，起点测量 3/16 通过（正常） | `e015a343`（change 分支尖端） |
| 13:49 | 甲收口门禁红：只红 G4（既有测试缺 GWT 注释），实现已提交为 `94a317c6` | — |
| 13:50 | 同一 attempt 内续派执行体乙，复用甲的 worktree | **`94a317c6`**（甲的提交） |
| 13:56–13:58 | 乙三次收口都被 G5 判「在改生产代码之前就已通过」→ S1 blocked → 停飞 | — |

根因：同一 attempt 内的续派动作不带 base（`core.ts:206` `executorOutcome`），编排层复用 worktree 时没有 `--base` 就以当前 HEAD 为起点（`orchestrator.tsx:409`）。HEAD 已是首个执行体写好的实现，起点测量全过，G5 必然误判。后果：**任何切片只要首个执行体收口门禁红一次，这一片就救不回来**。

0.13.0 的 `planDefect` 第 1 条判据还会把这个症状报成「计划缺陷，把该 scenario 标为护栏」，方向错误。修好起点后这个误报随之消失，判据本身不用改。

跨 attempt 的续接（`firstDispatch`）已经带上一次门禁的 base；但那条 base 也来自续派执行体的门禁，同样会被本缺陷污染。修在源头，两条路径一起修好。

## What Changes

- **续派带首个执行体的起点**：同一 attempt 内、执行体收口门禁红或未正常收口后的续派动作，带上本片最后一次执行体派发记录的 base；编排层已有的「续接带原 base」分支随之生效：`slice-gate base` 带 `--base <原起点>`，起点测量按原起点去重、不再在实现之上重测，续派 dispatch 事件记原起点，收口门禁也以原起点判 G5。
- 最后一次派发没有 base（旧账本）时行为不变。
- 插件 0.13.1。

无 BREAKING：账本不加事件类型、字段不变，判定器不用更新。

## Capabilities

### New Capabilities
- `flight-redispatch-base`：同一 attempt 内续派执行体沿用首个执行体的起点；插件版本。

### Modified Capabilities
（无：`openspec/specs/` 下没有已归档的相关 spec。）

## Impact

- 插件：`template/plugins/flight/hooks/core.ts`（`executorOutcome` 的续派动作）、`.claude-plugin/plugin.json`。
- 编排层 `hooks/orchestrator.tsx` 不改：续接带 base 的分支（`:409`）已存在，只是此前收不到 base。
- 测试：新增 `tests/test_flight_redispatch_base.py`；TS 用例追加在 `core.test.ts`、`orchestrator.test.tsx`。
- 不在本 change：G1 失败全在 owns 外时不续派、所有停飞交主会话、preflight 查 G4（change `flight-halt-continuity`）。
