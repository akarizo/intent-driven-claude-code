## Why

`mechanical-takeoff-gates`（PR #29，未合并）已把起飞前的两条判据机械化：主模型读转录判定（`session-model.py`）、人类批准由 `PreToolUse` hook 强制（`takeoff-gate.py`）。但 2026-09-12 一次真实翻车证明**拦截面还差两块**，而且差的正是用户每次都要用到的那两块。

**事故经过**（证据：`~/.claude/projects/-Users-akarizo-Workspace-amc-gateway--worktrees-temp-queue-query/` 两份转录 + 该 change 目录文件 mtime）：

| 本地时间 | 事件 | 证据 |
|---|---|---|
| 14:55 | 人切 `/model` → Fable 5.1 | 转录 c9b22e25 |
| 14:57 | 人跑 `/opsx-explore <需求>` | 同上 |
| 15:36–15:47 | **explore 会话里写出全套飞行工件**：proposal · design · specs · `tasks.md` · `slices/S1–S4.md` · `spec.html` · `slices.json` | 文件 mtime 全落在 explore 窗口内 |
| 15:47:53 | **explore 会话里跑了 baseline**，向 `timeline.md` 记入 `baseline exit 101, 74.4s` | `timeline.md` 该行至今仍在，且是文件里**唯一**事件 |
| 15:48:38 | 人手动打断工具调用 | 转录 |
| 15:48:49 | 人质问："为何没有走 propose 然后 apply?" | 转录原话 |
| 15:51:30 | 人 `/clear` 后 `/model` → Opus 5 (1M)，**手工补上本该由系统强制的模型切换** | 转录 1e41231d |

**缺口 ①：explore 阶段不在任何拦截面内。** `takeoff-gate.py` 只判**派发**（`Workflow` 带 `args.changeDir`、`Agent` 派 `slice-executor`/`integrator`）。上表里越界的两个动作——`Write` 写 `slices.json`、`Bash` 跑 `slice-gate.py baseline`——**都不是派发，一条都不拦**。`opsx-explore.md` 在 PR #29 里一个字未改（`git diff main...worktree-mechanical-takeoff-gates -- template/.claude/commands/opsx-explore.md` 为空），仍写着 "You MAY create OpenSpec artifacts" 与 "Ending Discovery → Flow into a proposal"。即：**PR #29 全部合并后，这次事故会原样重演**，只在最后派 `slice-executor` 时才吃一个 deny——人依然看不到那个停顿，只看到一个失败。

**缺口 ②：执行模型不是确认点，只是自动读数。** `session-model.py` 判定成功即静默放行，只有判不出才停；`takeoff-gate.py` 见到人敲的 `/opsx-apply` 即认定批准成立（其 scenario `approval-gate-accepts-human-command` 写死了这条）。两者合起来的效果是：**人在 Fable 下敲 `/opsx-apply`，整场飞行就用 Fable 跑完，全程没有任何一处让人看一眼"现在是 Fable"**。而用户的实际工作习惯是每次起飞前都要换执行模型（上表 15:51:30 就是手工补做这件事）。铁律 11 要求"模型按角色显式路由"，今天显式的只有**派发参数**，不包括**人对该路由的知情与确认**。

**缺口 ③：交给人的起飞指令不自足。** propose 收尾只打印 `spec.html` 绝对路径 + 一句"请你自己发出 `/opsx-apply <name>`"。而切换执行模型要先 `/clear`，清空上下文后人既不知道该进哪个 worktree，也无从复原派发参数——上表 15:51–15:52 那段手工补救正是这个缺口的现场。

两个缺口是同一条原则的延伸——ADR `DRAFT-gate-evidence-not-self-reported`（判据不得由被门禁方提供）目前只覆盖了"起飞那一刻"，没覆盖"起飞之前的整段路"。

## What Changes

- **`takeoff-gate.py` 判据收紧为两段式握手**（**BREAKING**，收紧 PR #29 的 `approval-gate-accepts-human-command`）：起飞指令——无论一行自然语言还是 `/opsx-apply <name>`——只算**发起**；批准必须是发起之后**另一条**人类短确认消息（≤ 40 字、含批准词、不含 change 名与 worktree 路径）。判定时取最后一条人类消息：是发起 → 停；是短确认且晚于发起与计划工件改动 → 放行。停下时 stderr / deny reason 打印**当前主模型别名**（经 `session-model.py` 的 `alias_of`）、切片与 wave 数、worktree 与 `spec.html` 的绝对路径、以及"确认回一句 `起飞`；换模型先 `/model`"。主模型判不出一律停（fail-closed）。
- **新增 `template/.claude/hooks/phase-gate.py`（零 token 判定，只挂 `PreToolUse`）**：从转录取**最后一条人类命令消息**判定当前阶段（`/opsx-explore` → explore）。阶段为 explore 时，`Write`/`Edit` 命中飞行计划工件（`slices.json` · `tasks.md` · `slices/*.md`）→ `permissionDecision: deny`；`Bash` 命中 `slice-gate.py baseline` → deny。其余一律静默放行；异常一律放行。
- **`hooks.json` 注册**：`PreToolUse` 增 `Write|Edit|Bash` → `phase-gate.py`（`hooks.json` 是 hook 唯一真源，`install.sh` 幂等合并进目标 `settings.json`，故不改 `settings.json`）。
- **`/opsx-explore` 与 `openspec-explore` 同改**：Guardrails 增明确边界——不产出飞行计划工件（`slices.json` · `tasks.md` · `slices/*.md`）、不跑 baseline、不派实现类子 agent；工件成形即打住并引导人显式 `/opsx-propose`。`proposal.md` · `design.md` · `specs/**` 仍可在 explore 内写（保留"捕捉思考"定位，与现有命令语义一致）。
- **`/opsx-apply` 与 `openspec-apply-change` 同改**：step 0 写明两段式握手与它由 `takeoff-gate.py` 强制；并写明派发参数一律**机械推导**（`waves` ← `slice-gate.py lint`、`deps` ← `slices.json`、`expectHead` ← `git rev-parse --short=10 HEAD`、`<main>` ← `session-model.py`），不要求人提供。
- **`/opsx-propose` 与 `openspec-propose` 同改**：收尾硬交接从三件事改四件，新增打印**一行**可直接复制的起飞指令（含 worktree 绝对路径 + change 名 + 授权语），并明确不得把派发参数列进那一行。
- **铁律与文档同改**：仓库根 `CLAUDE.md` · `template/CLAUDE.md.snippet` 铁律 7 补"起飞为两段式握手：发起 ≠ 批准"；`README.md` · `docs/WORKFLOW_zh.md` 补阶段边界表。

**不改**：`session-model.py`（直接复用其 `alias_of`）；路由表本身；`takeoff-gate.py` 的其余判据（人类消息形状识别、新鲜度、fail-open 规矩、只判起飞类派发）；飞行内部的零问询守则（本 change 加的两处都在**起飞之前**，飞行一旦开始仍不问）。

## Capabilities

### New Capabilities

- **phase-discipline**：阶段纪律的机械边界——explore 阶段禁止产出飞行计划工件与跑 baseline，阶段判定取自转录里人类自己发出的命令消息。
- **takeoff-model-confirm**：起飞的两段式握手（发起 ≠ 批准）、停下时展示执行模型与规模、以及交给人的一行式自足起飞指令。

### Modified Capabilities

无 delta 文件。`takeoff-approval`（PR #29 引入）尚未 archive 进 `openspec/specs/`，没有可写 MODIFIED 的基线；本 change 以 ADDED 表达收紧后的完整判据，并由 S1 同时更新 `takeoff-gate.py` 与 `tests/test_approval_gate.py` 里 `/opsx-apply 即批准` 的既有断言。**PR #29 的该 scenario 行为被本 change 收紧**，两者合并后以本 change 为准。

## Impact

- **代码**：改 `template/.claude/hooks/takeoff-gate.py`（判据两段式 + 输出增强）；新增 `template/.claude/hooks/phase-gate.py`；改 `template/.claude/hooks/hooks.json`。
- **命令与 skill**：`opsx-explore` · `opsx-apply` · `opsx-propose` 及三者同名 skill。
- **文档与铁律**：仓库根 `CLAUDE.md` · `template/CLAUDE.md.snippet` · `README.md` · `docs/WORKFLOW_zh.md`。
- **测试**：新增 `tests/test_phase_gate.py`；扩 `tests/test_approval_gate.py` · `tests/test_template_docs.py` · `tests/test_docs_iron_rules.py`。
- **对人的影响**：每次起飞多一次短往返（发起 → 看一眼模型与规模 → 回一句 `起飞`）。这是刻意买下的成本，对应用户"我一般都要切换执行的模型"；起飞指令本身保持一行、简单精准。
- **基线依赖**：本 change 基于 `worktree-mechanical-takeoff-gates`（PR #29）开出，与其同改 `takeoff-gate.py` · `hooks.json` · `opsx-apply.md` · `openspec-apply-change/SKILL.md` · `tests/test_approval_gate.py`；**PR #29 先合并，本 change 再合并**。
