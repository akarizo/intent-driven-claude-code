## Why

批准带每次刷新都会遍历仓库的全部 worktree，把所有含 `spec.html`、`tasks.md` 仍有未勾选项的 change 都拿来评估，再显示 `spec.html` 最近修改的那一项（`register.tsx` 的 `refresh` / `candidatesIn`；原 spec `flight-approval-ledger/specs/approval-band` 就是这样规定的）。结果是：同一仓库里开的每个会话，看到的批准带完全一样，与这个会话在做什么无关；刚写好的提案还可能被别的 change 盖住。

用户要求：批准带只显示与当前会话相关的 change。

决策页：`docs/flight-band-session-scope.html`（主检出，未跟踪）。Q1、Q2、Q3、Q5 按推荐项；Q4 选 C（认领不跨进程保留）。

## What Changes

- **会话认领**：插件为每个会话记一份认领的 change 名，只认两类机械事实，不让模型自述：
  - **写入**：本会话的 Write / Edit / NotebookEdit / Bash 写入目标落在某个 change 目录内（主循环与子 agent 都算；口径与意图门禁相同）；只读不算。
  - **命令**：人（终端、Remote Control、SDK）发的 `/opsx-*` 或 `/flight` 命令，参数里点名的 change。
- **批准带只评估、只显示已认领的 change**：未认领的不显示，也不再为它们计算指纹、读账本；没有已认领的待批准项时批准带不出现。本进程正在起飞 / 跑基线的项照旧显示。
- **认领只在本进程内有效**（Q4 C）：存于会话状态，热重载保留，进程重启后为空；之后发一次 `/opsx-apply <name>` 即可再认领。
- **同一 change 可被多个会话认领，各自都显示**（Q2 A）；重复起飞由现有的跨会话起飞守卫拦截。
- **文档**：opsx-apply / opsx-propose 的命令与 skill、README、`docs/WORKFLOW_zh.md` 写明「只显示本会话认领的 change」与认领方法。
- **BREAKING**：原来能看到的、别的会话写的 change，现在要先在本会话发 `/opsx-apply <name>` 认领才显示。插件版本 0.11.0。

## Capabilities

### New Capabilities
- `flight-band-session-scope`：批准带只评估本会话认领的 change；写入与人发的命令即认领；只读不认领。
- `flight-band-session-scope-docs`：文档写明会话认领；插件 0.11.0。

### Modified Capabilities
- 无。仓库没有主 specs 目录，以 ADDED 记在本 change 目录。`flight-band-session-scope` 收窄了 `approval-band`「遍历会话所在仓库的全部 worktree」那一句的显示范围：遍历与同名去重规则不变，只是只取已认领的名字。

## Impact

- **插件**：
  - `template/plugins/flight/hooks/register.tsx`：认领集合、两处记录、`refresh` 过滤；
  - `orchestrator.tsx` 只导出 `HOST_ORIGINS` 与 `originOf`；
  - `types/index.d.ts` 加会话状态 `claims`；
  - `tests/flight.test.tsx` 的现有批准带用例在 Given 里补认领。
- **不改**：判定器（`plan_fp.py`、`ledger.py`、`takeoff-gate.py`）、账本事件、按键处理、起飞待命、跨会话起飞守卫。不建 ADR。
- **安全面**：只是显示过滤，隐藏是更安全的方向，不新增任何批准路径；批准仍只能由人按键写账本。
