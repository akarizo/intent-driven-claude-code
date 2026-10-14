---
description: 端到端送出本次变更：commit → push → 创建 PR/MR。飞行模式：评审与修复已在飞行内完成，以 draft 建 PR 后由 ship 工具按账本裁决（零问询）；飞行外：干净 subagent 自检 → 评论入库 → 自动迭代修复（至多一次问询）
---

把当前分支的全部变更端到端送出：commit 未提交项 → push → 创建 PR（GitHub）或 MR（GitLab）→ 按模式收尾。两种模式：

- **飞行模式**（`<change-dir>/slices.json` 存在）：全量评审与 CRITICAL/HIGH 修复已在飞行内由控制面完成，本命令只负责送出：以 draft 建 PR，再由 `ship` 工具按账本裁决、贴评论、切换 draft / ready。不派评审员、不问人。
- **飞行外**（无 `slices.json`）：建 PR 后起一个**干净的 code-review subagent** 对 diff 做一次评审 → 把结果贴成 PR/MR 评论 → CRITICAL/HIGH 自动修复（至多 2 轮）→ 收尾；全程至多一次问询。

支持 **GitHub（gh）** 与 **GitLab（glab）** 两个平台，按 `origin` URL 自动判断（飞行模式的 `ship` 工具只支持 GitHub）。

**Input**：`/flight:pr-ship [<target>] [--worktree <path>] [--change-dir <path>] [--judges <dir>]`，例如 `/flight:pr-ship develop`。
- `<target>`：target branch，缺省 `main`。
- `--worktree`：要送出的 worktree，缺省为当前目录。
- `--change-dir`：change 目录，缺省 `openspec/changes/<name>`；下文写作 `<change-dir>`。
- `--judges`：判定器目录，缺省 `.claude/hooks`；下文写作 `<judges>`。
- 飞行落地时插件给齐 `--worktree`、`--change-dir`、`--judges` 三个参数，参数附在「ARGUMENTS」里；按原样使用，不自行改写。
- 飞行模式下 draft / ready 由 `ship` 工具按账本裁决（插件执行），本命令不自行判断。

**在 worktree 里运行（通则）**：下文所有 git、gh / glab 与判定器（`python3 <judges>/…`）命令都在 `--worktree` 里以子 shell `(cd <worktree> && …)` 运行，例如 `(cd <worktree> && git status --short)`；不改主会话的当前目录。

**Steps**

1. **前置检查（必须全过才继续）**

   并行跑：
   ```bash
   git rev-parse --show-toplevel        # 必须在 git 仓库内
   git branch --show-current             # 不能在 main / master / develop / target 上
   git remote get-url origin             # 探测平台: github.com → gh; gitlab → glab
   ```

   按 origin URL 选 CLI（github.com → `gh`；gitlab → `glab`；二者皆无 → 报错退出）。

   验鉴权：`gh auth status`（或 `glab auth status`）。
   - **未安装** → 输出用户需要自己在终端跑的安装命令（`brew install gh` / `brew install glab` 等），不代为执行。
   - **未鉴权** → 输出 `gh auth login` / `glab auth login` 指引，让用户自己跑（交互命令，不能代跑）。
   - 任一条不过 → 退出本次 `/flight:pr-ship`，等用户跑完再重试。

2. **梳理本轮变更范围**

   并行：
   ```bash
   git status --short
   git fetch origin <target-branch>
   git diff --stat origin/<target-branch>...HEAD
   git log --oneline origin/<target-branch>...HEAD
   ```

   **CLAUDE.md 特别检查**：若工作树或本分支有 `CLAUDE.md` 的改动，跑一次 `python3 <judges>/claudemd-lint.py`；带 ERROR 的 CLAUDE.md 不进 PR——直接停下报告需要先处理的项（不问询，等用户改完重跑）。

3. **如有未提交改动，直接 commit（不问询）**

   - `git add <仅与本任务相关的文件，不用 -A>`。
   - AI 起一份**中文** conventional commit message（feat/fix/refactor/docs/test/chore/perf/ci 类型 + 中文描述，必要时加正文），直接提交：
     ```bash
     git commit -m "$(cat <<'EOF'
     <类型>: <中文描述>
     EOF
     )"
     ```
   - **不带 attribution**（按用户全局 settings.json 禁用）。

4. **预合并冲突检查**（先与 target 预合并，解决冲突才能提 PR/MR）

   飞行模式下，落地前插件已把目标分支预合并进 change 分支，这里通常无冲突。落地后才出现冲突时：人解完冲突并提交后发 `/flight recheck <change>`，由控制面重跑 final 与全量评审后再执行本命令；不要手工把 PR 转 ready。其余步骤不变。

   ```bash
   git fetch origin <target-branch>
   git merge-tree --write-tree --name-only HEAD origin/<target-branch>
   ```

   需要 git ≥ 2.38（`--write-tree` 自该版本起提供）。按退出码判断：

   - **退出 0** → 无冲突，进入下一步。
   - **退出 1** → 有冲突：输出第一行是树 id，其后直到空行是冲突文件。报告这些文件，停下交用户自行 `rebase` / `merge` / 处理（需要人对冲突内容做判断，不算本命令的问询预算，也不是自动化能安全代劳的一步）。
   - **其他退出码** → 报告错误并停下。

5. **Push 当前分支**

   ```bash
   git push -u origin "$(git branch --show-current)"
   ```

6. **生成并直接使用 PR/MR 标题与正文（不问询）**

   AI 根据 `git log <target>...HEAD` 与 `git diff --stat <target>...HEAD` 自动起草：

   - **标题**（< 70 字符，**中文**，参考 conventional commits）：`<type>: <概要>`
   - **正文**（**中文**，固定 3 段）：
     ```markdown
     ## 背景
     <1-3 句：为什么做这次变更>

     ## 设计
     - <设计点 1>
     - ...

     ## 测试计划
     - [ ] <验证项 1>
     ```
   - 飞行模式（`<change-dir>/slices.json` 存在）→ 正文只写上面三段；不贴门禁段落与切片评审清单：裁决与全量评审结论由第 7 步的 `ship` 工具贴成 PR 评论。
   - 飞行外（无 `slices.json`）→ 正文末尾加一行「非账本裁决（飞行外）」，让人类 reviewer 知道本 PR 的 draft / ready 不来自账本。

   起草完直接用于创建 PR，不再逐项确认。

7. **创建 PR/MR**

   - **飞行模式**：一律带 `--draft` 建 PR：
     ```bash
     gh pr create --draft --base <target> --head <branch> --title "<标题>" --body "$(cat <<'EOF'
     <正文>
     EOF
     )"
     ```
     抓取返回的 PR URL 与编号后，调用 `ship` 工具（`mcp__flight__ship`），参数 `change` = `<change-dir>` 的最后一段、`pr` = PR 号。插件会核对 PR 头与 change worktree 的 HEAD 一致、按账本裁决、把裁决与全量评审结论贴成 PR 评论、切换 draft / ready、在账本记 ship 事件；主会话据工具结果打印，不自行判断。工具拒绝时：
     - 原因是「先推送」→ 先 `git push`，再调一次 `ship` 工具；
     - 原因是「只支持 GitHub」→ PR 保持 draft，交人决定；
     - 其他原因 → 停下报告原因。
   - **飞行模式（GitLab）**：origin 为 GitLab 时 `ship` 工具只支持 GitHub，改用 glab 以 draft 建 MR，不调用 `ship` 工具：
     ```bash
     glab mr create --draft --target-branch <target> --source-branch <branch> --title "<标题>" --description "..."
     ```
     报告「只支持 GitHub，MR 保持 draft，交人决定」。
   - **飞行外**：
     - GitHub:
       ```bash
       gh pr create --base <target> --head <branch> --title "<标题>" --body "$(cat <<'EOF'
       <正文>
       EOF
       )"
       ```
       不加 `--draft`。
     - GitLab: `glab mr create --target-branch <target> --source-branch <branch> --title "<标题>" --description "..."`（同样不加 `--draft`）。

   PR 打开时间：飞行模式由 `ship` 工具的 ship 事件记入账本；飞行外不再记录。随后照旧打印用时：
   ```bash
   python3 <judges>/timeline.py report --change-dir <change-dir>    # 打印批准 → PR 打开用时
   ```

   飞行模式到此转第 11 步；第 8–10 步只用于飞行外。

8. **呼叫干净的 flight:code-reviewer subagent 评审 diff（飞行外；唯一模式：full）**

   ```bash
   git rev-parse HEAD                        # 记为 REVIEW_HEAD_1（SHA，嵌进 prompt；HEAD 不交给子 agent 解析）
   python3 <judges>/session-model.py    # stdout: opus|sonnet|haiku|fable，记为 <main>；exit 3 = 判定不出
   ```

   子 agent 的 shell 不一定在 `<worktree>` 里：prompt 里的 `<worktree>` 写绝对路径，`<abs-change-dir>` = `<change-dir>` 的绝对路径（相对路径按 `<worktree>` 解析）。

   用 **Agent 工具**启一个 `subagent_type=flight:code-reviewer`、`model: "<main>"`（`<main>` = `python3 <judges>/session-model.py` 的输出，禁模型自述；判定不出则**停下报告**，让用户显式给出别名后重跑；铁律：派发不得省略 `model`）。该 agent 的 system prompt 已含完整分级 rubric、finding 格式、签名——只传 PR 特有上下文：

   ```
   背景: review GitHub/GitLab 上的 PR/MR #<num>。
   仓库: <origin URL>；target: <target>；PR/MR URL: <url>
   工作目录: <worktree>（所有 git 命令以 git -C <worktree> 运行，读文件用 <worktree> 下的绝对路径）

   评审模式: full
   审查范围: 本 PR 相对 target 分支的完整 diff。
   取 diff: 首选 `gh pr diff <num>`（GitHub）或 `glab mr diff <num>`（GitLab）。
   拉取失败（例如 diff 过大 HTTP 406）→ `git -C <worktree> fetch origin <target>` 后 `git -C <worktree> diff origin/<target>...<REVIEW_HEAD_1>`（即 `git diff origin/<target>...HEAD`，HEAD 已由主会话解析为 <REVIEW_HEAD_1>）。
   diff 确实为空 → 报告"无变更"并停止。
   两种都拉不到 → 报告"取 diff 失败"并停止，不得报告"无变更"。

   参考材料（不重跑测试套件，以此为准）：
   - 飞行模式：<abs-change-dir>/gate-report.md（各切片门禁 G1–G7 结论）与 `python3 <judges>/timeline.py report` 的门禁红次数和测量统计，均来自账本（G5 先红证据 = 控制面测量）
   - 飞行外（主会话修复等）：<abs-change-dir>/evidence.log 摘要（RED→GREEN 留痕）

   按你既定的分级标准、finding 格式与签名输出完整 markdown，准备直接贴成 PR/MR 评论。
   monorepo 跨多个 sub-repo 时按 sub-repo 分块组织 finding。
   ```

9. **把 review 贴成 PR/MR 评论（飞行外）**

   评论体 = 门禁摘要 + subagent 返回的完整 markdown + 签名。

   门禁摘要（贴在报告最前面）：
   ```
   > 门禁：G1–G7 结果 / final ok
   ```

   - GitHub: `gh pr comment <num> --body "..."`
   - GitLab: `glab mr note <num> --message "..."`

   签名固定贴在末尾：
   ```
   — reviewed by Claude Code (code-reviewer subagent), <YYYY-MM-DD>（当天日期）
   ```

10. **CRITICAL/HIGH 自动修复（飞行外；至多 2 轮，修前问一次）**

    - 有 CRITICAL/HIGH → 唯一一次 **AskUserQuestion**：『自动修并 push』/『只贴评论交人』；无人应答默认只贴评论。
      - 选「只贴评论交人」（或默认）→ 不修代码：finding 留在 PR 评论里，交人处理。
      - 选「自动修并 push」→ 走下面的原有流程（至多 2 轮）。
    - 自动修：主会话直接按建议修代码 → 每个独立修复点一个 commit（message 引用 finding 摘要：`fix: 按 review 修 <finding 摘要>`）→ `git push` → 在 worktree 里 `git rev-parse HEAD` 记为 REVIEW_HEAD_本轮（SHA）→ 派一个 fresh `subagent_type=flight:code-reviewer`（`model: "<main>"`，同 step 8 由 `session-model.py` 判定，判定不出则停下报告）走 **`follow-up` 模式**复核：
      ```
      背景: 复核 PR/MR #<num> 的修复补丁。
      工作目录: <worktree>（所有 git 命令以 git -C <worktree> 运行，读文件用 <worktree> 下的绝对路径）
      评审模式: follow-up
      审查范围（仅这个范围）: `git -C <worktree> diff <REVIEW_HEAD_上一轮>..<REVIEW_HEAD_本轮>`。
      上一轮的 CRITICAL/HIGH finding（逐条核对是否已闭环）：
      <贴出上一轮报告的 CRITICAL/HIGH 条目>
      按你既定的分级标准输出，结论行明确"通过 / 阻断"，末尾签名。不要修代码。
      ```
      复核报告同样按 step 9 贴成新评论。
    - 复核仍有 CRITICAL/HIGH 且已跑满 2 轮 → 停下交人，列出仍阻断的 finding。
    - MEDIUM/LOW：只写进评论，不自动修，不占用轮次。

11. **收尾**

    - 飞行模式：PR 状态取自 `ship` 工具的结果；飞行记录（timeline）已在落地时由插件从账本生成并提交，不再另外提交。
    - 打印 Output Summary，直接结束（不再问询），并给出 `gh pr merge <num> --squash --delete-branch` / `glab mr merge <num>` 供用户自己在终端跑（不代用户合并）。

**Output Summary（命令收尾时打印）**

```
## /flight:pr-ship 完成

**PR/MR**: <URL>
**target**: <target-branch>
**PR 状态**: ready / draft（飞行模式：取自 `ship` 工具的结果，draft 时附 reasons；飞行外：非账本裁决）
**commit 数**: N
**review 轮数**: M（飞行模式：飞行内完成，见 ship 评论）
**已自动修复**: X 条 CRITICAL/HIGH（飞行外填写；飞行模式：见 ship 评论）
**评论中列出（未自动修）**: Y 条 MEDIUM/LOW（飞行外填写；飞行模式：见 ship 评论）

下一步:
  - 等 human reviewer / CI
  - 或: gh pr merge <num> --squash --delete-branch
```

**Guardrails**

- **不代用户鉴权**：`gh auth login` / `glab auth login` 必须用户自己在终端跑。
- **不代用户合并**：AI 只输出 merge 命令给用户，不自动跑。
- **不绕过预合并冲突检查**：发现冲突就停，让用户决定。
- **commit 不用 `-A`**：只加与本任务相关的文件。
- **commit 不带 attribution**：按用户 settings.json 全局禁用。
- **飞行模式交给 `ship` 工具**：不派评审员、不改 `review-findings.json`、不执行 `gh pr ready`；draft / ready 只由 `ship` 工具按账本裁决。
- **subagent 必须干净**（飞行外）：不给它主会话的对话历史 / 设计意图，只给 diff + 门禁摘要（有飞行记录时：gate-report.md 与 timeline.py report 的测量统计；飞行外（主会话修复等）：evidence.log）。
- **评审只 full 一种模式**：不重跑测试套件、不轮询，以门禁报告与账本测量统计为准（飞行外以 evidence.log 为准），至多 1 次定向抽查命令。
- **CRITICAL/HIGH 自动修复至多 2 轮**：仍阻断则停下交人，不无限重试。
- **问询预算**：飞行模式全程零问询；飞行外至多问询 1 次（仅 step 10 自动修复前，问自动修还是只贴评论交人）。其余环节（commit 文案、PR 正文、是否复审、收尾）一律直接执行，不问询。
- **review 评论签名必带**：让 PR 阅读者知道这条评论来自 AI。
- **monorepo 友好**：跨多个 sub-repo 时按 sub-repo 分块 review。

**与已有命令的配合**

| 上游 | 本命令 (`/flight:pr-ship`) | 下游 |
| --- | --- | --- |
| `/opsx-apply` 飞行模式跑完 | ship: commit → draft PR → `ship` 工具按账本裁决 | 人类 reviewer 看 / 合并 |
| `/claudemd-commit` 沉淀完知识 | ship: 把 CLAUDE.md 改动也带进同一个 PR | 累积多轮后 `/claudemd-distill` |

典型使用顺序：
1. `/opsx-apply <change>` → 飞行模式跑完实现 + 测试 + 全量评审与修复，落地后由插件调用本命令
2. `/claudemd-commit` → 把本轮变更里新的约定 / 反模式沉淀到记忆层
3. `/flight:pr-ship` → 飞行外：ship + 自审 + 自动修复到阻断项清零或跑满 2 轮
4. 人类 reviewer 看 / 合并到 main
5. （合并几轮后）`/claudemd-distill` → 收敛 CLAUDE.md
