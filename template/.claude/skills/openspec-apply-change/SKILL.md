---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change using flight mode — 由 flight 插件状态机执行，批准后从门禁 lint 一路跑到 PR，中途不问，模型按角色显式路由。Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.1"
---

**执行引擎（先读）**
- `/opsx-apply` 由 flight 插件（0.2.0 及以上）的**状态机**执行：起飞检查（批准、干净工作区、lint / preflight、版本、主模型）与整个飞行（派发、收口门禁、合回、评审、修复、final、收口、pr-ship）都不经模型。
- 插件是唯一实现：插件缺席、未加载或版本不符即**停飞**，没有第二条路径（见文末「模型读到本 skill 即停飞」）。
- **续飞与接管**：
  - 最新一次起飞来自另一个会话、尚未落地或停飞时，插件拒飞并提示；确认那个会话已结束后，加 `--takeover` 重新发出；
  - 续飞时新派发的执行体、修复体、解冲突 agent 遇到同名 worktree 已存在，会另起 `<名>-a<attempt>`，旧现场原样保留，清理由人执行；
  - 续接只在计划没变时复用原现场。
- **飞行中的权限（插件 0.3.1 起）**：
  - 飞行 agent 的写入限于角色包络：执行体只能写本片 owns，修复体只能写全部 owns 的并集，评审员不能写；
  - 飞行 agent 的 Bash 由插件固定在它自己的 worktree 里运行（命令前置 `cd '<自己的 worktree>' &&`）；改动类 git 只能作用于自己的 worktree，`-C`、`--git-dir`、`--work-tree` 或段内 `cd` 指向别处一律拒绝，只读 git 可以读主仓库内的任何树；
  - 危险 git（push、pull、merge、reset、worktree、stash、改历史、`config` 写入、`-c core.hooksPath` 等）一律拒绝；
  - heredoc（`<<`）与读标准输入的解释器（`python3 -`、`bash -s`、`/dev/stdin`）一律被拒：写文件用 Write 工具，跑脚本先写成脚本文件再运行；
  - Bash 只对门禁 / verify 命令、只读 git、`git add` / `git commit` 这类白名单免询问（带前导 `VAR=` 的段、git 指向范围之外的段不免询问），其余按你的权限设置；
  - 读取（Read / Grep / Glob）只在主仓库内免询问，主仓库之外按你的权限设置；
  - 飞行中主会话对在飞的 change worktree 只读。这一条是尽力而为：shell 已 `cd` 进去后不带路径的 git 命令拦不到，会话重启后要等再次起飞才恢复。

**REQUIRED SUB-SKILL：** 用 `openspec-git-discipline`（含 **Worktree Isolation**）—— apply 在本 change 的 `.worktrees/<name>/` worktree 上起飞，切片 worktree 由插件按该 skill 的飞行 carve-out 创建。

**Input**：可选指定 change 名。留空则取会话所在 worktree 的分支 `worktree-<name>`。
`授权提交`（可选，可以单独写，也可以粘在 change 名后面，如 `/opsx-apply add-auth 授权提交`）→ 起飞守卫通过后，插件只提交本 change 的工件（change 目录、ADR 草稿 `adr/DRAFT-*.md`、`scenario_tests` 映射到的测试文件）再起飞；有工件之外的未提交改动仍拒绝起飞。
`--model=<alias>`（可选）→ 人工指定会话主模型别名 `<main>`，**优先于 `session-model.py` 的判定**；仅用于脚本判定不出、或主模型是第三方 / 自定义 id 的场合。
`--takeover`（可选）→ 只在「最新一次起飞来自另一个会话、尚未落地或停飞，而且你已确认那个会话已结束」时使用；不加时插件会拒飞并提示。
`--gate=per-task`（可选）→ 插件不接管，把命令原样交给模型；模型转读 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md` 并按它逐 task 守门执行；本 skill 其余段落不适用于该分支。

**起飞检查（插件执行；任一项不过即不起飞，原样回报原因，不问询）**
- **批准指纹**：起飞时插件以 `takeoff-gate.py --change-dir` 比对账本 `refs/flight/<name>/ledger` 里最新的批准指纹与当前计划指纹；未批准、计划已变或账本损坏 → 不起飞，交出 `openspec/changes/<name>/spec.html` 的路径，请人核对 `spec.html` 顶部的计划指纹、在批准带按「批准起飞」后重新发出 `/opsx-apply <name>`。
- **git 与 Claude Code 版本**：git 低于 2.38（合回用 `merge-tree --write-tree`）或 Claude Code 低于插件下限 → 不起飞。
- **版本核对**：插件副本须是已安装的版本，判定器（主检出的 `.claude/hooks/`）须认识全部账本事件；不符 → 不起飞，先把主检出更新到与插件同一版本。
- **跨会话**：最新一次起飞来自另一个会话、尚未落地或停飞 → 拒飞，提示用 `--takeover` 接管。
- **工作区与「授权提交」**：change worktree 有工件之外的未提交改动 → 拒绝起飞；未提交的只有本 change 工件 → 提示加 `授权提交`；上一次飞行遗留的飞行记录先单独提交。
- **lint / preflight**：
  ```bash
  python3 .claude/hooks/slice-gate.py lint --change-dir openspec/changes/<name>
  python3 .claude/hooks/slice-gate.py preflight --change-dir openspec/changes/<name>
  ```
  `lint` 非 0（规划红）或 `preflight` 非 0（`gate-baseline.json` 缺基线 / 基线红 / 基线过期）→ 不起飞，把 stderr 原样回报；基线由 propose 的 `baseline` 步骤生成，缺了回去补。
- **主模型**：有 `--model=` 以它为准；否则由 `session-model.py` 判定 `<main>`；判不出 → 不起飞，提示用 `--model=<alias>` 重发。禁模型自述主模型。
- **上一次派出的 agent**：仍在运行 → 等它们结束再起飞。
- 全部通过后：首次起飞时插件以 `takeoff-gate.py` 的批准证据原文记 `timeline.py record approve` 并提交 `chore(flight): approve`，再把 takeoff 事件写入账本。

**派发与收口门禁（插件执行，中途不问）**
- **派发**：按 preflight 给出的 waves 逐 wave 派 `flight:executor`，每片一间 worktree（`.claude/worktrees/flight-<name>-<S>`，分支 `flight/<name>/<S>`，基于 change 分支尖端）。执行体按切片包 TDD，改生产代码前调用 `measure`，由控制面测量并写入账本。
- **收口门禁**：执行体收口时控制面运行切片门禁；红了把失败项交回执行体接着修，仍红记 blocked。门禁绿的切片由控制面合回 change 分支。
- **评审、修复与 final**：`flight:reviewer` 评审已合回的切片；阻断 finding 交 `flight:fixer` 批量修复；再跑 final 门禁。有切片 blocked 或 final 未通过 → 停飞，修好后重发 `/opsx-apply <name>` 续飞。
- **续飞另起 worktree**：续飞时同名 worktree 已存在就另起 `<S>-a<attempt>`，旧现场保留，清理由人执行。
- **落地交 `/pr-ship`**：控制面写 `review-findings.json`、在 `tasks.md` 勾选门禁绿的切片、记 `apply-done`、提交飞行记录，跑 `slice-gate.py ship` 机械裁决 draft / ready，然后调用 `/pr-ship`。主会话不自判 draft。

**模型路由（铁律：按角色显式声明，不得留空让 `CLAUDE_CODE_SUBAGENT_MODEL` 默认兜底）**

| 角色 | 模型 |
|---|---|
| `flight:executor`（实现切片） | 会话主模型 `<main>` |
| `flight:reviewer`（切片评审） | 会话主模型 `<main>` |
| `flight:fixer`（批量修复 / 解冲突） | 会话主模型 `<main>` |
| 起飞检查 · 门禁 · 合回 · final · 落地 | 不用模型：机械动作由插件执行，零 token |

**模型读到本 skill 即停飞**
- 除 `--gate=per-task` 外，插件接管时 `/opsx-apply` 不会到达模型。模型读到这里，说明 flight 插件缺席、未加载或版本不符。
- 必须停下报告，不得改用其他方式（手工派发 agent、照本文逐步执行等）实现本 change。
- 指引：`claude plugin marketplace add akarizo/intent-driven-claude-code --scope project` → `claude plugin install flight@intent-driven -s project` → `/reload-plugins`，然后重新发出 `/opsx-apply <name>`。

**暂停例外（仅这四种）**：spec 自相矛盾 · 需要破坏性操作 · 测试环境本身坏 · 同一门禁项连续 2 次红。

**Guardrails**
- 启动到 `/pr-ship` 之间不出现 AskUserQuestion。
- 模型按角色显式路由；插件派发时不省略 `model`。
- 起飞批准以账本指纹为判据（人在批准带按「批准起飞」才写入账本），由 `.claude/hooks/takeoff-gate.py` 校验，**禁模型自证**；脚本非 0 就不起飞。
- `<main>` 由 `.claude/hooks/session-model.py` 判定，**禁模型自述**；判定不出停飞，人工 `--model=<alias>` 覆盖。
- `--gate=per-task` 转 legacy skill，不与本流程混用。
- 不自动 merge / push / 删 worktree。

**Fluid Workflow Integration**

- 可随时调用；不锁相位（Before all artifacts are done、部分实现之后都能跑）。
- 实现中若发现设计问题，允许建议更新工件，不是硬性阻断。
