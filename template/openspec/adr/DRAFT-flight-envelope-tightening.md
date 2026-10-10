# DRAFT. 飞行 agent 的 Bash 固定在自己的 worktree，包络按 #41 评审收紧

- Status: accepted, supersedes DRAFT-flight-capability-envelope
- Date: 2026-10-10
- Supersedes: DRAFT-flight-capability-envelope
- 关联：DRAFT-flight-orchestrator-state-machine · DRAFT-flight-control-plane-in-mod
- 来源 change：flight-envelope-tightening（design D1–D6）

## Context

`DRAFT-flight-capability-envelope`（#41，插件 0.3.0）定义了飞行 agent 的能力包络。之后有两类新事实，迫使包络整体重述。

**spawn 的 cwd 未生效（实测）**：`$.agent.spawn({ cwd })` 给的目录没有作用到子 agent 的 shell 上；`AgentSpawnInput.cwd` 的类型文档写的是「子 agent 运行的目录」，实测不成立。
- #40、#41 的 21 个 flight agent，转录里记录的 cwd 都是主会话**当前**的工作目录，并且随主会话 cd 而变；#41 的 S2 执行体自己跑 `pwd`，打印的是 `.worktrees/flight-envelope`。
- 后果：5 个执行体挤在同一棵 change worktree 里并行改文件，裸 `git commit` 落到 change 分支，合回全部成了空合并，切片评审拿不到 diff；主会话若停在主检出里，裸 commit 会进本地 main。
- 同一份计划第一次以 `flight-envelope-followups` 起飞时（实际跑在 0.2.1 上）再次复现：执行体直接提交进 change 分支，S3、S5、S6 空合回。

**#41 评审留下的安全缺口**：
- Bash 免询问白名单不检查 git 的作用目标：`git -C <别处> commit`、`--git-dir=`、前导 `GIT_DIR=` / `GIT_EXTERNAL_DIFF=` 都能免询问。
- 飞行 agent 的 Read / Grep / Glob 不分路径一律免询问，`~/.ssh` 也包括在内。
- 拒绝表有缺口：缺 `git pull`、`git config` 的写入、`-c core.hooksPath=…`（与 `--no-verify` 等效）；长选项缩写 `--am`、`--d` 没被拦。
- agent 先 spawn、后写 dispatch，这段窗口里包络对它放行（fail-open）；`ownerOf` 不缓存未命中，非飞行 subagent 每次工具调用都扫一遍账本。
- 飞行中实测：#41 的一个 S6 执行体执行 `python3 -`（读标准输入）挂起 1 小时 24 分钟；执行体用 heredoc 写文件，绕过了写入包络。

## Decision

全文重述飞行包络。第 1–6 条承接旧 ADR，标「修订」的是本 ADR 改动之处；第 7–9 条为新增。

1. **写入包络：按 agentId 找角色，按角色限路径。**（承接，未修订）飞行 agent 的 Write / Edit / NotebookEdit 先把目标规范成绝对路径，再按角色判断：执行体只能写自己切片 worktree 内、匹配本片 `owns` 的路径；修复体与解冲突 agent 只能写自己 worktree 内、匹配全部切片 `owns` 并集的路径；评审员不能写。匹配语义与 `slice-gate.py` 的 `glob_match` 一致。角色先查派发时写入的内存缓存，查不到再扫账本。不属于任何飞行的 agent 一律放行。
2. **Bash：危险 git 一律拒绝。**（修订：D3 补齐拒绝表）沿用旧表：`push`、`merge`、`rebase`、`reset`、`checkout`、`switch`、`worktree`、`update-ref`、`symbolic-ref`、`stash`、`tag`、`cherry-pick`、`revert`、`clean`、`filter-branch`、`replace`、`notes` 拒绝；`branch` 带删除 / 改名 / 强制类选项拒绝；`commit --amend` / `--no-verify` 拒绝；命令含 `refs/flight/` 拒绝；评审员另外拒绝 `add`、`commit`、`rm`、`mv`、`apply`、`am`。本 ADR 补充（所有飞行角色）：
   - `pull` 拒绝；`config` 除只读用法（`--get`、`--get-all`、`--get-regexp`、`--get-urlmatch`、`--list`、`-l`）外一律拒绝；
   - 全局选项 `-c core.hooksPath=…`、`--config-env=core.hooksPath=…`（键名不分大小写）拒绝，与 `--no-verify` 同等对待；
   - 长选项缩写门槛降到 `--` 之后 1 个字符（`--am`、`--d` 都会被识别），多拒的方向是安全的；
   - 读标准输入的解释器：程序名为 `python`、`python3`、`node`、`bash`、`sh`、`zsh`、`ruby`、`perl` 且参数里有单独的 `-` 或 `-s`，或任意位置出现 `/dev/stdin` → 拒绝，理由「写成脚本文件再运行」；
   - heredoc：命令含 `<<` → 拒绝，理由「改用 Write 工具写文件」。
3. **Bash：只给白名单免询问。**（修订：D4 收紧）每一段都命中白名单才把 ask 升为 allow：门禁命令与切片 `verify`、只读 git（`status`、`diff`、`log`、`show`、`rev-parse`、`ls-files`、`blame`、`grep`）、执行体与修复体的 `git add` / `git commit`。含命令替换、反引号、输入输出重定向（`2>&1` 除外）或后台 `&` 的一律不升级。本 ADR 收紧：
   - 任何一段带前导 `VAR=`（例如 `GIT_EXTERNAL_DIFF=…`）→ 不升级；
   - git 段按第 8 条判定作用目录：只读子命令要在主仓库内，`add` / `commit` 要在自己的 worktree 内，否则不升级；
   - 认可第 7 条插件自己前置的 `cd '<自己的 worktree>' &&` 这一段。
4. **`tool.check` 只升 ask，只在包络内。**（修订：D5 读取限于主仓库内；D6 登记中不升级）先取引擎判定 `next(e)`：主会话或非飞行 agent 原样返回；判定不是 ask 原样返回；组织上限为 ask 原样返回。答 allow 的只有：
   - Read / Grep / Glob 的目标规范化后在主 worktree 内（已包含 `.worktrees/` 与 `.claude/worktrees/` 下的切片 worktree）；Read 取 `file_path`，Grep / Glob 取 `path`，没有 `path` 时视为自己的 worktree；主仓库之外原样交回引擎判定。旧 ADR 的「Read / Grep / Glob 答 allow」由此取代；
   - 包络内的写入、白名单 Bash、评审员调用 `mcp__flight__submit_findings`；
   - 登记中的 agent（第 9 条）一律不升级。
5. **飞行中主会话对在飞 worktree 只读（尽力而为）。**（承接，未修订）插件在账本写入点维护「在飞」集合（takeoff 加入，land / halt 移出）。主会话在在飞树内的写入一律拒绝；主会话 Bash 命令文本含在飞树绝对路径且带改动类 git 子命令或 `>` 重定向时拒绝。
6. **`agent.spawn` 守卫。**（承接，未修订）`flight:*` 类型只能由 flight 插件派发；由插件派发的 `flight:*` 必须显式指定 model（铁律 11）；飞行中的 agent 不得再派发子 agent；守卫自身抛错时对 `flight:*` 拒绝、其他类型放行。
7. **飞行 agent 的 Bash 一律前置 `cd '<自己的 worktree>' &&`。**（新增：D1）`tool.call` 对飞行 agent 的 Bash 返回 `next({ ...e, command: inWorktree(command, worktree) })`：worktree 用单引号包起来，内部的 `'` 转义为 `'\''`；命令已以这一段开头时不重复加。裸 `git commit`、相对路径、测试命令都落在正确的树里，与 agent 以为自己在哪无关。引擎日后真正应用 spawn 的 cwd，这一改写也不会造成伤害。
8. **改动类 git 只能作用于自己的 worktree。**（新增：D2）按段解析 git 调用，作用目录依次取：`-C <p>`（可多次，按 git 语义逐级拼接）、`--git-dir=…`、`--work-tree=…`；同一命令里前面某段 `cd <绝对路径>` 设定的目录；都没有时就是第 7 条的 worktree。子命令不是只读的、且作用目录不在自己的 worktree 内 → 拒绝；只读子命令可以指向主仓库内的任何树（评审员要读 change 分支）；相对路径的 `cd` 或 `-C` 无法判定，按「不在」处理。
9. **agent 归属：登记中 fail-closed，未命中缓存。**（新增：D6）`ctx.spawn` 一拿到 agentId 就记为「登记中」；dispatch 事件写入时移出并记进归属表。登记中的 agent：Write / Edit / NotebookEdit / Bash 一律拒绝（理由「派发登记中，稍后重试」），其余工具交给下游，`tool.check` 不升级。`ownerOf` 扫完账本仍查不到时记入未命中缓存，下次直接返回未命中；dispatch 事件写入时清空该缓存。

否决的方案：
- **只靠提示词要求 `git -C`**：#41 时还没有这条提示；有了也没法强制，模型漏写一次就落到错误的分支上。提示词仍写明（agent 定义与派发提示词首行），但强制点在插件改写。
- **要求每条改动类 git 必须带 `-C`**：执行体会频繁被拒，靠它自己纠正不如直接改写；改写后裸 git 天然落在自己的 worktree，第 8 条只拦指向别处的情形。
- **继续等引擎修好 spawn 的 cwd**：引擎侧问题不在本仓库控制范围内，期间每次飞行都会出空合回；插件层改写对两种引擎行为都正确。
- **对飞行 agent 的 Bash 一律 allow / 只靠门禁事后核对**：沿用旧 ADR 的否决理由，不变。

## Consequences

- **更易**：执行体、修复体的 shell 与 git 固定在自己的 worktree，并行切片不再挤在同一棵树里、合回不再是空合并；#41 评审的三条安全缺口（git 作用目标、读取范围、拒绝表）闭合；派发登记窗口不再放行。
- **更难**：读取主仓库之外的文件在 default 模式下会弹询问；heredoc 与读标准输入的解释器被拒，合法写法也要改成 Write 工具或脚本文件（拒绝理由直接给出替代做法）；切段、作用目录判定与白名单匹配都属于可信计算基，必须由 scenario 测试覆盖。
- **已知边界**：Bash 写文件仍绕得过写入预拦，权威核对仍是门禁的 owns 检查；主会话只读仍是尽力而为（shell 已 `cd` 进在飞树后不带路径的 git 命令拦不到，会话重启后要等再次起飞才恢复）。这些边界同步写进 `/opsx-apply` 命令与 `openspec-apply-change` skill 的「执行引擎（先读）」。
- **中性**：本 ADR 取代 `DRAFT-flight-capability-envelope`，旧 ADR 原文不改；承接而不取代 `DRAFT-flight-orchestrator-state-machine`；插件版本升到 0.3.1。
