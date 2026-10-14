## Why

2026-10-14 afa 的 `cparam-native-subhz-layout` 起飞后停飞，停下后飞行没有接着往下走：

| 时间（UTC） | 事件 |
|---|---|
| 08:44 | 起飞；S1 执行体实现并提交 |
| 08:51 | S1 门禁红：G1 verify 有 2 条失败，均在 `executor/tests/af_validate/test_rpq_diff.py`；该文件不在任何切片的 owns 里，执行体写不了 |
| 08:51–08:56 | 重派执行体：补了 G4，G1 仍红；S1 blocked，S2–S6 跟着 blocked，停飞（kind blocked） |
| 08:59 | 诊断员回答第二行为「改计划」，并附 owns / `verify/_env.sh` / 切片包的改法草案 |
| 之后 | **什么也没发生**：诊断只写进账本并发了一条通知；那个会话一直空闲，批准带还给出「续飞」，按下会在同一处再红 |

flight-unattended 把这一步留给了人：design D6 写「诊断只供展示、不参与任何判定」，DRAFT-flight-resume-from-band 写停飞后人要「看诊断、让主会话改工件、按一次键」。用户要的是自动衔接（2026-10-14 决策）：诊断结论为「改计划」时，由插件把草案交给主会话改计划，人只在批准带按一次「批准修订并续飞」。

#62（0.12.0）已经在 G5「改代码前已通过」这一种原因下判「计划需修订」、不给续飞；判据只认 blocked 原因文字，认不出这次「verify 红在 owns 之外」。诊断员的第二行本来就规定为「改计划」「修插件」「人工操作」三选一，是零 token 可读的信号。

## What Changes

- **读出诊断结论**：新增纯函数，从 triage 文本读出处置类别：取第二个非空行，去掉首尾空白、成对的 `**` 与「」，恰为三者之一才算，否则为未知。
- **诊断为「改计划」即计划缺陷**：`planDefect` 在原有 G5 判据之外，新增一条：最新 attempt 已停飞，且该 attempt 最新一条 triage 的结论为「改计划」→ 计划缺陷，原因取 triage 首行。沿用 #62 的全部效果：
  - 计划指纹与最新 takeoff 相同时，批准带显示「计划需修订：<原因>」、不画「续飞」，仍可搁置；
  - `/flight resume` 拒绝，不写 takeoff；
  - 改计划后指纹变化，照常出现「批准修订并续飞」。
- **交主会话修订计划**：triage 写入后，结论为「改计划」且这次飞行由本会话起飞时，插件经 `$.prompt.submit` 向主会话提交一次修订请求（诊断全文 + 边界），每条 triage 至多一次：
  - 只改本 change 的计划工件，不改生产代码；
  - 改完重新渲染 spec.html、跑 `slice-gate.py lint` 到绿；
  - 不发 `/opsx-apply`、`/flight resume`；续飞须人在批准带按「批准修订并续飞」（铁律 7 不变）；
  - 诊断与代码现状不符时不硬改，写明分歧后结束这一轮。
  - 停飞诊断的通知改为注明「已交主会话修订计划」。
- **续飞拒绝文案**：计划缺陷来自诊断时，不再提「把该 scenario 标为护栏」（那是 G5 专用的出路）。
- **文档**：`opsx-apply` 命令与 `openspec-apply-change` skill 同改，README 同步；删去「诊断只供展示、不参与任何判定」的说法。
- **ADR**：新增 `DRAFT-flight-triage-replan-handoff`。
- 插件 0.13.0。

无 BREAKING：账本不加事件类型，判定器不用更新；诊断结论不是「改计划」的停飞行为不变。

## Capabilities

### New Capabilities
- `flight-replan-handoff`：读出诊断结论；诊断为「改计划」即计划缺陷（批准带、续飞拒绝）；交主会话修订计划；文档与插件版本。

### Modified Capabilities
（无：`openspec/specs/` 下没有已归档的 spec；`flight-plan-defect-halt` 的 G5 判据不变，本 capability 增加第二条判据。）

## Impact

- 插件：`template/plugins/flight/hooks/core.ts`（`triageVerdict`、`planDefect`）、`hooks/prompts.ts`（`replanPrompt`）、`hooks/orchestrator.tsx`（诊断员结束后交主会话、续飞拒绝文案）、`.claude-plugin/plugin.json`。
- 批准带 `hooks/register.tsx` 不改：它已用 `planDefect` 判定。
- 文档：`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`README.md`。
- ADR：`template/openspec/adr/DRAFT-flight-triage-replan-handoff.md`。
- 测试：新增 `tests/test_flight_replan_handoff.py`、`tests/test_replan_handoff_docs.py`；TS 用例追加在 `core.test.ts`、`prompts.test.ts`、`orchestrator.test.tsx`、`flight.test.tsx`。
