## Why

起飞前有两件事**必须为真**，今天却都由模型自己说了算：

**① 会话主模型是什么（铁律 11）。** 2026-09-10 一次 `/opsx-apply` 把 `slice-executor` / `code-reviewer` 路由到 `fable`，而当时会话主模型是 `claude-opus-5`。逐条聚合那次会话转录（`…/-Users-akarizo-Workspace-amc-afa--worktrees-syscomponent-from-system-part/d6c3b9c2-….jsonl`，614 条 assistant 条目）：

| 主循环模型切换时刻（UTC） | `message.model` | 旁证 |
|---|---|---|
| 05:27:39 | `k3` | — |
| 07:38:14 | `claude-fable-5-1` | 05:25 会话里出现过 `/model` → "Set model to `Fable 5.1`" |
| 08:19:02 | `claude-opus-5` | 紧接 08:18 的 `/compact`，无 `/model` 留痕 |
| 09:07:23 起飞 | 命令宣告 executor / reviewer = `fable` ❌ | 实际主模型已是 Opus 近 50 分钟 |

模型的"我是谁"来自上下文里的旧痕迹（那条 `/model` 输出、被 compact 压缩过两次的摘要），**不等于当前实际路由**。命令却写着「当前会话主模型别名（看 `/model`）」——把可机械判定的事实交给模型自述。

**② 人类批准过飞行计划（铁律 7）。** 今天的"批准"是：propose 收尾提示一句"运行 `/opsx-apply` 即视为批准"，apply 的 step 4 由模型自己 `timeline.py record approve`。**没有任何一处校验人类真的看过、真的说了起飞**——模型在同一轮里从 propose 直冲 apply，工件不落地、人不在场，飞行记录里照样有一条漂亮的 `approve`。用户实测："现在几乎没有在 apply 前停下来问我。"

两条是同一个病：**门禁的判据由被门禁的一方提供**。与铁律 9（能用脚本 / hook 判定的不交给模型）、铁律 1（intent-gate 只能加严不能绕过）直接冲突。

## What Changes

- **新增 `template/.claude/hooks/session-model.py`（零 token 判定）**：读当前会话转录（`CLAUDE_CODE_SESSION_ID` → `~/.claude/projects/*/<sid>.jsonl`）里**最后一条主循环 assistant** 的 `message.model`，映射成派发别名（`opus` / `sonnet` / `haiku` / `fable`）。**fail-closed**：转录缺失 / 无 assistant 条目 / 第三方 id（实测有 `k3`）一律非 0 退出并点名原因，绝不给默认值。
- **新增 `template/.claude/hooks/takeoff-gate.py` + `hooks.json` 注册（PreToolUse）**：拦截飞行派发（`Workflow` 的 `opsx-apply`、`Agent` 的 `slice-executor` / `integrator`），要求转录里存在**人类自己发出的批准证据**（真人消息调用 `/opsx-apply`｜`/opsx-bulk-apply`，或含批准词），且**晚于计划工件最后一次改动**；没有 → `permissionDecision: deny`，把 `spec.html` 路径交给人。模型绕不过 hook。
- **`/opsx-apply` 与 `openspec-apply-change` 同改**：step 0 显式跑 `takeoff-gate.py --change-dir …`（与 hook 双保险，给人看得懂的停下理由）；step 5 的 `<main>` 取自 `session-model.py`，判定失败 → 停下报告并要求 `--model=<alias>` 显式指定；step 4 的 `approve` 事件必须带人类批准证据（时间戳 + 摘要），不再自证。
- **`/opsx-propose` 与 `openspec-propose` 同改**：收尾改成**硬交接**——打印 `spec.html` 绝对路径，声明"本命令到此结束，不得在同一轮继续 apply；起飞需你显式 `/opsx-apply`"。
- **`/pr-ship`**：两处 `code-reviewer` 派发的 `<main>` 同源于 `session-model.py`。
- **收口对账机械化**：起飞把路由表写进 `.flight`；`session-decompose.py --workflow <dir> --expect-models <json>` 把各 agent 实际模型归一成别名后逐条对账，不符 → ❌ 并非 0 退出（`/pr-ship` 随之以 draft 建 PR）。
- **文档同改**：README · `docs/WORKFLOW_zh.md` · `template/CLAUDE.md.snippet` · 仓库根 `CLAUDE.md`（铁律 7 / 11 各加一句"判据不得由模型自证"）· `install.sh`。

**不改**：路由表本身（执行体 / 评审员 = 会话主模型 high，机械角色 = sonnet low）；`args.models` 缺参拒绝起飞的既有校验；agent frontmatter 的 `model: inherit`（派发仍显式传参，见 design D1）；飞行内部的零问询守则（本 change 加的两处都是"停下报告"，不是问询）。

## Capabilities

### New Capabilities

- **model-routing**：会话主模型的机械判定（判定来源 · fail-closed 语义 · 别名映射）与收口路由对账。
- **takeoff-approval**：起飞前人类批准的机械证据（证据来源 · 新鲜度 · hook 强制点 · propose 硬交接）。
