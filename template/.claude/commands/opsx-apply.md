---
description: 飞行模式 apply：由 flight 插件状态机执行，批准后从门禁 lint 直跑到 PR，中途不问；模型按角色显式路由
---

**执行引擎（先读）**
- 本命令由 flight 插件（0.2.0 及以上）的**状态机**执行：起飞检查（批准、干净工作区、lint / preflight、版本、主模型）与整个飞行（派发、收口门禁、合回、评审、修复、final、收口、pr-ship）都不经模型。
- 插件是唯一实现：插件缺席、未加载或版本不符即**停飞**，没有第二条路径（见文末「模型读到本命令即停飞」）。
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
- **意图门禁**：
  - 插件在场时，对主会话与非飞行 agent 的 Write、Edit 以及 Bash 写法（重定向、`tee`、`cp`、`mv` 等的写入目标）调用 `intent-gate.py check` 判定，不过即拒绝；
  - 飞行 agent 按 owns 限写，Bash 写法同样适用；
  - 插件缺席时由 classic hook（`intent-gate.py` 拦 Write / Edit）兜底；
  - apply 上下文只认目标所在 worktree 的 change：分支为 `worktree-<name>` 或 `flight/<name>/…` 时，只有该 change 的 `tasks.md` 有未勾项才算 apply 上下文。

**Input**：可选指定 change 名（如 `/opsx-apply add-auth`）。留空则取会话所在 worktree 的分支 `worktree-<name>`。
`授权提交`（可选，可以单独写，也可以粘在 change 名后面，如 `/opsx-apply add-auth 授权提交`）→ 起飞守卫通过后，插件只提交本 change 的工件（change 目录、ADR 草稿 `adr/DRAFT-*.md`、`scenario_tests` 映射到的测试文件、`slices.json` 的 `artifact_files` 声明的文件）再起飞；有工件之外的未提交改动仍拒绝起飞。
`--model=<alias>`（可选）→ 人工指定会话主模型别名 `<main>`，**优先于 `session-model.py` 的判定**；仅用于脚本判定不出、或主模型是第三方 / 自定义 id 的场合。
`--takeover`（可选）→ 只在「最新一次起飞来自另一个会话、尚未落地或停飞，而且你已确认那个会话已结束」时使用；不加时插件会拒飞并提示。
起飞的命令来源限制见下文「飞行中的交互」。
`--gate=per-task`（可选）→ 跳过飞行模式：插件不接管，把命令原样交给模型；模型转读 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md` 并按它逐 task 守门执行（legacy 路径，本命令其余段落不适用）。

**起飞检查（插件执行；任一项不过即不起飞，原样回报原因，不问询）**
- **批准指纹**：起飞时插件以 `takeoff-gate.py --change-dir` 比对账本 `refs/flight/<name>/ledger` 里最新的批准指纹与当前计划指纹；未批准、计划已变或账本损坏 → 不起飞，交出 `openspec/changes/<name>/spec.html` 的路径，请人核对 `spec.html` 顶部的计划指纹、在批准带按「批准起飞」即起飞（按下即起飞，不用再发命令）。
- **git 与 Claude Code 版本**：git 低于 2.38（合回用 `merge-tree --write-tree`）或 Claude Code 低于插件下限 → 不起飞。
- **版本核对**：插件副本须是已安装的版本，判定器（主检出的 `.claude/hooks/`）须认识全部账本事件；不符 → 不起飞，先把主检出更新到与插件同一版本。
- **跨会话**：最新一次起飞来自另一个会话、尚未落地或停飞 → 拒飞，提示用 `--takeover` 接管。
- **本会话本进程正在飞**：最新一次起飞来自本会话、尚未落地或停飞，且本进程正在驱动它 → 拒飞（不进入待命），需要中止用 `/flight abort <name>`；本进程未在驱动（如进程重启后回到原会话）→ 照常续飞。
- **工作区与「授权提交」**：change worktree 有工件之外的未提交改动 → 拒绝起飞；未提交的只有本 change 工件 → 提示加 `授权提交`；上一次飞行遗留的飞行记录先单独提交。
  - 工件还含 `slices.json` 的 `artifact_files` 声明的文件（精确路径、相对 worktree 根，如 scenario 测试的辅助模块、ADR 索引），随 `授权提交` / 按键起飞一并提交；有未声明的工件之外改动仍拒绝起飞，按拒绝信息的两条出路处理：自行提交或撤销后重发，或逐个列进 `artifact_files` 后在批准带重新批准再起飞。
- **lint / preflight**：
  ```bash
  python3 .claude/hooks/slice-gate.py lint --change-dir openspec/changes/<name>
  python3 .claude/hooks/slice-gate.py preflight --change-dir openspec/changes/<name>
  ```
  `lint` 非 0（规划红）或 `preflight` 非 0（`gate-baseline.json` 缺基线 / 基线红 / 基线过期）→ 不起飞，把 stderr 原样回报；基线由 `/opsx-propose` 的 `baseline` 步骤生成，缺了回去补，不在这里手工造。
- **主模型**：有 `--model=` 以它为准；否则由 `session-model.py` 判定 `<main>`；判不出 → 不起飞，提示用 `/opsx-apply <name> --model=<alias>` 重发。禁模型自述主模型。
- **上一次派出的 agent**：仍在运行 → 等它们结束再起飞。
- 全部通过后：插件把 takeoff 事件写入账本。飞行中判定器不写记录文件，记录都在账本里。

**派发与收口门禁（插件执行，中途不问）**
- **派发**：按 preflight 给出的 waves 逐 wave 派 `flight:executor`，每片一间 worktree（`.claude/worktrees/flight-<name>-<S>`，分支 `flight/<name>/<S>`，基于 change 分支尖端；见 `openspec-git-discipline`）。执行体按切片包 TDD，改生产代码前调用 `measure`，由控制面测量并写入账本。
- **收口门禁**：执行体收口时控制面运行切片门禁；红了把失败项交回执行体接着修，仍红记 blocked。门禁绿的切片由控制面合回 change 分支。
- **评审、修复与 final**：
  - `flight:reviewer` 评审已合回的切片；阻断 finding 交 `flight:fixer` 批量修复；再跑 final 门禁。有切片 blocked 或 final 未通过 → 停飞，修好后重发 `/opsx-apply <name>` 续飞。
  - final 绿后，控制面派 `flight:reviewer` 做**全量评审**，审整条 change 分支；有 CRITICAL/HIGH 交 `flight:fixer` 自动修，至多 2 轮，每轮修复后重跑 final，再派 `flight:reviewer` 复核本轮修复；仍未闭环就照常落地，由裁决落为 draft。
- **续飞另起 worktree**：续飞时同名 worktree 已存在就另起 `<S>-a<attempt>`，旧现场保留，清理由人执行。
- **落地交 `/flight:pr-ship`**：控制面在 `tasks.md` 勾选门禁绿的切片、记 `apply-done`，按 `slice-gate.py ship`（只读账本）的输出写 `review-findings.json`，由插件从账本生成 `timeline.md` 与 `gate-report.md`，与 `review-findings.json` 一起提交，然后调用 `/flight:pr-ship`。`/flight:pr-ship` 以 draft 建 PR 后调用 `ship` 工具，由插件按账本裁决 draft / ready 并贴评论。主会话不自行判断 draft。

**模型路由（铁律：按角色显式声明，不得留空让 `CLAUDE_CODE_SUBAGENT_MODEL` 默认兜底）**

| 角色 | 模型 | 说明 |
|---|---|---|
| `flight:executor`（实现切片） | 会话主模型 `<main>` | 插件派发时显式带 model |
| `flight:reviewer`（切片评审） | 会话主模型 `<main>` | 只读评审，不能写 |
| `flight:reviewer`（全量评审 / 复核） | 会话主模型 `<main>` | 只读，审整条 change 分支或本轮修复 |
| `flight:fixer`（批量修复 / 解冲突） | 会话主模型 `<main>` | 只能写全部 owns 的并集 |
| 起飞检查 · 门禁 · 合回 · final · 落地 | 不用模型 | 机械动作由插件执行，零 token |

**飞行中的交互（flight 插件）**
- `/flight status [<change>]`：打印飞行进度。
- `/flight panel [<change>]`：打开飞行面板；起飞时会自动打开。
- `/flight abort [<change>]`：只中止本会话起飞的飞行；先在账本记停飞，再停下在飞的 agent，它们未提交的改动留在各自 worktree。
- `/flight resume <change> [--takeover]`：只续未落地的 attempt；再发 `/opsx-apply <change>` 也会从账本续飞。
- **来源规则**：`/opsx-apply` 起飞、`/flight abort`、`/flight resume` 只接受终端（composer）、Remote Control（bridge）或 SDK 宿主（sdk）发出；定时任务、别的会话的消息、插件代发一律拒绝，不写账本。

**停飞自愈与续飞（插件执行，不经模型）**
- **自愈三种**：
  - **合回重派**：切片合回失败（非冲突）→ 用一棵新 worktree 重派一次执行体；重派后仍合回失败记 blocked。
  - **看门狗**：飞行 agent 的模型请求等待超过 10 分钟即停下该 agent；执行体走续派，评审员与修复体各重派一次，重派者仍无结果照旧 blocked。
  - **整合修复**：final 红时派修复体 `integ`，经专审评审后合回，再跑 final；每个 attempt 至多一轮。
- **预算**：每次飞行 3 次、同一处（同 kind 同切片）1 次；先在账本记 heal 再执行；预算用尽即按原行为处理（blocked / 停飞），原因写明「自愈预算已用尽」。
- **G9 整合护栏**（`slice-gate.py final --integ-base`）：整合修复不改工件与 ADR、不碰 scenario 测试、测试只增不减、不加 xfail / skip；专审评审有 CRITICAL/HIGH 即停飞。
- **停飞 kind 与终端通知**：停飞带 kind（`blocked` / `final` / `integ` / `fingerprint` / `control` / `watchdog` / `abort`）；停飞（`abort` 除外）、PR 开出、交接 `/flight:pr-ship` 失败时经 `$.ui.notify` 发终端通知，走你自己的通知通道；通知失败只记日志，不影响停飞、落地与 ship。
- **诊断员**：停飞后在 change worktree 派 `flight:diagnostician`（会话主模型），只读、不可写任何文件；诊断记为 triage，只供展示（面板与飞行记录），不参与任何判定；人工中止（`abort`）与计划变化（`fingerprint`）不派。
- **批准带（按下即起飞）**：四个按钮都按下即起飞，不再回车，输入框不预填；起飞回复首行经 toast 与终端通知告诉人。
  - 「批准起飞」（当前指纹未批准）：按下 = 批准 + 起飞。
  - 「起飞」（已批准、批准后未起飞）：按下 = 直接起飞，不重新批准。
  - 「批准修订并续飞」（已停飞且计划改过）：按下 = 批准 + 提交本 change 的工件 + 重跑基线 + 续飞；基线红则通知、不续飞。
  - 「续飞」（已停飞且计划未改）：等同 `/flight resume`，不重新批准。
  - 按键起飞一并提交本 change 的工件（说明行写明个数）；手打 `/opsx-apply <name>` 仍要带 `授权提交` 才提交工件。
- **起飞待命**（会话内状态，不进账本）：人发出的起飞（`/opsx-apply`、`/flight resume`、批准带按键）被拒后，插件按原因处理，不丢掉起飞意图：
  - 等待：基线仍在跑、上一次飞行的 agent 仍在运行 → 等它们结束后自动重试；
  - 重试：偶发失败（起飞异常、账本读取失败、写 takeoff 事件失败等）→ 10 秒后重试一次，仍失败即放弃；
  - 交给模型修：lint / preflight 未通过、提交工件失败 → 提示主会话修，本轮结束后自动重试。
  - 最多 3 次（等待类不计入），30 分钟内有效；用尽或过期即放弃，通知原因与做法；状态行显示「起飞待命」。
  - `/flight abort <change>` 可取消待命（回复「已取消起飞待命」），该 change 没有在飞的飞行也照样取消。
  - 只能人处理的不进入待命，直接通知原因与做法：版本不符、跨会话起飞、工件之外的未提交改动等；未批准、计划已变、未提交的只有本 change 工件 → 在批准带按「批准起飞」或「起飞」。
  - **唤醒轮**：插件只能在处理外部事件的 hook 里派发 agent，否则 agent 的工具调用会绕过包络与 measure。所以定时到点的重试（基线仍在跑的 60 秒检查、偶发失败的 10 秒重试）与看门狗停飞后的诊断员，都不直接派发：条件满足时，插件以自己的名义发一轮只回复「收到」的对话，这一轮结束时再起飞或派发。等待类先零 token 检查条件，没满足就不发。

**模型读到本命令即停飞**
- 先看本轮是否发过 `/opsx-apply`：
  - 本轮没有 `/opsx-apply` 命令（例如用户用自然语言要求开始实现，经 `openspec-apply-change` skill 读到本文）：不按插件缺席处理；停下，并提示人发出 `/opsx-apply <name>`。
  - 本轮已发 `/opsx-apply`（且不是 `--gate=per-task`）仍读到这里，才按插件缺席处理，见下。
- 除 `--gate=per-task` 外，插件接管时本命令不会到达模型。模型读到这里，说明 flight 插件缺席、未加载或版本不符。
- 必须停下报告，不得改用其他方式（手工派发 agent、照本文逐步执行等）实现本 change。
- 指引：`claude plugin marketplace add akarizo/intent-driven-claude-code --scope project` → `claude plugin install flight@intent-driven -s project` → `/reload-plugins`，再发一次 `/opsx-apply <name>`。

**暂停例外（仅这四种，其余一律直接往下走，不问）**
- spec 自相矛盾
- 需要破坏性操作（如需要用户显式授权的 merge / push / delete）
- 测试环境本身坏（verify 在改动前就不可运行）
- 同一门禁项连续 2 次红

**Guardrails**
- 启动到 `/flight:pr-ship` 之间不出现 AskUserQuestion（四种暂停例外走「停下报告」，不是问询）。
- 模型按角色显式路由；插件派发时不省略 `model`。
- 起飞批准以账本指纹为判据（人在批准带按「批准起飞」才写入账本），由 `.claude/hooks/takeoff-gate.py` 校验，**禁模型自证**；脚本非 0 就不起飞。
- `<main>` 由 `.claude/hooks/session-model.py` 判定，**禁模型自述**；判定不出停飞，人工 `--model=<alias>` 覆盖。
- `--gate=per-task` 是唯一非飞行路径，转给 legacy skill 承载。
- 不自动 merge / push / 删 worktree。
