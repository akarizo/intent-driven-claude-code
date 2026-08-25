---
name: openspec-subagent-apply-change
description: 用 subagent 逐 task 实现一个 OpenSpec change，每个 task 完成即派 code-reviewer 守门（CRITICAL/HIGH 阻断），过了才勾 checkbox。中级+ 变更的推荐 apply 模式。当用户在 /opsx-apply 选择"subagent 逐 task 守门"时使用。
license: MIT
compatibility: Requires git, OpenSpec CLI, and Claude Code subagents (Agent tool).
metadata:
  author: intent-driven-claude-code
  version: "1.0"
---

# OpenSpec Subagent Apply（逐 task 守门）

用 fresh subagent 逐个 task 实现一个 OpenSpec change：**每个 task 由一个干净的实现 subagent 走完整 TDD 写出来，紧接着由一个干净的 `code-reviewer` subagent 守门**，CRITICAL/HIGH 级问题不修复不许勾选 checkbox。全部 task 完成后做一次整体 full review + `/opsx-verify`，最后收口报告，**不 merge 不 archive**。

这是"tdd → subagent 开发 → subagent-review，每个功能有守门员"的落地。

**REQUIRED SUB-SKILL：** 任何 apply / 实现动作前先用 `openspec-git-discipline`。
**实现纪律：** 每个实现 subagent 必须走 `test-driven-development` skill（RED→验红→GREEN→验绿→REFACTOR + GWT 三段中文注释）。

## 何时使用

- 用户在 `/opsx-apply` 的确认问询里选了"**subagent 逐 task 守门**"。
- 中级+ 变更（新 capability / 改公共契约 / 跨模块 / 引入新抽象 / 架构决策），希望每个 task 都有独立守门员。

**何时不要用：**
- `--no-confirm` 调用（来自 `/opsx-bulk-apply` 的子 agent）→ 走串行 `openspec-apply-change`。**subagent 不能嵌套**，子 agent 内不能再派逐 task subagent。
- 纯文档 / 纯配置 / 一次性 prototype 的 mini 任务 → 串行或直接改。

## 与其他 apply 路径的边界

| Skill | 粒度 | 隔离 | 守门 |
| --- | --- | --- | --- |
| `openspec-apply-change`（串行） | 单 change，主会话逐 task 串行写 | 本 change 的 worktree | 无（靠 /pr-ship 末尾） |
| **本 skill** | 单 change，**逐 task 派 subagent** | 本 change 的 worktree（不为每 task 各开） | **每 task 一个守门员** + 末尾 full review |
| `openspec-bulk-apply-change` | **多 change**，各派 subagent 跑整个 apply | 每 change 一个 worktree | 各自 apply 内的纪律 |

**worktree 粒度 = 每 change 一间，不是每 task 一间**：本 change 从 propose 起就在自己的 `.worktrees/<name>/` worktree 内（见 `openspec-git-discipline` 的 Worktree Isolation），apply 也在**这一间**里进行。逐 task 是**串行累积**（task2 依赖 task1 的产出），所有 task 必须在**同一间** worktree 里累积 —— 因此**不要为每个 task 各开 worktree、也不要在本 change worktree 内再嵌套子 worktree**。Claude Code 原生 `isolation: worktree` 每次派发都新建独立 worktree、看不到前序 task 产出，正是这里要避免的。在本 change worktree 内累积还让分级门禁（`intent-gate.py`，相对路径判断）零改动生效。

## Steps

### 1. 选 change 并跑 git discipline

- 确定 change 名（命令给了就用；否则从上下文推断 / 唯一 active 自动选 / 歧义则 `openspec list --json` + AskUserQuestion）。宣布："Using change: <name>"。
- 用 `openspec-git-discipline`：① 确认 CWD 已在本 change 的 `.worktrees/<name>/` worktree 内（见 Worktree Isolation）——不在则进入已存在的 worktree，缺失则停下报告；② 确认 proposal 工件已在一个单独 commit（只含工件、无实现代码，无需先合 `main`）；③ `git status --short` 看工作树状态。未满足则停下报告，不强行开工。

### 2. 取 apply 上下文

```bash
openspec status --change "<name>" --json
openspec instructions apply --change "<name>" --json
```

- 解析 `schemaName`、`contextFiles`、进度、task 列表。
- **Read 所有 `contextFiles`**（proposal / specs / design / adr / tasks，按 schema）。
- 读 `tasks.md`，列出所有未勾选 `- [ ]` task。
- 状态处理：`blocked`（缺工件）→ 提示 `/opsx-continue`；`all_done` → 提示 archive，结束。

### 3. 记录起点 + 确认工作区干净（commit 锚点是逐 task 圈 diff 的基础）

```bash
git rev-parse HEAD          # 记为 BASE_REF（apply 开始前的 HEAD）
git status --short          # 工作区必须干净
```

**关键机制：每个 task 由实现 subagent 产生一个本地 commit**（见 4a），这样：

- 每个 task 的"净 diff" = `git diff HEAD~1` 或 `git diff <task前一个commit>..HEAD`（精确、无歧义）；
- 整个 change 的累计 diff = `git diff <BASE_REF>..HEAD`（两点，比 BASE_REF 与当前 HEAD 之间的全部 commit）。

**前置硬要求**：开工前 `git status --short` 必须**干净**（无未提交改动）。若工作区脏，停下让用户先 commit / stash——否则首个 task 的 commit 会把无关改动一起裹进去，污染该 task 的净 diff。

> 这些是**本地实现 commit**，落在当前 feature 分支 / worktree，绝不 push / merge / archive；用户已在 `/opsx-apply` step 6 选「subagent 逐 task 守门」时知情同意（见 `openspec-git-discipline` 的 carve-out）。

### 4. 逐 task 循环（核心）

对每个未勾选的 task，按顺序依次执行（**串行，不并行**——后一个 task 依赖前一个的产出）：

#### 4a. 派 fresh 实现 subagent

用 **Agent 工具**（`subagent_type: general-purpose`——它有 Write/Edit/Bash，能写代码、跑测试、commit；**不要**用只读的 `code-reviewer`）派发。

派发前主会话先准备好要塞进 prompt 的**运行上下文**（subagent 是 cold 的，这些它无从自知）：repo 根绝对路径、本 change 目录路径、相关源文件位置（从 contextFiles / 既有代码定位）、项目测试命令（探测：有 `package.json` 看 `scripts.test`、有 `pytest.ini`/`pyproject.toml` 用 `pytest`、有 `go.mod` 用 `go test`，等等）。

prompt 必须**自包含**（subagent 不带主会话上下文）：

```
背景：你在为 OpenSpec change `<name>` 实现单个 task。在本 change 的 worktree 内直接操作（主会话已进入它；不要再新建/嵌套 worktree、不要切分支、不要 push）。

运行环境（已为你查好）：
- repo 根：<绝对路径>
- 本 change 目录：<绝对路径>/openspec/changes/<name>/
- 与本 task 相关的源文件：<路径清单；新建文件给目标路径>
- 跑测试的命令：<如 `pytest tests/`、`npm test`、`go test ./...`>
- 你有 Write / Edit / Bash 权限，可直接改文件、跑测试、git commit。

本 task：<task 编号 + 完整描述>

相关规格（节选自 contextFiles）：
<贴出与本 task 相关的 spec scenario / design 决策 / adr 约束片段——尽量完整，reviewer 之后会按这些 spec 核对你的实现>

强制要求：
1. 必须走 test-driven-development skill：先写失败测试 → 用上面的测试命令亲眼验证它失败（RED）→ 写最小实现让它通过（GREEN）→ 再跑验证通过 → REFACTOR。报告里要贴 RED 和 GREEN 两次测试运行的关键输出，证明你确实先红后绿。
2. 每个单测函数体首行是 `// Given:`（Python 用 `#`）三段中文注释，When 只触发一个被测动作，Then 注释与断言一一对应。详见 .claude/skills/test-driven-development/SKILL.md 与 testing-anti-patterns.md。
3. 只做这一个 task，不要顺手改无关代码、不要引入未要求的抽象。
4. 保持最小改动，清理自己造的 orphan（未引用的 import / 变量）。
5. **完成后，把本 task 的全部改动作为一个本地 commit 提交**（只 add 与本 task 相关的文件，不用 `git add -A`）：
   `git add <本 task 相关文件>` → `git commit -m "<type>(<scope>): <task 编号 简述>"`
   不要 push、不要 merge、不要碰别的分支。

完成后报告：本 task commit 的 SHA、改了哪些文件（路径）、新增/修改了哪些测试、RED→GREEN 的测试输出摘要、有没有遗留问题。
```

> 主会话在派发前记下 `git rev-parse HEAD`（本 task 起点 = 上一个 commit），用于 4b 圈定 diff。

#### 4b. 派 code-reviewer subagent 守门

实现 subagent 返回后（它已 commit 本 task），用 **Agent 工具**（`subagent_type: code-reviewer`）派发。**本 task 净 diff 就是那个 commit**——用两点 diff 精确圈定，不再有歧义：

```
背景：review 一个 OpenSpec change 里单个 task 的实现。这是 intent-driven 工作流的逐 task 守门。

审查范围（仅这个范围）：本 task 的净 diff = 实现 subagent 刚产生的那个 commit。
取 diff：`git diff <本 task 起点 SHA>..HEAD`（两点；<本 task 起点 SHA> = 派实现 subagent 前主会话记下的 HEAD）。
  等价写法：`git show <本 task commit SHA>`。
  注意用两点 `..` 不是三点 `...`——逐 task 是线性累积，两点比的是"起点到 HEAD 的实际改动"。
本 task 要求（请逐条核对实现是否满足）：<task 描述 + 相关 spec scenario 全文>
RED→GREEN 证据：<实现 subagent 报告里的测试输出摘要——据此判断是否真先写了失败测试>

阻断阈值：CRITICAL 与 HIGH 都阻断。测试缺失 / TDD 纪律被破坏（含拿不出 RED 证据、GWT 注释缺失）按 HIGH 起评。
除通用代码质量外，**务必核对 spec compliance**：实现有没有覆盖上面每条 spec scenario、有没有偏离 spec 约束。
按你的分级格式输出报告，结论行明确"通过 / 阻断"，末尾签名。
不要修代码。
```

#### 4c. 阻断判定与回灌

- reviewer 报告**有 CRITICAL 或 HIGH** → **不勾 checkbox**。派一个 fresh 修复 subagent（`subagent_type: general-purpose`）。它也是 cold 的，prompt 必须把"修什么、在哪、问题是什么"讲全：

  ```
  背景：修复一个 OpenSpec change 里某 task 实现被 code-reviewer 挡下的问题。在本 change 的 worktree 内直接操作（主会话已进入它），不要 push / 切分支 / 新建 worktree。

  运行环境：<同 4a：repo 根 / change 目录 / 相关源文件 / 测试命令 / 有 Write·Edit·Bash 权限>
  本 task：<task 编号 + 描述>
  本 task 已有的实现 commit：<SHA>，改动文件：<清单>（用 `git show <SHA>` 查看现状）

  reviewer 挡下的问题（逐条修）：
  <把 reviewer 报告里每条 CRITICAL/HIGH 原样贴出：文件:行号 + 问题 + 修法建议>

  强制要求：
  1. 只修上面列出的问题，不要顺手改别的。
  2. 修复也走 TDD：每个被挡的 bug，先写一个能复现它的失败测试（亲眼验证它红）→ 再改实现让它绿。不允许直接改实现不补测试。
  3. 修完把改动追加为提交：`git commit --amend --no-edit`（并入本 task 的 commit，保持"一 task 一 commit"），或新增一个 `fix: ...` commit——二选一，但不要 push。

  完成后报告：改了什么、新增哪些复现测试、RED→GREEN 输出、最终 commit SHA。
  ```

  修完回到 4b 复审（diff 范围用更新后的 commit 区间）→ **循环直到无 CRITICAL/HIGH**。
- MEDIUM / LOW → 记录进收口报告，**不阻断**（除非用户另行要求）。
- **回灌硬上限：3 轮**。第 3 轮复审仍有 CRITICAL/HIGH → **停下，不再自动回灌、不勾 checkbox、不向用户问"要不要继续修"**。把现状（剩余阻断项 + 已试 3 轮）报告给用户，由用户决定（往往意味着 task 描述/spec/设计本身有问题，需回 `/opsx-continue` 改工件，而非继续蛮修）。绝不蒙混勾选。

#### 4d. 勾选 checkbox

仅在本 task 守门通过（无 CRITICAL/HIGH）后，**由主会话**（不是 subagent）把 `tasks.md` 里该 task 的 `- [ ]` 改成 `- [x]`（`tasks.md` 在 `openspec/`，门禁豁免，主会话 Edit 直接放行）。然后进入下一个 task。

> 勾选这个动作本身的改动会落进**下一个** task 的 commit 里（或由用户在 pr-ship 前单独 commit），无所谓——它不影响逐 task 净 diff 的圈定（diff 比的是实现 subagent 的代码 commit）。
> 输出建议：每个 task 实时显示 `Working on task N/M: <desc>` → `实现 subagent 返回（commit <SHA>）` → `守门：<通过 / 阻断 X 项，回灌第 K 轮>` → `✓ task complete`。

### 5. Full review（全部 task 完成后）

派一个 `code-reviewer` subagent 审**整个 change 的累计 diff**（`git diff <BASE_REF>..HEAD`，**两点**——比 apply 开始到现在的全部 commit）。

full review 的职责是**逐 task 审不到的东西**，prompt 里要点明重点找：**跨 task 的交互问题**（task A 改的接口被 task B 误用）、**整体一致性**（命名/错误处理/分层风格跨 task 是否统一）、**端到端完整性**（各 task 拼起来是否真满足 change proposal 的整体目标、有无遗漏的 capability）。不要重复逐 task 已做的单 task 质量检查。

> **跳过条件**：① change 只有 **1 个 task**——逐 task 已审过它的全部 diff，full review 会重复审同一份,直接跳过；② 用户计划立即 `/pr-ship`——可把整体审交给 pr-ship 的 PR 评审,跳过本步避免过近重复。其余情况默认执行。

### 6. Verify

跑 `/opsx-verify <name>`（复用 `openspec-verify-change`）做三维一致性 + TDD/BDD 纪律检查。有 blocking 问题 → 回到对应 task 修 → 重跑，直到无 blocking。

### 7. 收口（不 merge 不 archive）

报告：

- change 名 + schema
- 每个 task：commit SHA、守门轮数、阻挡过的 CRITICAL/HIGH（摘要）、最终状态
- full review 结论
- `/opsx-verify` 结论
- 改动文件汇总 + 本次产生的 commit 列表（`git log <BASE_REF>..HEAD --oneline`）
- 遗留的 MEDIUM/LOW（供后续处理）

结尾固定提示：

> 本次做了实现 + 逐 task 守门 + 验证，产生了 N 个本地 commit（在当前分支，**未 push、未 merge、未 archive**）。下一步：`/claudemd-commit`（预算中性沉淀知识）→ `/pr-ship`（送出 + 合并前守门；逐 task commit 可在 PR 时选 squash 合并）。合回 main 后再 `/opsx-archive <name>`。

## Guardrails

- 始终先 `openspec-git-discipline`：确认已在本 change 的 worktree 内、proposal 工件已单独成 commit，否则不开工。
- **worktree 每 change 一间**：在本 change 的 `.worktrees/<name>/` worktree 内逐 task 累积；不为每个 task 各开、不嵌套子 worktree。
- 每个 task **先实现 subagent、再 reviewer subagent**，CRITICAL/HIGH 不修不勾 checkbox。
- 实现 subagent **必须**走 TDD（RED→GREEN→REFACTOR + GWT 中文注释）；reviewer 把"测试缺失 / TDD 被破坏"按 HIGH 阻断。
- reviewer 是**干净、只读**的（prompt 自包含、不带主会话上下文、只 review 不改码）。
- task 之间**串行**（依赖累积），不要并行派发。
- **每个 task 一个本地 commit**（实现 subagent 产生，落当前分支）——这是逐 task 圈 diff 的锚点，且已被 `openspec-git-discipline` 的 carve-out 允许（用户在 step 6 已知情同意）。
- **不 push、不 merge、不 archive、不碰 main、不擅自建分支**——除非用户明确指示。逐 task 本地 commit ≠ 上述任一项。
- 回灌**硬上限 3 轮**；到顶仍阻断就停下交用户，不再问"要不要继续"、不蒙混勾选。
- 子 agent 不能再嵌套 subagent；`--no-confirm`（bulk-apply）一律走串行 `openspec-apply-change`。

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| 给每个 task 开独立 worktree | 逐 task 是串行累积，全在本 change 的**同一间** worktree 里；每 change 一间、不是每 task 一间 |
| 实现 subagent 跳过 TDD | prompt 强制走 test-driven-development；reviewer 按 HIGH 阻断缺测试 |
| reviewer 带了主会话上下文 | prompt 自包含、不传对话历史，保独立性 |
| CRITICAL 没修就勾 checkbox | 阻断阈值 = CRITICAL + HIGH，回灌修复过才勾 |
| 并行派多个 task subagent | 后一个 task 依赖前一个产出，必须串行 |
| apply 完顺手 archive | 本 skill 只到 verify，archive 要先合 main、由用户触发 |
| bulk-apply 子 agent 里再调本 skill | subagent 不能嵌套；子 agent 走串行 |
| 取 diff 用三点 `A...HEAD` | 逐 task 线性累积用**两点** `A..HEAD`；三点比的是 merge-base 之后，分支场景会取错 |
| 工作区脏就开工 | 首个 task commit 会裹进无关改动；step 3 先 `git status --short` 验干净 |
| 实现 subagent 不 commit / 主会话替它 commit | 由实现 subagent 自己在 task 末尾 commit（它最清楚改了什么）；主会话只记起点 SHA |
| 实现 subagent 用了只读的 code-reviewer 类型 | 实现要 Write/Edit/Bash，用 `general-purpose`；`code-reviewer` 只给守门 |
