# DRAFT. 飞行内自愈有界：只做不改计划的再试，先记 heal 再做，每次飞行至多 3 次

- Status: accepted
- Date: 2026-10-13
- 关联：DRAFT-flight-orchestrator-state-machine（第 3 条执行体续修与重派规则不变，本 ADR 在其上增加三种自愈）· DRAFT-flight-single-implementation（失效即停飞不变）· DRAFT-approval-bound-to-plan-fingerprint
- 来源 change：flight-unattended（design D1–D4）

## Context

- **停飞率高**：Mod 飞过的 15 个 change 里，有 6 个要二次起飞或作废重飞。复盘 6 次真实停飞：
  - 2 次不改计划就能解决：
    - ledger-guards a1 的 S9 合回失败（非冲突），人只发了 `/flight resume`；
    - ship-ledger a1 的 final 红，原因是跨片测试失配，人授权主会话只改测试。
  - 另有一类没有停飞、但同样在等人：执行体在模型请求上空等 13 分钟，直到人中断。
- **用户目标是无人值守到 PR**（2026-10-13）。用户同时要求：铁律 7（计划批准）、铁律 10（失效即停飞）不放宽；final 红在跨片失配时，允许修复体改既有测试，但要加护栏。
- **看门狗阈值有数据**：本机 2528 个 agent 转录，「工具结果 → 下一条回复」的最长间隔是 581 s；被人中断前空等超过 600 s 的有 10 次。
- **插件能力已实测**（CLI 2.1.296）：
  - `turn.step` 能看到插件派出 agent 的每次模型请求；
  - `$.clock.every` 回调在 hook 返回后仍可用 `$`；
  - `TaskStop` 能停下插件派出的 agent。

## Decision

1. **自愈只做不改计划的再试**。三种：
   - **合回失败（非冲突）**：用新 worktree 重派执行体一次；
   - **看门狗**：飞行 agent 的模型请求等待超过 10 分钟即停下，按角色走「未返回」路径；评审员、修复体各重派一次；
   - **整合修复**：final 红、没有 blocked 切片时，派一个修复体（slice `integ`）修 final 的失败清单；经机械护栏与专审评审后合回，再跑 final。

   任何需要改 owns、scenario、spec、design 的情况都不自愈，而是停飞交人。
2. **先记后做**：每次自愈先向账本追加 `heal {kind, slice, reason, agent?}`，再执行重派或停 agent。面板与飞行记录逐条打印（铁律 8）。
3. **有预算**：每个 attempt 的 heal 至多 3 条，同一（kind, slice）至多 1 条。超出即按原行为处理（blocked / 停飞），原因写明「自愈预算已用尽」。
4. **整合修复的护栏是机械判据**（`slice-gate.py final --integ-base`，G9）：
   - 不改 change 工件与 ADR；
   - 不碰 scenario 映射的测试函数；
   - 测试 assert 不净减少、不新增 xfail/skip、不删测试函数；
   - 写入范围由包络限在全部切片 owns 的并集。

   专审评审有 CRITICAL/HIGH 即停飞，不进自动修复轮。每个 attempt 至多一轮整合修复。
5. **控制面自身的异常不在自愈之列**：动作异常、账本读失败、指纹算不出，照旧停飞（铁律 10）。

否决的方案：
- **自愈不设上限，或按次数指数退避**：问题若出在计划上，无上限的再试只会烧 token、推迟叫人。
- **整合修复体可改任意文件**：等于绕过 owns 与计划批准（铁律 7）。
- **合回后只靠 #52 的全量评审把关整合修复**：全量评审的 HIGH 会进入自动修复轮，不会停下；用户要求整合修复有问题即停。
- **按工具调用间隔、或 transcript 文件时间判卡住**：长测试会被误判；transcript 路径不是公开契约。

## Consequences

- **更易**：常见的基础设施类失败与跨片测试失配不再需要人在场；每次自愈都有账本证据可查。
- **更难**：状态机多了 heal、integ 两类分支，测试世界要覆盖；G9 的「改弱测试」判据是启发式，判不到的改弱（如放宽阈值）要靠专审评审与全量评审兜底。
- **中性**：预算与 10 分钟阈值是参数，改动它们须经新 change 并引用新的实测数据。
