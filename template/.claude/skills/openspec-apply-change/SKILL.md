---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change using flight mode — 批准后从门禁 lint 一路跑到 PR，中途不问。Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.1"
---

飞行模式跑完一次 apply：选 change → git 纪律检查 → 切片规划 lint → 记录批准事件 → 启动切片工作流（不可用则回退并行 Agent 派发）→ 收工作流 JSON → 收口分解 → 直接进入 `/pr-ship`。除四种暂停例外，全程不问询。

**REQUIRED SUB-SKILL：** 用 `openspec-git-discipline`（含 **Worktree Isolation**）—— apply 必须在本 change 的 `.worktrees/<name>/` worktree 内进行，实现代码落在那里。

**Input**：可选指定 change 名。留空则从会话上下文推断，仍歧义才列候选。`--gate=per-task` → 转读 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md` 并按它逐 task 守门执行；本 skill 其余步骤不适用于该分支。

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

3. **记录批准事件 · 开飞行标记**
   ```bash
   python3 .claude/hooks/timeline.py record approve --change-dir openspec/changes/<name>
   ```
   写 `openspec/changes/<name>/.flight`（含启动时间）。

4. **启动切片工作流**
   - 优先用 **Workflow** 工具：`name: "opsx-apply"`，`args: {change, changeDir, hooksDir: ".claude/hooks", waves, useAgentTypes: true}`。
   - Workflow 不可用（工具缺失 / `disableWorkflows`）→ **回退**：按 waves 逐 wave 用 **Agent** 工具在同一条消息里并行派发 `subagent_type: slice-executor`（多切片 wave 各自 `isolation: worktree`），回报只收其原样 JSON；wave 后派 `integrator` 合回；评审用 `code-reviewer` 并行派发（`run_in_background` 语义：不等）；最后一次批量修复与 final。

5. **收口分解**
   ```bash
   python3 .claude/hooks/timeline.py record apply-done --change-dir openspec/changes/<name>
   python3 .claude/hooks/session-decompose.py --session <当前会话 jsonl，取 ~/.claude/projects/<slug>/ 下最新>
   ```
   打印飞行记录；删除 `.flight`；把门禁绿的切片在 `tasks.md` 里勾选。

6. **不问，直接进入 `/pr-ship`**
   final 未绿或有 blocked 切片 → `/pr-ship` 以 draft 建 PR 并列出未过门禁项；否则正常建 PR。

**暂停例外（仅这四种）**：spec 自相矛盾 · 需要破坏性操作 · 测试环境本身坏 · 同一门禁项连续 2 次红。

**Guardrails**
- 启动到 `/pr-ship` 之间不出现 AskUserQuestion。
- `--gate=per-task` 转 legacy skill，不与本流程混用。
- 不自动 merge / push / 删 worktree。

**Fluid Workflow Integration**

- 可随时调用；不锁相位（Before all artifacts are done、部分实现之后都能跑）。
- 实现中若发现设计问题，允许建议更新工件，不是硬性阻断。
