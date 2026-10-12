## Why

阶段 3 的最后一块是交互（路线图 D8 / D9）。飞行现在只有一行状态行可看，还有三个缺口：

- **人无法中途停下一次飞行**：控制面自动停飞时也不终止已派出的 agent（#39 遗留）。
- **续飞没有独立入口**：要靠「再发一次 `/opsx-apply`」，续飞和新起飞在命令上分不开。
- **看不到各片进度**：wave、门禁、测量、评审、修复、final 都没有地方集中显示。

`flight-retire-workflow-engine`（#49）合入时还暴露了两个问题：

- **主检出没快进，插件照样起飞**：#48、#49 两次飞行都由 #46 版的旧判定器判，`guards` 与逐目标先红实际没有被执行过。起飞时没有任何机械检查能发现判定器过旧。
- **#49 评审留下三条 MEDIUM**：
  - `/opsx-apply` 命令的 Guardrails 仍写「PreToolUse hook」，与同名 skill 不一致；
  - 安装器只列出退役文件，没说明它们仍可被调用、且不再受起飞批准拦截；
  - apply skill 的「读到即停飞」一段，在用户用自然语言触发 skill 时会误判为插件缺席。

2026-10-12 实测（CLI 2.1.296，无头模式，default 与 bypass 两种权限模式都试过）：插件可以经 `$.tool.call({ tool: 'TaskStop', task_id: <agentId> })` 停掉自己派出的 agent，不弹权限询问。停下后 `turn.complete` 立即到达（`reason` 为 `aborted`），`classic.SubagentStop` 不触发。

## What Changes

- **`/flight` 命令**（插件注册），四个子命令：
  - `/flight status [<change>]`：按账本打印本次 attempt 的进度：各 wave、各片所处阶段、门禁红次数、测量见红、评审、修复、final 与落地或停飞。
  - `/flight panel [<change>]`：打开飞行面板。
  - `/flight abort [<change>]`（用户定：只有人工中止才停 agent）：
    - 只处理本会话起飞的在飞 attempt；
    - 先在账本记停飞（`人工中止（/flight abort）`），再用 TaskStop 停掉本 attempt 在飞的 agent，回复里逐个列出停下或没停下的；
    - 被停的 agent 留在 worktree 里的未提交改动，续飞时照旧续接。
  - `/flight resume <change> [--takeover] [授权提交]`（用户定）：只续未落地的 attempt，按同一份计划走起飞路径；从未起飞或已落地时拒绝并说明。
- **写账本的子命令只认人**（用户定，attempt 1 停飞后补）：
  - `abort` 与 `resume` 只接受人在终端发出（引擎标记的来源 `composer`，或 Remote Control 的 `bridge`），其他来源拒绝且不写账本；
  - 插件注册的命令恰为 `flight`，任何工具或命令都不写 approve；
  - 这条取代 flight-measure 与 flight-approval-ledger 里「插件不注册斜杠命令」的约束（design D8）。
- **飞行面板**（用户定：起飞时自动打开）：内容与 `/flight status` 相同，随控制面推进实时刷新。
- **起飞核对判定器能力**（用户定）：
  - `slice-gate.py features` 列出判定器支持的能力；
  - 插件起飞前核对自己需要的能力（`evidence-ledger-only`、`g5-per-target`、`guards`），缺一项就拒飞，并提示先把主检出更新到与插件同一版本。
- **#49 的三条 MEDIUM**：
  - `/opsx-apply` 的 Guardrails 改成与 skill 一致；
  - 安装器写明退役文件仍可被调用、且不再受起飞批准拦截，请尽快删除；
  - 命令与 skill 的「读到即停飞」一段区分「本轮是否发过 `/opsx-apply`」。
- **文档与版本**：`/opsx-apply` 命令、skill 与 README 写明 `/flight` 的用法；插件版本 0.6.0。

无 BREAKING。自动停飞的行为不变（用户定），仍不终止已派出的 agent。

## Capabilities

### New Capabilities
- `flight-judges-features`：判定器声明能力，插件起飞前核对。
- `flight-status-summary`：从账本归约出飞行进度（`/flight status` 与面板共用）。
- `flight-abort`：人工中止：先记停飞，再停在飞的 agent。
- `flight-commands`：`/flight` 命令的注册与接线、续飞、面板。
- `flight-interaction-docs`：`/flight` 的文档与 #49 的三条 MEDIUM。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **判定器**：`template/.claude/hooks/slice-gate.py`，新增 `features` 子命令。
- **插件**：
  - `template/plugins/flight/hooks/` 下的 `versions.ts`、`core.ts`、`orchestrator.tsx`，新增 `abort.ts`；
  - `types/index.d.ts` 新增面板状态；
  - `tests/flight.test.tsx` 的两条守卫改为期望登记的命令恰为 `flight`；
  - 版本 0.6.0。
- **文档**：`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`install.sh`、`README.md`。
- **本 change 自己的飞行**：插件 0.5.0 不核对判定器能力。起飞前主检出须在 f42ebcb（已核对）。
