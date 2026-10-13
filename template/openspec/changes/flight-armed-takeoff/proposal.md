## Why

`/opsx-apply` 被拒后必须人再发一句。原因有两个：
- 它是插件处理的本地命令，输出不会开一轮模型对话；
- 按铁律 7，模型没有起飞入口。

flight-unattended 的 attempt 3 起飞前就被拒了两次：一次「起飞异常（`$.process.run(python3) aborted`）」，一次「未提交的只有本 change 的工件」。attempt 1 还被「已暂存的删除让 `git add` 报错」拦过一次。

另外，#53 把批准带的续飞按钮降级成了「按下后预填，人回车」；文档却仍写「按下 = … + 续飞」。0.9.0 的批准带还会给已落地的旧 change 挂「续飞」。

决策见决策页 `docs/flight-armed-takeoff.html`。2026-10-13 用户逐项拍板，Q1–Q8 全按推荐，代替 grill-me 访谈。

## What Changes

- **起飞待命**：人发出的起飞（`/opsx-apply`、`/flight resume`、批准带按键）被拒时，插件不丢掉这次意图，按拒绝原因分五类处理：
  - 等待：基线仍在跑；上一次的 agent 仍在运行。
  - 偶发：起飞异常；账本读不出；指纹算不出等。
  - 交模型：lint 红；基线缺失或中断；提交工件失败。
  - 人按一次键：未批准或计划已变；工件未提交。
  - 只能人：版本、跨会话、工件之外的改动等。

  前三类挂起为待命，自动重试，计入预算的重试最多 3 次，30 分钟内有效。「交模型」经 `$.prompt.submit` 以插件身份发一轮，这一轮结束后重试。后两类通知人做什么。
- **批准带按下即起飞**：
  - 「批准起飞」「批准修订并续飞」「续飞」都直接起飞，不再预填；
  - 已批准但还没起飞的 change 显示「起飞」；
  - 按键起飞一并提交本 change 的工件，说明行写明个数；
  - 起飞经 `orchestrator.tsx` 在自己的 hook 里造好的闭包 `takeoffNow`，不跨文件传 `$`。
  - **BREAKING**：首次起飞不再是「按键 + 回车 `/opsx-apply`」，按键即起飞。
- **批准带停飞判定修正**：同一 attempt 已落地就不算停飞；人工中止（abort）的停飞不显示「续飞」。
- **#53 遗留**：
  - 诊断员的只读操作与评审员同规则升 allow；
  - 诊断员纳入看门狗；
  - 看门狗停飞后补停中途派出的 agent；
  - 计时器不重复处理；
  - 提交工件时已暂存的删除也能提交；
  - integ 提示词用例按 spec 原样的 Given；
  - `freshWorktree` 的五个候选名在规格里重述。
- **文档**：命令、skill、README、WORKFLOW、propose 交接都照实改；插件 0.10.0。

## Capabilities

### New Capabilities
- `flight-armed-takeoff`：起飞拒绝分类、待命的预算与推进、交模型、取消。
- `flight-band-takeoff`：批准带的显示规则与三类按钮按下即起飞。
- `flight-watchdog-hardening`：诊断员包络与计时、看门狗停飞补停、计时器去重。
- `flight-takeoff-commit`：提交工件对已暂存的删除也成立。
- `flight-integ-fix`：integ 提示词逐条完整列出多行失败项（护栏，补 spec 原样的用例）。
- `flight-fresh-worktrees`：另起切片 worktree 依次尝试五个候选名（护栏，重述 #53 已实现的行为）。
- `flight-armed-docs`：文档与插件版本。

### Modified Capabilities
- 无。`template/openspec/specs/` 不存在，各 change 的规格都还没归档。上面 `flight-integ-fix`、`flight-fresh-worktrees` 两项与旧 change 同名，在本 change 以 ADDED 重述。

## Impact

- **插件**：
  - `template/plugins/flight/hooks/`：新增 `armed.ts`；改 `orchestrator.tsx`、`register.tsx`、`io.ts`、`land.ts`；
  - `types/index.d.ts`；
  - 测试 `armed.test.ts`、`orchestrator.test.tsx`、`flight.test.tsx`、`io.test.ts`、`land.test.ts`、`prompts.test.ts`；
  - `plugin.json` 升到 0.10.0。
- **判定器**：不改。待命不进账本，只在偶发失败时追加既有的 `diag` 事件。
- **文档**：
  - `opsx-apply` 命令与 `openspec-apply-change` skill；
  - `opsx-propose` 命令与 `openspec-propose` skill（交接改为按键即起飞）；
  - `README.md`、`docs/WORKFLOW_zh.md`。
- **新 ADR 草案** `DRAFT-flight-armed-takeoff`：部分取代 `DRAFT-flight-resume-from-band`。
- **起飞前置**：主检出须快进到 `7fd26b0` 或更新，判定器要认识 `heal` / `triage`。插件 0.9.0 已装。
