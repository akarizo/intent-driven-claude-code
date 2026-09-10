---
description: 飞行模式 apply：批准后从门禁 lint 直跑到 PR，中途不问；模型按角色显式路由
---

飞行模式跑完一次 apply：选 change → git 纪律检查 → 切片规划 lint → 记录并提交批准事件 → 启动切片工作流（模型按角色显式路由；不可用则回退并行 Agent 派发）→ 收工作流 JSON → 收口分解（打印各角色实际模型）→ 直接进入 `/pr-ship`。除四种暂停例外，全程不问询。

**Input**：可选指定 change 名（如 `/opsx-apply add-auth`）。留空则从会话上下文推断，仍歧义才列候选。`--gate=per-task` → 跳过飞行模式，转读 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md` 并按它逐 task 守门执行（legacy 路径，本命令 step 3–7 不适用）。

**模型路由（铁律：按角色显式声明，不得留空让 `CLAUDE_CODE_SUBAGENT_MODEL` 默认兜底）**

| 角色 | 模型 | effort | 依据 |
|---|---|---|---|
| slice-executor（实现 / 批量修复） | 当前会话主模型别名（`fable` / `opus` / `sonnet`，看 `/model`） | high | 必须一次做对；实测 Sonnet 执行体的 fix 子 agent 数 ≥ impl 数 |
| code-reviewer（切片评审 / 复核） | 当前会话主模型别名 | high | 门禁判完机械项后剩下的全是难判断；离关键路径 |
| integrator（合回 / 抽接口 / final） | `sonnet` | low | 纯机械，指令明确 |

**Steps**

1. **选 change**
   - 有参数用参数；否则从会话上下文推断；只有一个活跃 change 自动选；歧义 → `openspec list --json` + **AskUserQuestion** 让用户选。
   - 宣告：`Using change: <name>`，以及如何覆盖（`/opsx-apply <other>`）。

2. **git 纪律检查**（`openspec-git-discipline` skill）
   - CWD 必须在本 change 的 `.worktrees/<name>/`；不在则进入（该 worktree 缺失 → 停下报告，不在主仓库工作区写实现代码）。
   - `git status --short` 确认工件已单独 commit、工作树干净；不满足 → 停下报告，不进入下一步。

3. **切片规划 lint**
   ```bash
   python3 .claude/hooks/slice-gate.py lint --change-dir openspec/changes/<name>
   ```
   拿到 stdout 的 waves JSON。**exit 非 0（规划红）→ 停下把 stderr 点名的规则原样报告，不进入实现**。

4. **记录批准事件并提交飞行记录**
   ```bash
   python3 .claude/hooks/timeline.py record approve --change-dir openspec/changes/<name>
   git add openspec/changes/<name>/timeline.md && git commit -m "chore(flight): approve"
   ```
   飞行记录文件（timeline.md / gate-report.md / evidence.log）由 hook 自动追加，**起飞前必须已提交**，否则 integrator 合回并行切片时会因工作区脏被 `git merge` 拒绝。写 `openspec/changes/<name>/.flight`（JSON，含启动时间）。

5. **启动切片工作流**
   - 先确定当前会话模型别名 `<main>`（`/model` 显示的：`fable` / `opus` / `sonnet`）。
   - 优先用 **Workflow** 工具：`name: "opsx-apply"`，`args: {change: "<name>", changeDir: "openspec/changes/<name>", hooksDir: ".claude/hooks", agentsDir: ".claude/agents", waves: <step3 的 waves>, useAgentTypes: true, expectHead: "<git rev-parse --short=10 HEAD>", models: {executor: "<main>", reviewer: "<main>", integrator: "sonnet"}, efforts: {executor: "high", reviewer: "high", integrator: "low"}}`。`models` 缺任一角色脚本会拒绝起飞。
   - 同时传 `deps: <slices.json 里每片的 deps 映射>`，依赖已 blocked 的切片脚本不再派发。
   - Workflow 不可用（工具缺失 / `disableWorkflows`）→ **回退**，语义与脚本逐项一致：按 waves 逐 wave 用 **Agent** 工具在同一条消息里并行派发 `subagent_type: slice-executor`、`model: "<main>"`、`effort: high`（同 wave 多切片各自 `isolation: worktree`；prompt 首行带 `expectHead` 第零步基分支校验），回报只收其原样 JSON；**门禁红则以其 `failed` 重派同一切片一次**，仍红记 blocked，依赖它的切片直接记 blocked；每个 wave 跑完派一个 `integrator`（`model: "sonnet"`、`effort: low`）先提交飞行记录、合回、逐片 `slice-gate.py record` 写回门禁结论；评审用 `code-reviewer`（`model: "<main>"`、`effort: high`）并行派发（`run_in_background` 语义：不等它完成再继续）；全部 wave 跑完后对阻断 finding 做一次批量修复，再跑一次 final。
   - 两条路径最终都产出同一份 JSON：`{change, models, efforts, slices: [...], blocked: [...], blocking: [...], deferred: [...], fix, final}`（完整字段见 `.claude/workflows/opsx-apply.js` 的 `return`）。

6. **收口分解**
   收到工作流 JSON 后：
   ```bash
   python3 .claude/hooks/timeline.py record apply-done --change-dir openspec/changes/<name>
   python3 .claude/hooks/session-decompose.py --session <当前会话 jsonl，取 ~/.claude/projects/<slug>/ 下最新> --workflow <Workflow 返回的 Transcript dir>
   python3 .claude/hooks/timeline.py report --change-dir openspec/changes/<name>
   ```
   打印 session-decompose 与 timeline report 输出的飞行记录（含**各 agent 实际模型**，与上面的路由表对账；对不上即铁律违规，写进收口报告）；把工作流返回的 `{blocked, blocking, deferred, fix}` 原样写入 `openspec/changes/<name>/review-findings.json`（`blocked` 条目带 `kind: gate | infra`，供 `/pr-ship` 进 PR 正文作说明；`blocking` 是 `ship` 裁决依据之一）；删除 `openspec/changes/<name>/.flight`；然后跑机械裁决：
   ```bash
   python3 .claude/hooks/slice-gate.py ship --change-dir openspec/changes/<name>    # 退出 0 ready / 1 draft；reasons 列出为何不 ready
   ```
   `ship` 只读 `gate-report.md`（每切片最新行 + final 行是否 ok 且对齐 HEAD）与 `review-findings.json.blocking`，不看工作流的 blocked 列表。reasons 里出现 `final 过期` → 重跑 `slice-gate.py final` 再 `ship`。把门禁绿的切片在 `tasks.md` 里对应 `- [ ]` 勾成 `- [x]`（红的切片不勾）；飞行记录文件单独 `chore(flight)` commit。

7. **不问，直接进入 `/pr-ship`**
   无论 `ship` 结果如何都调用 `/pr-ship`；它会自己再跑一次 `ship` 决定以 draft 还是 ready 建 PR，并把 `ship --markdown` 的段落贴进正文。主会话不自行判断 draft。

**暂停例外（仅这四种，其余一律直接往下走，不问）**
- spec 自相矛盾
- 需要破坏性操作（如需要用户显式授权的 merge / push / delete）
- 测试环境本身坏（verify 在改动前就不可运行）
- 同一门禁项连续 2 次红

**Guardrails**
- 启动到 `/pr-ship` 之间不出现 AskUserQuestion（四种暂停例外走「停下报告」，不是问询）。
- 模型按角色显式路由；派发时不得省略 `model`；收口报告必须打印各角色实际模型。
- `--gate=per-task` 是唯一非飞行路径，转给 legacy skill 承载，本命令步骤 3–7 不适用于该分支。
- 不自动 merge / push / 删 worktree。
