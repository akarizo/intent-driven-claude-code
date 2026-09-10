---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change using flight mode — 批准后从门禁 lint 一路跑到 PR，中途不问，模型按角色显式路由。Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.1"
---

飞行模式跑完一次 apply：选 change → git 纪律检查 → 切片规划 lint → 记录并提交批准事件 → 启动切片工作流（模型按角色显式路由；不可用则回退并行 Agent 派发）→ 收工作流 JSON → 收口分解（打印各角色实际模型）→ 直接进入 `/pr-ship`。除四种暂停例外，全程不问询。

**REQUIRED SUB-SKILL：** 用 `openspec-git-discipline`（含 **Worktree Isolation**）—— apply 必须在本 change 的 `.worktrees/<name>/` worktree 内进行，实现代码落在那里。

**Input**：可选指定 change 名。留空则从会话上下文推断，仍歧义才列候选。`--gate=per-task` → 转读 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md` 并按它逐 task 守门执行；本 skill 其余步骤不适用于该分支。

**模型路由（铁律：按角色显式声明，不得留空让 `CLAUDE_CODE_SUBAGENT_MODEL` 默认兜底）**

| 角色 | 模型 | effort |
|---|---|---|
| slice-executor（实现 / 批量修复） | 当前会话主模型别名（`fable` / `opus` / `sonnet`） | high |
| code-reviewer（切片评审 / 复核） | 当前会话主模型别名 | high |
| integrator（合回 / 抽接口 / final） | `sonnet` | low |

**Steps**

1. **选 change**
   - 有参数用参数；否则从会话上下文推断；只有一个活跃 change 自动选；歧义 → `openspec list --json` + **AskUserQuestion** 让用户选。
   - 宣告：`Using change: <name>`。

1.5 **确认已在本 change 的 worktree 内**（见 `openspec-git-discipline` 的 Worktree Isolation）
   CWD 必须是 `.worktrees/<name>/`；不在则进入已存在的 worktree；worktree 缺失 → 停下报告，不在主仓库工作区写实现代码。
   `git status --short` 确认工件已单独 commit、工作树干净；不满足 → 停下报告。

2. **切片规划 lint**
   ```bash
   python3 .claude/hooks/slice-gate.py lint --change-dir openspec/changes/<name>
   ```
   拿到 stdout 的 waves JSON。exit 非 0（规划红）→ 停下报告规划问题，不进入实现。

3. **记录批准事件并提交飞行记录**
   ```bash
   python3 .claude/hooks/timeline.py record approve --change-dir openspec/changes/<name>
   git add openspec/changes/<name>/timeline.md && git commit -m "chore(flight): approve"
   ```
   飞行记录文件由 hook 自动追加，起飞前必须已提交，否则 integrator 合回并行切片时会被 `git merge` 拒绝。写 `openspec/changes/<name>/.flight`（含启动时间）。

4. **启动切片工作流**
   - 先确定当前会话模型别名 `<main>`（`/model` 显示的）。
   - 优先用 **Workflow** 工具：`name: "opsx-apply"`，`args: {change, changeDir, hooksDir: ".claude/hooks", agentsDir: ".claude/agents", waves, useAgentTypes: true, expectHead: "<git rev-parse --short=10 HEAD>", models: {executor: "<main>", reviewer: "<main>", integrator: "sonnet"}, efforts: {executor: "high", reviewer: "high", integrator: "low"}}`。`models` 缺任一角色脚本会拒绝起飞。
   - 同时传 `deps: <slices.json 里每片的 deps 映射>`，依赖已 blocked 的切片脚本不再派发。
   - Workflow 不可用（工具缺失 / `disableWorkflows`）→ **回退**，语义与脚本逐项一致：按 waves 逐 wave 用 **Agent** 工具在同一条消息里并行派发 `subagent_type: slice-executor`、`model: "<main>"`、`effort: high`（多切片 wave 各自 `isolation: worktree`；prompt 首行带 `expectHead` 第零步基分支校验），回报只收其原样 JSON；门禁红则以其 `failed` 重派同一切片一次，仍红记 blocked，依赖它的切片直接记 blocked；wave 后派 `integrator`（`model: "sonnet"`、`effort: low`）先提交飞行记录、合回、逐片 `slice-gate.py record` 写回门禁结论；评审用 `code-reviewer`（`model: "<main>"`、`effort: high`）并行派发（`run_in_background` 语义：不等）；最后一次批量修复与 final。
   - 两条路径最终都产出同一份 JSON：`{change, models, efforts, slices, blocked, blocking, deferred, fix, final}`。

5. **收口分解**
   ```bash
   python3 .claude/hooks/timeline.py record apply-done --change-dir openspec/changes/<name>
   python3 .claude/hooks/session-decompose.py --session <当前会话 jsonl，取 ~/.claude/projects/<slug>/ 下最新> --workflow <Workflow 返回的 Transcript dir>
   python3 .claude/hooks/timeline.py report --change-dir openspec/changes/<name>
   ```
   打印飞行记录（含各 agent 实际模型，与路由表对账；对不上即铁律违规）；把 `{blocked, blocking, deferred, fix}` 原样写入 `openspec/changes/<name>/review-findings.json`（`blocked` 带 `kind: gate | infra`）；删除 `.flight`；跑 `python3 .claude/hooks/slice-gate.py ship --change-dir openspec/changes/<name>`（只读 gate-report.md 每切片最新行 + final 对齐 HEAD + blocking；退出 0 ready / 1 draft；`final 过期` → 重跑 final 再 ship）；把门禁绿的切片在 `tasks.md` 里勾选；飞行记录文件单独 `chore(flight)` commit。

6. **不问，直接进入 `/pr-ship`**
   无论 `ship` 结果如何都调用；`/pr-ship` 自己再跑 `ship` 决定 draft / ready 并把 `ship --markdown` 段落贴进正文。主会话不自判 draft。

**暂停例外（仅这四种）**：spec 自相矛盾 · 需要破坏性操作 · 测试环境本身坏 · 同一门禁项连续 2 次红。

**Guardrails**
- 启动到 `/pr-ship` 之间不出现 AskUserQuestion。
- 模型按角色显式路由；派发时不得省略 `model`；收口报告必须打印各角色实际模型。
- `--gate=per-task` 转 legacy skill，不与本流程混用。
- 不自动 merge / push / 删 worktree。

**Fluid Workflow Integration**

- 可随时调用；不锁相位（Before all artifacts are done、部分实现之后都能跑）。
- 实现中若发现设计问题，允许建议更新工件，不是硬性阻断。
