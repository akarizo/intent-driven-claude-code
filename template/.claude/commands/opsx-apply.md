---
description: Implement tasks from an OpenSpec change (Experimental)
---

Implement tasks from an OpenSpec change.

**Input**: Optionally specify a change name (e.g., `/opsx-apply add-auth`). Append `--no-confirm` to skip the step 6 confirmation gate and go straight to the serial implementation path (used by `/opsx-bulk-apply` subagents; subagents cannot nest, so the per-task gatekeeper path is never taken under `--no-confirm`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**两种执行模式**：step 6 让用户在「**subagent 逐 task 守门**」（推荐中级+；转调 `openspec-subagent-apply-change` skill，每个 task 实现完即派 `code-reviewer` 守门）与「**串行（轻量）**」（主会话逐 task 串行写，即 step 7）之间选择。

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx-apply <other>`).

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using `/opsx-continue`
   - If `state: "all_done"`: congratulate, suggest archive
   - Otherwise: proceed to implementation

4. **Read context files**

   Read every file path listed under `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

5. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

6. **MANDATORY: confirm with user before implementation**

   Before touching any code, you MUST stop and ask the user.

   **Skip this step entirely when EITHER** condition holds:
   - The invocation includes the `--no-confirm` flag, OR
   - You were dispatched as a delegated subagent from a bulk-apply parent (e.g., `/opsx-bulk-apply`), which already collected one batch-level confirmation.

   Otherwise:

   Show a short preview:
   - Change name and schema
   - Progress: "N/M tasks complete, K remaining"
   - First 3 pending task titles (titles only, no implementation detail)
   - High-level scope: which capabilities or files will be touched (one line)

   Then call the **AskUserQuestion tool** with:
   - question: `确认开始 apply <name> 吗？选择执行模式：`
   - header: `开始 apply`
   - options:
     - `subagent 逐 task 守门（推荐 · 中级+）` — 转调 `openspec-subagent-apply-change` skill：每个 task 派 fresh subagent 实现（强制 TDD）并**在当前分支产生一个本地 commit**（不 push / 不 merge），完成即派 `code-reviewer` 守门（CRITICAL/HIGH 阻断），过了才勾 checkbox。守门结论写入 `review-log.md`（review 水位线），供后续 `/pr-ship` 与 `/opsx-verify` 判断已审范围、不再重复全量审；整合审位置在收口时由你选（本地 / 交给 `/pr-ship`）。**不进入下面的 step 7 串行循环。**（选此项即视为同意逐 task 本地 commit——见 `openspec-git-discipline` carve-out。）
     - `串行（轻量）` — proceed to step 7（主会话逐 task 串行写，今日行为）
     - `先看完整 tasks` — print the full task list, then re-ask this question
     - `取消` — stop immediately, do not change any file

   Guardrails:
   - Do NOT enter any implementation path without an explicit confirmation answer.
   - 选 `subagent 逐 task 守门` → 立即转用 `openspec-subagent-apply-change` skill 承载后续全部流程，不再走本命令 step 7。
   - 选 `串行（轻量）` → 走 step 7。
   - If the user picks `取消`, exit and report no changes were made.
   - **`--no-confirm` 一律走串行（step 7）**：bulk-apply 派发的子 agent 用此 flag，且 subagent 不能再嵌套 subagent，所以子 agent 内不触发逐 task 守门路径。

7. **Implement tasks — 串行模式 (loop until done or blocked)**

   > 仅当用户选了"串行（轻量）"或传了 `--no-confirm` 时执行本步。选了"subagent 逐 task 守门"则跳过本步，全部交给 `openspec-subagent-apply-change`。

   For each pending task:
   - Show which task is being worked on
   - Make the code changes required
   - Keep changes minimal and focused
   - Mark task complete in the tasks file: `- [ ]` → `- [x]`
   - Continue to next task

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

8. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! You can archive this change with `/opsx-archive`.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Always pause for explicit user confirmation in step 6 before any code change (except delegated bulk-apply subagent runs)
- step 6 选「subagent 逐 task 守门」→ 转 `openspec-subagent-apply-change`（逐 task 实现 + 守门 + 写 review 水位线）；选「串行」或 `--no-confirm` → step 7
- 串行模式**不产生** `review-log.md`：后续 `/pr-ship` 与 `/opsx-verify` 读不到水位线时按全量审处理，行为与既有一致
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
