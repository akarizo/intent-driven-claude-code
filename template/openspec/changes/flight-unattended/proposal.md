## Why

用户目标是**无人值守到 PR**（2026-10-13）。按同仓同口径实测，Mod 单次飞行并不比 v2.0 慢：每片中位 3.5 min，v2.0 为 5.5 min。体感慢的根源是**停飞后要等人**：

- **停飞率**：Mod 飞过的 15 个 change 里，有 6 个要二次起飞或作废重飞。
- **6 次真实停飞的复盘**（来源：账本 + 记忆）：
  - **不改计划就能自愈的有 2 次**：
    - ledger-guards a1：S9 合回失败，不是冲突，人只发了 `/flight resume`；
    - ship-ledger a1：final 红，原因是跨片测试失配，人授权主会话只改测试。
  - **已修的有 1 次**：measure a3。
  - **必须人来的有 3 次**：
    - hardening a1：控制面缺陷，受铁律 10 约束；
    - measure a1、interaction a1：规划失误，要改计划并重新批准，受铁律 7 约束。
- **看门狗缺口**：ledger-guards a1 的 S9 执行体跑完全量 pytest 后 13 分钟没有响应（01:35:17 → 01:48:31），直到被人中断，控制面毫无察觉。
- **人回来后要做的事太多**：要自己读账本找原因、改计划、手动重跑基线、按批准、回车起飞。停飞时控制面只发一条终端 toast，人离开电脑就看不到。

用户在 `docs/flight-unattended.html` 上定了 Q1–Q8：
- 合成一个 change；
- 从含 #52 的 main（`e5551f4`）切；
- 看门狗 10 min；
- 自愈预算：每次飞行合计 ≤ 3，同片同类 ≤ 1；
- 整合修复体可改 owns 并集，scenario 测试除外；
- 只用终端通知；
- PR 开出时也通知；
- 停飞派只读诊断 agent。

另外两条已定：final 红在跨片失配时，允许修复体改既有测试，但要加护栏；铁律 7、10 不放宽。

## What Changes

- **自愈（不改计划、不改规则，均有预算）**：
  - **A1 合回失败重派**：切片合回失败且不是冲突时，记一条 `heal`（merge-retry）事件，再用新 worktree 重派一次执行体；第二次仍失败才记 blocked。
  - **A2 看门狗**：控制面跟踪每个飞行 agent 正在等待的模型请求。等待超过 10 分钟，记 `heal`（watchdog），再用 TaskStop 停掉它，之后按角色处理：
    - 执行体：走现有「未正常收口 → 补跑门禁 → 续派一次」；
    - 评审员、修复体：各重派一次。
    - 预算用尽时停飞（kind watchdog）。
  - **A3 预算**：每个 attempt 的 `heal` 合计 ≤ 3；同一（slice, 种类）≤ 1；超出即按原行为 blocked / 停飞，原因写明「自愈预算已用尽」。
  - **A4 整合修复体**：final 红、没有 blocked 切片、预算允许时，记 `heal`（integ），派修复体 `integ`，输入是 final 的失败清单。
    - 收口门禁：`slice-gate.py final --integ-base <派发时分支尖端>`，新增 **G9 整合护栏**：
      - 不改 change 工件（specs / design / proposal / tasks / slices.json / 切片包）与 ADR；
      - 不碰 scenario 映射的测试函数；
      - 测试 assert 不净减少、不新增 xfail/skip、不删测试函数；
      - 写入范围另由包络限在全部切片 owns 的并集内。
    - 门禁绿后派评审员专审 integ 的 diff：有 CRITICAL/HIGH 即停飞；否则合回、再跑 final。
    - 每个 attempt 至多 1 轮；再红即停飞。
- **停飞后最快接上**：
  - **B1 终端通知**：`$.ui.notify` 走用户自己的通知通道（iTerm2 / kitty / ghostty / 响铃）。以下几种情况各通知一次：
    - 停飞（人工中止除外）；
    - 诊断就绪；
    - PR 开出（链接、ready/draft、blocking 条数）；
    - 交接 `/flight:pr-ship` 失败。
  - **B2 诊断包**：
    - halt 事件带 `kind`：blocked / final / integ / fingerprint / control / watchdog / abort。
    - 除 abort、fingerprint 外，停飞后派只读诊断员 `flight:diagnostician`（主模型 high）。
    - 它的最终回答记为 `triage` 事件：根因、该谁动、改计划时附草案。只供展示，不参与任何判定，也不落盘。
  - **B3 一键续飞**：批准带对已停飞的 change 换成两种按钮：
    - 计划改过：「批准修订并续飞」。按下 = 写 approve（新指纹）→ 停掉仍在跑的诊断员 → 后台重跑 `slice-gate.py baseline` → 绿则以「授权提交」续飞（只提交本 change 工件，只重派未合回的切片）；红则通知原因、不起飞。
    - 计划未改：「续飞」，等同 `/flight resume`。
    - 首次起飞仍是「批准起飞」+ 人回车 `/opsx-apply`，不变。
- **记录与核对**：
  - 账本新增 `heal`、`triage` 事件，dispatch 认 `diagnostician` 角色，halt 可带 `kind`；
  - `timeline.py report` 打印自愈次数与停飞诊断首行（铁律 8）；
  - `slice-gate.py features` 新增 `integ-guard`，插件起飞时核对。
- **文档与版本**：`/opsx-apply` 命令与 skill 同改，README、WORKFLOW 同步；插件 0.9.0。

**BREAKING**：

- final 红不再一律停飞：满足条件时先派整合修复体。依赖「final 红即停飞」的旧用例要改。
- 切片合回失败（非冲突）不再立刻 blocked，先重派一次。
- 主检出须快进到本 change 合入后的 main，否则起飞会因判定器缺 `integ-guard` 被拒（沿用 #50 的核对机制）。

## Capabilities

### New Capabilities

- `flight-self-heal`：
  - 合回失败重派、看门狗、自愈预算；
  - `heal` 事件；
  - 自愈在面板与飞行记录里可见。
- `flight-integ-fix`：
  - final 红时派整合修复体，含 G9 护栏、专审评审、合回后再 final；
  - 判定器声明 `integ-guard`。
- `flight-halt-handoff`：
  - halt 分类；
  - 终端通知；
  - 只读诊断员与 `triage` 事件；
  - 批准带的「批准修订并续飞 / 续飞」。
- `flight-unattended-docs`：命令、skill、README、WORKFLOW 与插件版本说明和上述行为一致。

### Modified Capabilities

（无。`openspec/specs/` 下没有已归档的规格。以下两处行为由本 change 取代，见 design D4、D1：
- flight-orchestrator 的「final 红即停飞」；
- 「合回失败即 blocked」。）

## Impact

- **插件**（`template/plugins/flight/`）：
  - `hooks/` 下的 `core.ts`、`envelope.ts`、`prompts.ts`、`landing.tsx`、`ship.ts`、`io.ts`、`orchestrator.tsx`、`versions.ts`、`register.tsx`；
  - 新增 `hooks/watchdog.ts`、`hooks/resume.ts`、`agents/diagnostician.md`；
  - `types/index.d.ts`；`.claude-plugin/plugin.json`（0.9.0）。
- **判定器**（`template/.claude/hooks/`）：`slice-gate.py`（G9、`integ-guard`）、`ledger.py`（新事件）、`timeline.py`（自愈与诊断行）。
- **文档**：`/opsx-apply` 命令与 skill、`README.md`、`docs/WORKFLOW_zh.md`。
- **ADR**：新增两份。
  - `DRAFT-flight-bounded-self-heal`：自愈只做不改计划的再试，先记后做，有预算，G9 护栏。
  - `DRAFT-flight-resume-from-band`：部分取代 `DRAFT-flight-orchestrator-state-machine` 第 1 条「人照旧发 `/opsx-apply`」，停飞后的续飞可由批准带按键触发。
- **本 change 自己的飞行**：
  - 在已装的 0.8.0 上飞，判定器用主检出的副本（须先快进到 `e5551f4`）。本 change 改的是 worktree 里的插件与判定器，不影响这次飞行的控制面。
  - 也就是说，这次飞行本身还享受不到自愈。
