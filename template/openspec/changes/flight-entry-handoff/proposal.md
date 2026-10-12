## Why

阶段 3 完成后，插件已是飞行的唯一执行体。但飞行的**入口**与**出口**仍依赖项目里装好的文件：

- **入口**：插件只拦截名为 `opsx-apply` 的命令，自己不注册这个名字。项目里没有 `.claude/commands/opsx-apply.md` 时，`/opsx-apply` 报「Unknown command」。2026-10-12 本仓库就因此起飞失败：#49 删掉模板里的旧引擎文件后，根目录提供命令名的软链悬空了。
- **出口**：落地后插件用 `$.command.run('pr-ship')` 交接给 `/pr-ship`，命令文件同样要由项目提供。本仓库每次飞行都失败（「no command named /pr-ship」），只能由主会话手动走。
- **来源**：#50 的 D8 规定 `/flight abort` 与 `resume` 只认人发出，但 `/opsx-apply` 起飞不查来源，同类缺口留到了本阶段。
- **评测**：阶段 5 要用 `claude plugin eval` 对照有插件与无插件。只有插件能独立提供入口与出口，这个对照才有意义；评测靠无头运行，来源规则也要认可宿主程序（`sdk`）。

2026-10-12 实测（CLI 2.1.296，无头模式，`scratchpad/mods/entry-spike`、`handoff-spike`）：

- **注册同名命令**：插件 `$.command.register` 一个与项目命令文件同名的命令时，引擎拒绝（「refused: it is the user's /filecmd」）。插件的 `command.run` hook 仍能拦截这个文件命令。
- **context 不触发作答**：插件命令返回的 `context` 不会让模型接着作答。
- **prompt.submit 的时机**：在 `command.run` 里调 `$.prompt.submit` 被拒，引擎提示从之后的事件里提交。
- **插件 markdown 命令带命名空间**：插件自带的 markdown 命令名为 `<插件>:<名>`，例如 `/entry-spike:shipdoc`。直接发 `/shipdoc` 找不到这个命令。
- **交接可行**：在子 agent 的 `turn.complete` 里，经 `$.command.run('<插件>:<名>')` 跑插件 markdown 命令，或者 `$.prompt.submit` 交一段话，主会话都会在当前一轮结束后由模型接着执行。

## What Changes

- **入口由插件提供**（用户定：注册加拦截两手）：
  - 会话开始时，插件注册 `opsx-apply`；
  - 项目已有同名命令文件时注册被引擎拒绝，忽略，照旧靠拦截接管。
- **写账本的入口只认人或宿主程序**（用户定）：
  - 涉及 `/opsx-apply` 起飞、`/flight abort`、`/flight resume`；
  - 来源须为 `composer`（终端）、`bridge`（Remote Control）或 `sdk`（`claude -p` / Agent SDK 宿主）；
  - 定时任务、别的会话的消息、插件代发等其他来源一律拒绝，不写账本；
  - `--gate=per-task` 透传与 `--engine=workflow` 拒绝不写账本，不受此限。
- **pr-ship 迁入插件**（用户定）：
  - 搬进插件，单一来源：`pr-ship.md` 进 `template/plugins/flight/commands/`，即 `/flight:pr-ship`；它派发的 `code-reviewer` 进 `template/plugins/flight/agents/`，即 `flight:code-reviewer`。模板不再提供这两个文件。
  - `/flight:pr-ship` 接受 `--worktree`、`--change-dir`、`--judges` 三个参数。缺省依次为当前目录、`openspec/changes/<name>`、`.claude/hooks`。
- **落地交接改为 `/flight:pr-ship`**：
  - 落地后插件调用 `/flight:pr-ship --worktree <change worktree> --change-dir <change 目录> --judges <判定器目录>`；
  - 交接失败的提示也改为这个命令。
- **派发守卫放行评审员**：主会话可以派发 `flight:code-reviewer`（仍须显式 `model`）。其余 `flight:*` 仍只能由控制面派发，飞行中的 agent 仍不得再派发子 agent。
- **安装器与文档**：
  - 安装器不再安装这两个文件；升级时若发现旧副本，列为「已迁入 flight 插件」，不代删；
  - README、WORKFLOW、命令与 skill（含 legacy）、仓库 CLAUDE.md 第 6 条改为 `/flight:pr-ship` 与 `flight:code-reviewer`；
  - `/opsx-apply` 命令与 skill 写明来源规则，补上 #50 的文档遗留。
- **版本**：插件 0.7.0。

**BREAKING**：

- `/pr-ship` 改名为 `/flight:pr-ship`，`code-reviewer` 改为 `flight:code-reviewer`。已装项目里的旧副本仍可用，但不再更新。
- 不标明来源的 `/opsx-apply`（例如定时任务触发）不再起飞。

## Capabilities

### New Capabilities

- `flight-entry`：插件提供 `/opsx-apply` 入口；写账本的入口只认人或宿主程序。
- `flight-ship-handoff`：落地交接到 `/flight:pr-ship`；主会话可派发 `flight:code-reviewer`。
- `flight-pr-ship-in-plugin`：`/flight:pr-ship` 与 `flight:code-reviewer` 由插件提供；apply 文档指向它们。
- `flight-entry-docs`：安装器列出已迁入插件的旧副本；README 等文档改用插件命令。

### Modified Capabilities

（无。`openspec/specs/` 下没有已归档的规格。`flight-entry` 的要求取代 flight-interaction 中「插件注册的命令恰为 flight」与「只接受人在终端发出」两处约束，见 design D3。）

## Impact

- **插件**：
  - `hooks/` 下的 `orchestrator.tsx`、`landing.tsx`、`envelope.ts`；
  - 新增 `commands/pr-ship.md` 与 `agents/code-reviewer.md`，由模板迁入；
  - 版本 0.7.0。
- **模板**：移除 `.claude/commands/pr-ship.md` 与 `.claude/agents/code-reviewer.md`；`/opsx-apply` 命令与 skill、legacy skill 改引用。
- **安装器与文档**：`install.sh`、`README.md`、`docs/WORKFLOW_zh.md`、仓库 `CLAUDE.md`。
- **测试**：读取这两个文件的 6 个测试改路径；插件测试世界里 58 处 `/opsx-apply` 调用补上来源。
- **本 change 自己的飞行**：
  - 在插件 0.6.0 上飞，入口靠本仓库根目录的 `.claude/commands/opsx-apply.md` 软链；
  - 落地交接照旧失败，由主会话手动走 pr-ship；
  - 合入后由人快进主检出、更新插件到 0.7.0；之后根目录软链可删。
