---
description: 端到端送出本次变更：commit → push → 创建 PR/MR → 干净 subagent 自检 → 评论入库 → 迭代修复
---

把当前分支的全部变更端到端送出：commit 未提交项 → push → 创建 PR（GitHub）或 MR（GitLab）→ 起一个**干净的 code-review subagent** 对 diff 做评审 → 把 review 结果作为 PR/MR 评论入库 → 与用户讨论是否修复 → 如果修，提交补丁到同 PR/MR，循环到 review 通过或用户主动收尾。

支持 **GitHub（gh）** 与 **GitLab（glab）** 两个平台，按 `origin` URL 自动判断。

**Input**: 可选指定 target branch（默认 `main`）。例如 `/pr-ship develop`。

**Steps**

1. **前置检查（必须全过才继续）**

   并行跑下面几条命令，每条产出一个 PASS/FAIL：
   ```bash
   git rev-parse --show-toplevel        # 必须在 git 仓库内
   git branch --show-current             # 不能在 main / master / develop / target 上
   git remote get-url origin             # 探测平台: github.com → gh; gitlab → glab
   ```

   按 origin URL 选择 CLI：
   - `github.com` 或自托管 GitHub → 用 `gh`
   - `gitlab.com` 或自托管 GitLab → 用 `glab`
   - 二者皆无 → 报错并退出（不支持其他平台）

   验 CLI 是否安装且鉴权：
   ```bash
   gh auth status        # 或 glab auth status
   ```

   - **未安装** → 输出**用户需要在终端跑的命令**（不代为执行）：
     - macOS: `brew install gh` / `brew install glab`
     - Linux: 参见 [cli.github.com](https://cli.github.com/) / [gitlab.com/gitlab-org/cli](https://gitlab.com/gitlab-org/cli)
   - **未鉴权** → 同上输出 `gh auth login` 或 `glab auth login` 指引，**让用户自己在终端跑**（这是交互命令，不能从 Claude 代跑）
   - 退出本次 `/pr-ship`，等用户跑完再重试

2. **梳理本轮变更范围**

   并行：
   ```bash
   git status --short
   git fetch origin <target-branch>
   git diff --stat origin/<target-branch>...HEAD
   git log --oneline origin/<target-branch>...HEAD
   ```

   产出：
   - 工作树未提交项清单
   - 本分支已有 commit 清单
   - 与 target 的 diff stat

   **特别检查 CLAUDE.md**：若工作树或本分支有 `CLAUDE.md` 的改动，提醒用户「是否要先跑 `/claudemd-commit` 把本轮发现的差异沉淀进去再 ship」。若用户回答否，继续；若是，暂停本命令让用户跑完再回来。⚠ 另外跑一次 `python3 .claude/hooks/claudemd-lint.py`，带 ERROR 的 CLAUDE.md 不该进 PR。

3. **如有未提交改动，先 commit**

   用 **AskUserQuestion** 询问：
   - `合并到上一个 commit（amend）` — 仅当上一个 commit 还没 push 过才允许
   - `新建一个 commit` — 推荐
   - `先不 commit，跳过这些改动` — 工作树留 dirty，仅 ship 已 commit 的
   - `取消` — 退出

   选「新建 commit」时：
   - AI 起一份**中文** commit message 草案（feat/fix/refactor/docs/test/chore/perf/ci 类型 + 中文描述 + 可选正文）
   - 用 AskUserQuestion 让用户 `接受 / 调整文案 / 取消`
   - 应用方式：`git add <仅与本任务相关的文件，不用 -A>` → `git commit -m "$(cat <<'EOF'...EOF)"`（HEREDOC 保格式）
   - **不带 attribution**（按用户全局 settings.json 全局禁用）

4. **预合并冲突检查**（用户全局规则：pr/mr 要先与 target 预合并）

   ```bash
   git fetch origin <target-branch>
   BASE=$(git merge-base HEAD origin/<target-branch>)
   git merge-tree "$BASE" HEAD "origin/<target-branch>" > /tmp/pr-ship-merge-preview.txt
   grep -c "^<<<<<<<" /tmp/pr-ship-merge-preview.txt
   ```

   - **0 冲突** → 进入下一步
   - **>0 冲突** → 报告冲突文件清单，用 AskUserQuestion 让用户选：
     - `本地 rebase 解决` — 跑 `git rebase origin/<target>`，冲突解完后用户告知继续
     - `本地 merge target 进来再解` — 跑 `git merge origin/<target>`
     - `取消，我自己处理` — 退出本命令

5. **Push 当前分支**

   ```bash
   git push -u origin "$(git branch --show-current)"
   ```

   首次 push 时输出会含 `Create a pull request for ...` URL；记录该 URL 用于后续提示。

6. **生成 PR/MR 标题与正文**

   AI 根据 `git log <target>...HEAD` 与 `git diff --stat <target>...HEAD` 自动起草：

   - **标题**（< 70 字符，**中文**，参考 conventional commits）：`<type>: <概要>`，如 `feat: 新增 /xxx 命令并叠加 ...`
   - **正文**（**中文**，固定 3 段）：

     ```markdown
     ## 背景
     <1-3 句：为什么做这次变更，触发的需求/问题/issue>

     ## 设计
     - <设计点 1：做了什么、为什么这么做、关键取舍>
     - <设计点 2>
     - ...

     ## 测试计划
     - [ ] <人工或自动验证项 1>
     - [ ] <验证项 2>
     ```

   用 AskUserQuestion 让用户 `接受 / 调整 / 取消`。

7. **创建 PR/MR**

   - GitHub:
     ```bash
     gh pr create --base <target> --head <branch> \
       --title "<标题>" --body "$(cat <<'EOF'
     <正文>
     EOF
     )"
     ```
   - GitLab:
     ```bash
     glab mr create --target-branch <target> --source-branch <branch> \
       --title "<标题>" --description "$(cat <<'EOF'
     <正文>
     EOF
     )"
     ```

   抓取返回的 PR/MR URL 与编号，记到本次会话变量供后续步骤复用。

8. **呼叫干净的 code-review subagent 评审 diff**

   **8.0 先读 review 水位线**（决定这一轮审多宽）

   若本 PR 对应某个 OpenSpec change（看分支名 / commit message / `openspec/changes/` 下的活跃 change），读它的水位线：

   ```bash
   ls openspec/changes/*/review-log.md 2>/dev/null
   git log --oneline origin/<target>..HEAD    # 本 PR 的全部 commit
   ```

   把 `REVIEWED_UPTO` 与本 PR 的 commit 列表对照，按覆盖情况选评审模式：

   | 水位线状态 | 评审模式 | 审查范围 |
   | --- | --- | --- |
   | 读不到 `review-log.md`（串行 apply / 手工分支 / 非 OpenSpec 变更） | **`full`** | PR ↔ target 完整 diff，全部 checklist 维度——**今日行为，一字不变** |
   | `REVIEWED_UPTO` 覆盖本 PR 的全部**代码** commit | **`integration`** | 仍取完整 diff 看全貌，但只报跨 task / 整体一致性 / 端到端 / 工件一致性四类；已审范围内的单 task 级问题与已 deferred 条目不重报 |
   | `REVIEWED_UPTO` 之后还有代码 commit（守门后手改） | **`integration` + `full` 增量** | `<REVIEWED_UPTO>..HEAD` 按 `full` 全量审；已覆盖部分按 `integration` 审 |

   > 覆盖判定只看**代码 commit**——纯工件 commit（只动 `openspec/`）与勾 checkbox 的 commit 不影响判定。
   > **拿不准就按 `full`**。水位线只能缩小「已被守门覆盖」那部分的范围，**绝不能**让未审代码蒙混过关。

   **8.1 记录本轮评审的 HEAD**

   ```bash
   git rev-parse HEAD    # 记为 REVIEW_HEAD_<轮次>；第 12 步的增量复核要用它圈定修复区间
   ```

   **8.2 派 subagent**

   用 **Agent 工具** 启一个 `subagent_type=code-reviewer` 的 subagent。该 agent 的定义在 `.claude/agents/code-reviewer.md`——它的 system prompt **已包含**完整的分级 rubric（CRITICAL/HIGH/MEDIUM/LOW，含 intent-driven 的 TDD/GWT 纪律检查）、finding 格式（`文件:行号` + 修法）、末尾签名、以及"只读不改码 / 不带主会话上下文"的纪律。**不要在这里重抄一份 rubric**——只传 PR 特有的上下文，rubric/格式/签名交给 agent 自己。

   传给它的 prompt 按 8.0 选定的模式分支给出（PR 特有信息，自包含）：

   **`full` 模式**（无水位线——今日文本，不变）：

   ```
   背景: review GitHub/GitLab 上的 PR/MR #<num>。
   仓库: <origin URL>
   target branch: <target>
   PR/MR URL: <url>

   评审模式: full
   审查范围: 本 PR 相对 target 分支的完整 diff。
   取 diff: `gh pr diff <num>`（GitHub）或 `glab mr diff <num>`（GitLab）。
   diff 为空或拉不到 → 报告"无变更"并停止。

   按你（code-reviewer）既定的分级标准、finding 格式与签名输出完整 markdown，准备直接贴成 PR/MR 评论。
   monorepo 跨多个 sub-repo 时按 sub-repo 分块组织 finding。
   ```

   **`integration` 模式**（水位线覆盖全部代码 commit）：

   ```
   背景: review GitHub/GitLab 上的 PR/MR #<num>。这是整合审——PR 里的代码已在实现阶段被逐 task 守门逐个审过并修过。
   仓库: <origin URL>
   target branch: <target>
   PR/MR URL: <url>

   评审模式: integration
   已审范围: <BASE_REF>..<REVIEWED_UPTO>（<N> 个 task，守门期间已阻断并修复 <X> 项）
   已登记为 deferred 的 finding（**不要重复上报**）：
   <把 review-log.md 的 Deferred 清单原样贴出>

   审查范围: 本 PR 相对 target 分支的完整 diff（看全貌），但只报下面四类。
   取 diff: `gh pr diff <num>`（GitHub）或 `glab mr diff <num>`（GitLab）。
   diff 为空或拉不到 → 报告"无变更"并停止。

   只报: ① 跨 task 交互（A 改的接口/数据结构被 B 误用）② 整体一致性（命名/错误处理/分层风格）
        ③ 端到端完整性（各 task 拼起来是否真满足 proposal 目标、有无遗漏 capability）④ 工件与实现是否一致
   不报: 已审范围内的单 task 级质量问题、已登记为 deferred 的条目。
   例外——你确认某条上游 finding 实际没修好，可以报，但必须标注「上游 review 未闭环」并给依据。

   按你既定的分级标准、finding 格式与签名输出完整 markdown，准备直接贴成 PR/MR 评论。
   monorepo 跨多个 sub-repo 时按 sub-repo 分块组织 finding。
   ```

   **`integration` + `full` 增量 模式**：用上面的 integration prompt，并追加一段——

   ```
   注意: `<REVIEWED_UPTO>..HEAD` 这段 commit **没有**被逐 task 守门审过（守门之后的手工改动）。
   对这段按 full 标准全量审——你的全部 checklist 维度都适用，不受上面「只报四类」的限制。
   取这段 diff: `git diff <REVIEWED_UPTO>..HEAD`（两点）。
   其余已覆盖部分仍按 integration 只报那四类。
   ```

   subagent 返回 markdown 报告（分级 + 签名由 agent system prompt 保证，与逐 task 守门用的是**同一套标准**，不会漂移）。

9. **把 review 提交为 PR/MR 评论**

   评论体 = **审查深度声明** + subagent 返回的完整 markdown + **守门期间 deferred 清单**（若有）+ 签名。

   **审查深度声明**（贴在报告最前面，让人类 reviewer 一眼知道 AI 审到什么程度、哪些没审）：

   ```
   > 审查模式：<full | integration | integration + full 增量>
   > 已由逐 task 守门覆盖：<BASE_REF>..<REVIEWED_UPTO> · <N> 个 task · 阻断并修复 <X> 项
   > 本轮只审：<跨 task 交互 · 整体一致性 · 端到端完整性 · 工件与实现一致性>
   ```

   无水位线（`full` 模式）时这一块写成一行：`> 审查模式：full · 本 PR 无逐 task 守门记录，按完整 diff 全量评审`。

   **守门期间 deferred 清单**（`review-log.md` 的 Deferred 非空时**必贴**，附在报告末尾、签名之前）：

   ```
   ### 逐 task 守门期间 deferred（未阻断，供人类 reviewer 判断）
   - MEDIUM `path:line` — <摘要>
   - LOW `path:line` — <摘要>
   ```

   这些条目在实现阶段被判为不阻断，但**必须让人看见**——否则它们只留在本地报告里，PR 阅读者永远不知道 AI 放过了什么。

   - GitHub: `gh pr comment <num> --body "$(cat <<'EOF' ... EOF)"`
   - GitLab: `glab mr note <num> --message "$(cat <<'EOF' ... EOF)"`

   **确保签名在末尾**：
   ```
   — reviewed by Claude Code (code-reviewer subagent), 2026-05-28
   ```

   提交后输出"已在 PR #<num> 留下 review 评论：<comment URL>"。

10. **与用户讨论修复**

    把 CRITICAL/HIGH/MEDIUM 项列给用户（LOW 默认推迟），用 **AskUserQuestion** 工具按条收集决策：
    - `按 review 建议修` — AI 主导修
    - `按我说的修` — 用户提供具体方向
    - `推迟到下一个 PR / 开 follow-up issue` — 不修
    - `驳回这条 review` — 不接受建议（要求用户写一句驳回理由，回填到 PR 评论）

11. **如果有要修的项，落地补丁到同一 PR/MR**

    - 按"修复意见"动代码
    - 每个独立的修复点新建一个 commit，message 引用 review 编号或 finding：`fix: 按 review #<comment-id> 修 <finding 摘要>`
    - `git push`（PR/MR 自动更新）
    - 在 PR/MR 加一条新评论：
      ```
      ## 按 review 修复的项
      - [x] CRITICAL #1: <摘要> → <commit SHA>
      - [x] HIGH #2: <摘要> → <commit SHA>
      - [ ] MEDIUM #3: 推迟到 follow-up
      - [ ] HIGH #4: 驳回（理由：<用户原话>）
      ```

12. **是否再走一轮 review？**

    用 AskUserQuestion 问用户：
    - `增量复核（推荐）` — 派一个 fresh `code-reviewer` 走 **`follow-up` 模式**：只审第 11 步推上去的修复补丁 + 逐条核对上轮 finding 是否闭环，**不重扫整份 PR**。prompt 见下。
    - `完整重审` — 回到第 8 步重跑模式判定与评审（只在改动面很大、或你怀疑修复引入了系统性问题时才需要）
    - `收尾，等人类 reviewer` — 退出
    - `直接合并`（仅当用户授权且 review 无 CRITICAL） — **不代用户合并**，只输出 `gh pr merge <num>` / `glab mr merge <num>` 命令给用户在终端跑

    **增量复核的 prompt**：

    ```
    背景: 复核 PR/MR #<num> 的修复补丁，判断上一轮 review 挡下的问题是否已闭环。

    评审模式: follow-up
    审查范围（仅这个范围）: `git diff <REVIEW_HEAD_上一轮>..HEAD`——只有第 11 步推上去的修复 commit。
    **不要**重审整份 PR，那部分上一轮已经审过。

    上一轮的 finding 与处置决定（逐条核对）：
    <把上一轮报告的每条 CRITICAL/HIGH/MEDIUM 连同第 10 步的处置（修 / 推迟 / 驳回）一起贴出>

    你的任务只有两条：
    1. 逐条判定「已闭环 / 未闭环 / 修得不对（引入新问题）」，各给一句依据。
       标为「推迟」「驳回」的条目跳过判定，只确认它们确实没被动过。
    2. 判断这些修复 commit 本身有没有新引入的 CRITICAL/HIGH。

    按你既定的分级标准与格式输出，结论行明确"通过 / 阻断"，末尾签名。不要修代码。
    ```

    复核报告同样按第 9 步贴成 PR/MR 评论（深度声明里写 `follow-up` 与本轮 diff 区间），然后回到第 10 步。

**Output Summary（命令收尾时打印）**

```
## /pr-ship 完成

**PR/MR**: <URL>
**target**: <target-branch>
**commit 数**: N
**review 轮数**: M
**已修复**: X 条
**推迟**: Y 条
**驳回**: Z 条

下一步:
  - 等 human reviewer / CI
  - 或: gh pr merge <num> --squash --delete-branch
```

**Guardrails**

- **不代用户鉴权**：`gh auth login` / `glab auth login` 是交互式命令，必须用户自己在终端跑
- **不代用户合并**：第 12 步即便用户选"直接合并"，AI 也只输出命令给用户，不自动跑 merge（用户全局规则：destructive / 影响共享状态的动作必须用户确认）
- **不绕过预合并冲突检查**：第 4 步发现冲突就停，让用户决定 rebase / merge / 放弃
- **commit 不用 -A**：`git add` 只加与本任务相关的文件，避免误提交 .env / 临时文件
- **commit 不带 attribution**：按用户 settings.json 全局禁用
- **subagent 必须干净**：不要给它主会话的对话历史 / 设计意图 / TodoList——它只看 diff 给意见，避免被主会话的"我已经想好了"立场污染
- **无 `review-log.md` → 全量审**：读不到水位线时第 8 步一律走 `full`，行为与引入水位线之前完全一致；水位线只能缩小「已被守门覆盖」那部分的范围，绝不能让未审代码蒙混过关
- **复审默认只审增量**：第 12 步默认 `follow-up`（只看修复补丁 + 核对闭环），「完整重审」是用户显式选项而非默认——同一份代码不该因为改了一条 MEDIUM 就被整份重扫
- **subagent 不修代码**：只产出 review markdown；修代码是主会话第 11 步的活
- **review 评论签名必带**：让 PR 阅读者知道这条评论来自 AI，而不是误以为是人类 reviewer
- **monorepo 友好**：若 PR/MR 跨多个 sub-repo，subagent prompt 里要说明"按 sub-repo 分块 review"

**与已有命令的配合**

| 上游 | 本命令 (`/pr-ship`) | 下游 |
| --- | --- | --- |
| `/opsx-apply` 写完代码 | ship: commit → PR → self-review → 迭代 | 人类 reviewer 看 / 合并 |
| `/claudemd-commit` 沉淀完知识 | ship: 把 CLAUDE.md 改动也带进同一个 PR | 累积多轮后 `/claudemd-distill` |

典型使用顺序：
1. `/opsx-apply <change>` → 写代码 + 测试
2. `/claudemd-commit` → 把本轮变更里新的约定 / 反模式沉淀到记忆层（预算中性；偏差进 backlog 不进 CLAUDE.md）
3. `/pr-ship` → ship + 自审 + 迭代到 review 通过
4. 人类 reviewer 看 / 合并到 main
5. （合并几轮后）`/claudemd-distill` → 收敛 CLAUDE.md
