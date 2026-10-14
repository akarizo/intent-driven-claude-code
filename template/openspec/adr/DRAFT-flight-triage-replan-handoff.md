# DRAFT. 诊断结论「改计划」是机械信号：判计划缺陷并交主会话修订，批准仍由人按键

- Status: accepted, supersedes DRAFT-flight-resume-from-band 的 Consequences 中「看诊断、让主会话改工件」一句（只取代这一点）
- Date: 2026-10-14
- Supersedes: DRAFT-flight-resume-from-band（该 ADR 在 main 上尚未编号，按文件名引用；Decision 第 1–3 条不变）
- 关联：DRAFT-approval-bound-to-plan-fingerprint（批准 = 人的按键，本 ADR 不改它）· DRAFT-flight-bounded-self-heal（自愈只做不改计划的再试，本 ADR 不扩大自愈）· DRAFT-flight-armed-takeoff（「交模型」用同一 `prompt.submit` 机制）
- 来源 change：flight-replan-handoff（design D1–D4）
- 被取代的 ADR 原文不动（铁律 6）。

## Context

- flight-unattended（design D6）规定诊断员的回答「只供展示、不参与任何判定」；DRAFT-flight-resume-from-band 据此把停飞后人的动作写成「看诊断、让主会话改工件、按一次键」。
- 2026-10-14 afa `cparam-native-subhz-layout` attempt 1：S1 门禁红在 owns 之外的测试文件，停飞后诊断员给出「改计划」与完整草案，之后会话空闲到人回来；批准带还给「续飞」，按下必在同一处再红。
- 诊断员第二行的格式早已固定为「改计划」「修插件」「人工操作」三选一，是零 token 可读的信号（铁律 9）。
- 用户目标（2026-10-14）：诊断为「改计划」时自动衔接到主会话改计划，人只按一次「批准修订并续飞」。

## Decision

1. **结论可机械读取**：取 triage 第二个非空行，trim 并去掉成对包住整行的 `**`、「」后，恰为三者之一才算；否则为未知，按原样只展示。
2. **「改计划」即计划缺陷**：本 attempt 已停飞、最新 triage 结论为「改计划」→ 计划指纹未变时不给续飞（批准带「计划需修订」、`/flight resume` 拒绝），与 G5 判据并列。
3. **交主会话修订，一次**：triage 写入时结论为「改计划」且这次飞行由本会话起飞，插件经 `prompt.submit` 把诊断全文与边界交给主会话：只改本 change 的计划工件、不改生产代码、改完渲染 spec.html 并跑 lint、不发起飞命令、诊断与现状不符时不硬改。
4. **批准不变**：模型改计划后指纹变化，续飞仍须人在批准带按「批准修订并续飞」；插件不写 approve、不起飞、不派发。

否决的方案：
- **插件按草案直接改计划**：草案未经任何人审阅即进计划，且诊断可能有误。
- **草案落盘为文件供人取用**：未审内容进入 change 目录，混入下次计划指纹。
- **「改计划」后自动批准并续飞**：违反铁律 7。

## Consequences

- **更易**：停飞后人的动作从「看诊断、让主会话改工件、按一次键」缩成「审 spec.html、按一次键」。
- **更难**：诊断员的输出格式成为契约，改格式须同改 `triageVerdict`；主会话可能在人不在时被插入一轮对话。
- **中性**：「修插件」「人工操作」与格式不合规的诊断行为不变；账本不加事件类型。
