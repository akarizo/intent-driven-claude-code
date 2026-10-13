## Why

大目标是「模型只做创作，门禁由插件与判定器裁决，模型不自证」。change 1（flight-ship-ledger）让收尾只认账本。下面三处还不符合这个目标：

- **记录文件仍是事实来源之一，判定器还在边跑边写状态**（已核实）：
  - 派发时插件调 `slice-gate.py start`：它在切片 worktree 写 `.openspec-slice` 标记，并往 `timeline.md` 记一行。
  - 合回时插件调 `slice-gate.py record` 写 `gate-report.md`；修复合回、收口、首次起飞时调 `timeline.py record`。
  - 这些写入有一半落在切片 worktree 里，从来进不了分支。例如 `timeline report` 的「切片 start → gate ok」一行，飞行模式下从未打印过。
  - 意图门禁的切片所有权靠 `.openspec-slice` 这个文件判定，而插件包络已经按 agentId 管住了 Write / Edit，两套并存。
- **意图门禁漏得多**（铁律 1）：
  - 强制点 `intent-gate.py` 是 classic PreToolUse hook，只管 Write / Edit。`sed -i`、重定向这类经 Bash 的写法，它一律看不到。
  - 「apply 上下文」的判法是：项目里任一 change 的 `tasks.md` 还有未勾项，就放行全部源码。本仓库的 `flight-hardening` 留着 1 个未勾任务，结果整个 `template/` 都被放开。
- **可靠性余项**（#50、#51 遗留，均已核实）：
  - `/flight abort` 要等手上的动作做完才停 agent，最长约 10 分钟（门禁）。
  - spawn、merge 执行前不再看一眼账本有没有停飞。
  - 自动停飞后若仍有 agent 在跑，`/flight abort` 回答「没有在飞的 attempt」，`/flight resume` 又因「agent 仍在运行」拒飞，两条路都不通。
  - 评审或修复已阻断时，面板与 `/flight status` 仍显示「进行中」；drive 自己写下停飞或落地后，面板不刷新。
  - 「SubagentStop hook skipped: python3 aborted」每次飞行出现一次，成因未明，也没留下任何记录。
- **判主模型**：插件起飞时还在调 `session-model.py` 读转录；引擎已有 `$.session.model()`。

2026-10-13 用户在阶段 4–5 决策页（`docs/flight-phase4-decisions.html`）上全部选推荐项：D1-A、D2-A、D3-A、D4 勾 1–5。本 change 是其中的 change 2，与 change 1 叠成一个 PR（插件 0.8.0）。

## What Changes

- **账本为唯一事实**（D1-A）：
  - 删掉 `slice-gate.py start`、`slice-gate.py record`、`timeline.py record`。门禁的区间起点一律由插件以 `--base` 传入。
  - `.openspec-slice` 标记退役：不再写，也没有任何判定器再读它。
  - 判定器在飞行中不再写记录文件：`gate`、`final`、`baseline` 只输出 JSON，不写 `timeline.md` 与 `gate-report.md`。
  - 新增两个子命令：
    - `slice-gate.py base`：只读，输出区间起点并做 G0 基点校验，取代 `start` 里的这两项职责；
    - `timeline.py render`：落地时从账本（加上 `gate-baseline.json`）一次生成 `timeline.md` 与 `gate-report.md`。
  - `review-findings.json` 仍按 change 1 的做法，由 ship 的输出写入。三份记录在落地时一起提交。
  - `timeline.py report` 改为按账本计算（账本里有 takeoff 时），飞行记录不再依赖 `timeline.md`。
  - `test-evidence.py` 改按分支名识别飞行 worktree：`flight/` 开头的分支不写 `evidence.log`。
- **意图门禁进插件，classic 留薄地板**（D2-A）：
  - `intent-gate.py` 抽成纯判定，新增 `check` 子命令供插件调用；classic hook 模式保留，照旧在异常时放行。
  - 「apply 上下文」收窄到目标所在 worktree 的 change：
    - 分支 `worktree-<name>` 与 `flight/<name>/…` 只认 change `<name>` 的未勾任务；
    - 其他分支沿用原判法。
    - classic 与插件用同一个判定，同时变严。
  - 插件的 `tool.call` 对主会话和非飞行 agent 的 Write、Edit、NotebookEdit 与 Bash 写法逐一取出写入目标，交给 `intent-gate.py check` 判定。Bash 写法包括重定向、`tee`、`sed -i`、`cp`、`mv`、`touch`、`rm` 等。
    - 判定器出错时拒绝（fail closed）；
    - 项目里找不到判定器时放行。
  - 飞行 agent 的 Bash 写入目标同样限在本片 owns 内（包络原本只限 Write / Edit）。
- **可靠性余项**（D4 勾 1–5）：
  1. `/flight abort` 分两段停：记停飞后立即停在飞 agent，再等手上的动作收尾，收尾期间派出的 agent 再停一遍。
  2. spawn、merge 之前再读一次账本，已停飞或已落地就不做。
  3. 自动停飞后仍有 agent 在跑时，`/flight abort <change>` 停掉这些残留 agent，不再另记停飞。
  4. 面板与 `/flight status` 对已阻断的评审和修复显示「阻断」；drive 写下停飞或落地后刷新面板。
  5. 执行体收口的 SubagentStop hook 失败时（含超时），往账本记一条 `diag` 事件：失败种类、消息、预算、agent。只留证据，行为不变。
- **判主模型改用 `$.session.model()`**（已定）：
  - 按 `session-model.py` 同一套规则取别名（opus / sonnet / haiku / fable）；取不出就拒飞，并提示 `--model=`。
  - `session-model.py` 只留给飞行外使用（`/flight:pr-ship` 飞行外评审、legacy per-task）。
- **change 1 遗留**：
  - 4 条 MEDIUM 全修：
    - 复核轮缺 base 时阻断；
    - 收口为 draft 时，飞行记录写出原因；
    - `/flight:pr-ship` 飞行模式补上 GitLab 分支；
    - Output Summary 的修复计数只在飞行外填写。
  - 12 条 LOW 中修 6 条，其余 6 条写进 design 与 PR 说明，留待以后。
- **文档**：
  - `/flight:pr-ship`、`/opsx-apply` 命令与 skill、README、WORKFLOW 同步改写。
  - 仓库根 `CLAUDE.md` 铁律 11 的 `<main>` 判定写法同步：飞行中由插件经 `$.session.model()` 判定，飞行外由 `session-model.py` 判定。⚠ 这一条改的是仓库铁律的措辞，请审批时留意。
- **判定器能力**：`slice-gate.py features` 新增 `ledger-records`，插件起飞时核对。

**BREAKING**：

- `slice-gate.py start`、`slice-gate.py record`、`timeline.py record` 不复存在；`gate`、`measure` 缺 `--base` 时拒绝运行。合入后主检出须快进，否则 0.8.0 插件起飞会因缺 `ledger-records` 被拒（沿用 #50 的核对机制）。
- `.openspec-slice` 不再有任何作用。
- 意图门禁变严：
  - 在 `worktree-<name>` / `flight/<name>/…` 分支上，只有 change `<name>` 有未勾任务时才放行源码；
  - 分支名形如 `worktree-<name>`、但没有同名 change 的 worktree，写源码会被拒（mini 声明除外）；
  - 插件在场时，经 Bash 写源码也受门禁约束。
- `/flight:pr-ship` 不再调用 `timeline.py record pr-open`。飞行模式的 PR 打开时间取自账本的 ship 事件；飞行外不再记录。

## Capabilities

### New Capabilities

- `flight-ledger-records`：判定器在飞行中不写记录；`base` 子命令取代 `start`；落地时由 `timeline.py render` 从账本生成记录；`report` 按账本计算；账本认识 `diag` 事件；飞行 worktree 不写 `evidence.log`；起飞核对 `ledger-records`。
- `flight-intent-guard`：`intent-gate.py check` 纯判定与收窄后的 apply 上下文；插件对主会话与非飞行 agent 的写入（含 Bash）调用判定；飞行 agent 的 Bash 写入限在 owns 内。
- `flight-reliability`：abort 两段停与停残留 agent；动作内查停飞；阻断态显示与面板刷新；SubagentStop 失败留 diag；`$.session.model()` 判主模型；change 1 的 MEDIUM 与部分 LOW。
- `flight-ledger-docs`：命令、skill、README、WORKFLOW、铁律 11 的措辞与上述行为一致。

### Modified Capabilities

（无。`openspec/specs/` 下没有已归档的规格。本 change 取代 change 1 中「落地时 closeout 记 `timeline.py record apply-done`」与「`/flight:pr-ship` 两种模式都记 pr-open」两处行为，见 design D3、D9。）

## Impact

- **判定器**：`template/.claude/hooks/` 下的 `slice-gate.py`、`timeline.py`、`ledger.py`、`test-evidence.py`、`intent-gate.py`。classic hook 的注册不变：`stop-gate.py` 与 `checkpoint` 空壳按 D3-A 留到 change 3。
- **插件**：
  - `hooks/` 下的 `envelope.ts`、`core.ts`、`ship.ts`、`landing.tsx`、`land.ts`、`io.ts`、`orchestrator.tsx`、`abort.ts`、`versions.ts`；
  - 新增 `intent.ts`；
  - 版本仍为 0.8.0（change 1 已升）。
- **文档**：`commands/pr-ship.md`、`/opsx-apply` 命令与 skill、`README.md`、`docs/WORKFLOW_zh.md`、仓库根 `CLAUDE.md`。
- **测试**：
  - `test_slice_gate.py` 里依赖 `start` 的约 47 个用例改为显式传 `--base`；
  - 标记相关用例随标记退役改写；
  - 插件测试世界里对 `start`、`timeline record` 的应答换成 `base`、`render`，并补上 `session.model` 与 `intent-gate.py check` 的应答。
- **本 change 自己的飞行**：
  - 在已装的 0.7.0 上飞，用的是主检出 ac5d051 的判定器。本 change 改的是 worktree 里的判定器，不影响这次飞行的控制面。
  - 落地后由主会话建一个合并 PR，覆盖 change 1 与 change 2。该 PR 的收尾仍由模型按 0.7.0 的 `/flight:pr-ship` 手动走，PR 正文写明。
