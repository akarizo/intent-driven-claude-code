## ADDED Requirements

### Requirement: 读出诊断结论
控制面 SHALL 从 triage 文本读出处置类别：取第二个非空行，去掉首尾空白，再去掉成对包住整行的 `**` 与「」；结果恰为「改计划」「修插件」「人工操作」之一时为该类别，否则为未知。读法 SHALL 是纯文本判定（零 token）。

#### Scenario: triage-verdict-parsed
- **GIVEN** 七段 triage 文本：
  - 甲 `根因\n改计划\n草案`
  - 乙 `根因\n**改计划**`
  - 丙 `根因\n「修插件」`
  - 丁 `根因\n\n  人工操作  `
  - 戊 `根因\n建议改计划`
  - 己 `只有一行`
  - 庚 `根因\n改计划。`
- **WHEN** 逐段读出处置类别
- **THEN** 依次为 改计划、改计划、修插件、人工操作、未知、未知、未知

### Requirement: 诊断为「改计划」即计划缺陷
最新 attempt 有 halt，且该 attempt 最新一条 triage 的结论为「改计划」时，控制面 SHALL 判为计划缺陷，原因为该 triage 的首行。原有 G5 判据 SHALL 不变，且两条都命中时取 G5 的原因。判为计划缺陷后沿用 flight-plan-defect-halt 的效果：计划指纹与最新 takeoff 相同时不给续飞，批准带显示「计划需修订：<原因>」、仍可搁置，`/flight resume` 拒绝且不写 takeoff；计划指纹变化后照常给「批准修订并续飞」。

#### Scenario: plan-defect-from-triage-replan
- **GIVEN** attempt 1 里 S1 记 blocked（gate，原因「G1 verify: exit 1」），随后 kind blocked 的 halt，再有一条 triage，文本为 `S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py`
- **WHEN** 求计划缺陷
- **THEN** 结果为「S1 的 owns 漏了 tests/test_x.py」

#### Scenario: plan-defect-ignores-other-triage
- **GIVEN** 三份账本：
  - 甲：同上，但 triage 的第二行为「修插件」
  - 乙：attempt 1 同上（结论「改计划」），之后 attempt 2 起飞、尚未停飞
  - 丙：attempt 1 有 halt，先后两条 triage，前一条结论「改计划」、后一条结论「人工操作」
- **WHEN** 对三份账本各求计划缺陷
- **THEN** 三份都不是计划缺陷

#### Scenario: band-shows-plan-defect-from-triage
- **GIVEN** gamma 当前与最近批准的指纹都为 F；账本为 approve F → takeoff F（attempt 1）→ S1 的 blocked（原因「G1 verify: exit 1」）→ kind blocked 的 halt → triage，文本为 `S1 的 owns 漏了 tests/test_x.py\n改计划\n草案`；本会话已认领 gamma
- **WHEN** 批准带刷新并绘制
- **THEN** 有含「计划需修订」与「S1 的 owns 漏了 tests/test_x.py」的文字，没有 key 以 resume: 开头的按钮
- **AND** 有 key 为 shelve:gamma:<F> 的按钮

#### Scenario: resume-refused-on-triage-replan
- **GIVEN** demo 的 attempt 1（本会话、指纹 F）以 kind blocked 的 halt 结束，S1 的 blocked 原因为「G1 verify: exit 1」，之后有一条 triage，文本为 `S1 的 owns 漏了 tests/test_x.py\n改计划\n草案`；当前计划指纹仍为 F，起飞守卫放行
- **WHEN** 人在终端发出 `/flight resume demo`
- **THEN** 回复含「计划需修订」与「S1 的 owns 漏了 tests/test_x.py」，不含「护栏」「未批准」「计划已变」
- **AND** 账本没有 attempt 2 的 takeoff

### Requirement: 诊断为「改计划」时交主会话修订计划
诊断员结束、triage 写入后，若其结论为「改计划」且这次飞行由本会话起飞，控制面 SHALL 经 `$.prompt.submit` 向主会话提交一次修订请求，每条 triage 至多一次；结论不是「改计划」时 SHALL NOT 提交。修订请求 SHALL 含诊断全文，并写明边界：只改本 change 的计划工件、不改生产代码；改完重新渲染 spec.html 并跑 `slice-gate.py lint` 到绿；不发 `/opsx-apply`、`/flight resume`，续飞须人在批准带按「批准修订并续飞」；诊断与代码现状不符时不硬改。提交修订请求 SHALL NOT 写 approve 或 takeoff，SHALL NOT 派发 agent。停飞诊断的通知 SHALL 注明是否已交主会话。

Feature: 铁律 7 不变——模型只改计划，批准仍是人在批准带上的按键。

#### Scenario: replan-prompt-states-bounds
- **GIVEN** change demo、change 目录 `template/openspec/changes/demo`、判定器目录 `/repo/template/.claude/hooks`、attempt 2、triage 文本 `S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py`
- **WHEN** 生成修订请求
- **THEN** 正文含 demo、attempt 2 与 triage 全文
- **AND** 含「只改本 change 的计划工件」「不改生产代码」
- **AND** 含 `/repo/template/.claude/hooks/spec_html.py --change-dir template/openspec/changes/demo` 与 `/repo/template/.claude/hooks/slice-gate.py lint --change-dir template/openspec/changes/demo`
- **AND** 含「不要发 /opsx-apply」「/flight resume」「批准修订并续飞」与「不硬改」

#### Scenario: replan-triage-handed-to-main-session
- **GIVEN** demo 由本会话起飞（waves [[S1]]），S1 门禁一律红 [G1 verify: exit 1]，执行体逐个收口直到停飞；诊断员的最终回答为 `S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py`
- **WHEN** 诊断员结束（turn.complete），时钟推进到 clock.after(0) 到点
- **THEN** prompt.submit 恰收到一次，正文含诊断全文、「只改本 change 的计划工件」与「不要发 /opsx-apply」
- **AND** 有一条通知同时含「S1 的 owns 漏了 tests/test_x.py」与「已交主会话修订计划」
- **AND** triage 之后账本没有新的 approve、takeoff 与 dispatch

#### Scenario: other-verdicts-not-handed-over
- **GIVEN** 同上，但诊断员的最终回答为 `判定器缺 features 子命令\n修插件`
- **WHEN** 诊断员结束，时钟推进到 clock.after(0) 到点
- **THEN** prompt.submit 没有收到任何提交
- **AND** 有含「判定器缺 features 子命令」的通知，且没有任何通知含「已交主会话」

### Requirement: 文档写明交主会话修订与插件版本
`opsx-apply` 命令与 `openspec-apply-change` skill SHALL 同改，写明诊断为「改计划」时插件交主会话修订计划、人按「批准修订并续飞」；两份与 README SHALL NOT 再说诊断「不参与任何判定」。插件版本 SHALL 不低于 0.13.0。

#### Scenario: docs-describe-replan-handoff
- **GIVEN** `template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md` 与 `README.md`
- **WHEN** 读取三份全文
- **THEN** 前两份各有一行同时含「改计划」与「主会话」，且都含「批准修订并续飞」
- **AND** 三份都不含「不参与任何判定」

#### Scenario: plugin-version-0-13-0
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 按数字逐段比较不低于 0.13.0，description 含「交主会话修订计划」
