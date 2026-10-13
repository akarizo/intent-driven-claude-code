## ADDED Requirements

### Requirement: 停飞带分类
`next` 返回的 halt 动作 SHALL 带 `haltKind`：
- 收尾时有切片 blocked → `blocked`；
- 计划指纹变了 → `fingerprint`；
- final 红且不派整合修复，或整合修复后仍红 → `final`；
- 整合修复失败 → `integ`。

Feature: 用户定：停飞时机械分类，再交诊断员。

`ev.halt` SHALL 接受可选的 `kind` 并写入事件。

#### Scenario: halts-carry-kind
- **GIVEN** 三份账本：
  - 甲：S1 已 blocked（gate）、其余合回、评审收齐；
  - 乙：takeoff 指纹 F，当前计划指纹 G；
  - 丙：本 attempt 已有一个 integ 修复体合回，其后 final 红
- **WHEN** 分别求 `next`，并构造 `ev.halt(b, {attempt: 1, reason: 'x', kind: 'watchdog'})`
- **THEN** 甲、乙、丙的 halt 动作 `haltKind` 依次为 `blocked`、`fingerprint`、`final`
- **AND** 构造出的事件 ev 为 `halt`、kind 为 `watchdog`

### Requirement: 诊断员只读
包络 SHALL 对 `diagnostician` 角色施加与评审员相同的规则：不可写任何文件（Write / Edit / NotebookEdit 一律拒绝），git 只允许只读子命令。
Feature: 用户定 Q8：只读，主模型 high；诊断只供展示。

#### Scenario: diagnostician-read-only
- **GIVEN** 一个 Who：`{role: 'diagnostician', worktree: '/r/.worktrees/demo', owns: []}`
- **WHEN** 分别判定 Write `/r/.worktrees/demo/a.py`、Bash `git -C /r/.worktrees/demo commit -m x`、Bash `git -C /r/.worktrees/demo log --oneline -3`
- **THEN** 前两个被拒，拒绝理由含「诊断员」
- **AND** 第三个不被拒

### Requirement: 诊断员的定义与提示词
`agents/diagnostician.md` SHALL 满足：
- frontmatter 的 name 为 `diagnostician`、tools 恰为 `Read, Grep, Glob, Bash`、effort 为 `high`、maxTurns 为 30；
- 不带 model；
- 正文写明只读、不改任何文件、不重跑全量测试。

Feature: 用户定 Q8。

`triagePrompt({change, changeDir, hooksDir, reason, kind})` SHALL 给出：
- 停飞原因与 kind；
- `python3 <hooksDir>/ledger.py show --change-dir <changeDir>` 与 `python3 <hooksDir>/timeline.py report --change-dir <changeDir>` 两条查看命令；
- 最终回答的格式：首行一句话根因；第二行为「改计划 / 修插件 / 人工操作」之一；之后为计划修改草案（如有）。

#### Scenario: triage-prompt-and-agent
- **GIVEN** `agents/diagnostician.md`；change demo、changeDir `template/openspec/changes/demo`、hooksDir `/r/.claude/hooks`、reason「切片 blocked：S4（G1 verify: exit 1）」、kind `blocked`
- **WHEN** 解析 frontmatter，并生成 `triagePrompt`
- **THEN** name 为 diagnostician，tools 恰为 Read、Grep、Glob、Bash，effort 为 high，maxTurns 为 30，没有 model 字段
- **AND** 提示词含那条 reason、`blocked`、`ledger.py show --change-dir template/openspec/changes/demo`、`timeline.py report`
- **AND** 提示词含「改计划」「修插件」「人工操作」与「首行」

### Requirement: 停飞与 PR 开出时通知人
以下情况 SHALL 经 `ctx.notify` 通知：
- `runLandingAction` 执行 halt（`haltKind` 不是 `abort`）：先追加带 kind 的 halt 事件，再通知，内容含 change 名与原因首行；
- `shipPr` 成功写下 ship 事件：通知内容含 PR 号、ready / draft 与 blocking 条数；
- 交接 `/flight:pr-ship` 失败：通知内容含「手动运行 /flight:pr-ship」。

Feature: 用户定 Q6、Q7：只用终端通知；PR 开出时也通知。

`ctx.notify` 缺席或抛错时，SHALL NOT 影响停飞、落地与 ship 的结果。

#### Scenario: halt-notifies
- **GIVEN** 落地测试世界，ctx 带一个记录调用的 notify
- **WHEN** 先执行 `{kind: 'halt', reason: '切片 blocked：S4（G1）\n…', haltKind: 'blocked'}`，再执行 `{kind: 'halt', reason: '人工中止', haltKind: 'abort'}`；最后换一个 notify 会抛错的 ctx，再执行一次 blocked 停飞
- **THEN** 第一次账本追加 `halt {kind: 'blocked'}`，notify 恰被调用一次，内容含 demo 与「切片 blocked：S4（G1）」
- **AND** 第二次账本追加 `halt {kind: 'abort'}`，notify 没有被调用
- **AND** notify 抛错那次照样追加了 halt 事件，`runLandingAction` 没有抛错

#### Scenario: pr-open-notifies
- **GIVEN** 已落地（land ready）的 ship 测试世界，裁决 ready、blocking 0、PR 7；另一个落地世界的 `runCommand('flight:pr-ship', …)` 抛错
- **WHEN** 调用 `shipPr(ctx, f, state, '7')`；对另一个世界执行 land 动作
- **THEN** ship 事件写入后，notify 恰被调用一次，内容含「PR #7」或 PR 链接、ready、「blocking 0」
- **AND** 交接失败的那次 notify 内容含「手动运行 /flight:pr-ship」

### Requirement: 停飞后派只读诊断员，回答记为 triage
`driveNow` 写下 halt 之后，若 halt 的 kind 不是 `abort` 或 `fingerprint`，SHALL 在 change worktree 派发 `flight:diagnostician`，显式指定会话主模型，并追加 `dispatch {role: 'diagnostician'}`。诊断员结束时，`turn.complete` 处理 SHALL：
1. 追加 `ended`；
2. 取其最终回答，截断到 4000 字，追加 `triage {attempt, agent, text}`（回答为空时 text 为「（无回答）」）；
3. 以首行通知；
4. 刷新面板，摘要多一行「诊断：<首行>」。

Feature: 用户定 Q8：诊断只展示、不判定；人工中止与计划指纹变化不需要诊断。

#### Scenario: halt-dispatches-diagnostician
- **GIVEN** 测试世界里一次单片飞行，S1 两个执行体都门禁红，S1 被 blocked；另一次飞行在途中被 `/flight abort`
- **WHEN** 第一次飞行写下 halt；诊断员结束，最终回答为「S1 的 owns 漏了 tests/test_x.py\n改计划\n…」
- **THEN** halt 之后账本追加一条 dispatch，role 为 diagnostician，派发类型为 `flight:diagnostician`，model 为主模型
- **AND** 诊断员结束后账本追加 triage，text 以「S1 的 owns 漏了 tests/test_x.py」开头；notify 收到含该首行的内容；面板含「诊断：S1 的 owns 漏了 tests/test_x.py」
- **AND** 被 abort 的那次飞行没有派发诊断员

### Requirement: 通知走终端通知通道
`orchestrator.tsx` 的 `ctxOf` SHALL 提供 `notify(text)`，实现为 `$.ui.notify(text, {title: 'flight'})`。返回 `isSent: false` 或抛错时，SHALL 只用 `ctx.log` 记一行（含 reason），SHALL NOT 抛出。
Feature: API 事实：`$.ui.notify` 走用户的 `preferredNotifChannel`，未发出时返回 `{isSent: false, reason}`。

#### Scenario: notify-uses-terminal-channel
- **GIVEN** 测试世界里一次会停飞的飞行；第一个世界的 `ui.notify` 应答 `{isSent: true, channel: 'iterm2'}`，第二个世界应答 `{isSent: false, reason: 'no-channel'}`
- **WHEN** 两次飞行分别停飞
- **THEN** 两个世界的 `ui.notify` 都收到 title 为 flight、正文含停飞原因的调用
- **AND** 第二个世界的飞行记录（ctx.log）含「no-channel」，飞行照常以 halt 结束、没有抛错

### Requirement: 批准带为已停飞的 change 提供续飞按钮
批准带 SHALL 对候选 change 读账本，判断最新 attempt 是否以 halt 结束，并按下表显示：
Feature: 用户定：停飞后改完计划按一次键就续飞；首次起飞不变。

| 情形 | 按钮 | 说明行 |
|---|---|---|
| 已停飞，且当前计划指纹 ≠ 最近批准指纹 | 「批准修订并续飞」 | 含「提交本 change 的工件」「重跑基线」 |
| 已停飞，且计划未改 | 「续飞」 | — |
| 从未起飞、或最新 attempt 已落地 | 「批准起飞」（行为不变） | — |

#### Scenario: band-offers-resume-for-halted
- **GIVEN** 三个候选 change：
  - 甲：最新 attempt 以 halt 结束、计划改过；
  - 乙：最新 attempt 以 halt 结束、计划未改；
  - 丙：从未起飞、计划未批准
- **WHEN** 在 terminal 与 desktop 两个绘制面上，各让批准带依次显示甲、乙、丙
- **THEN** 甲显示按钮「批准修订并续飞」，说明行含「提交本 change 的工件」与「重跑基线」
- **AND** 乙显示按钮「续飞」
- **AND** 丙显示按钮「批准起飞」

### Requirement: 按下续飞按钮即按序续飞
按下「批准修订并续飞」时，SHALL 先核对指纹与绘制时一致，再追加 approve，然后在后台启动 `resumeFlight(…, {replan: true})`，且 SHALL NOT 预填 `/opsx-apply`。按下「续飞」时，SHALL NOT 追加 approve，在后台启动 `resumeFlight(…, {replan: false})`。
Feature: 铁律 7：批准只由按键写入；续飞由同一次按键触发，模型侧没有入口。

`resumeFlight` 的步骤：
1. 停掉该 change 仍在跑的诊断员；
2. replan 时运行 `slice-gate.py baseline --change-dir <D>`：
   - 退出 0 → 调用 `takeoff(['<change>', '授权提交'], {resume: true})`；
   - 非 0 → 通知「基线红，未续飞」与 reasons 首行，SHALL NOT 起飞；
3. 不 replan 时跳过基线，直接以同样参数调用 takeoff；
4. 把 takeoff 回复的首行通知出去。

#### Scenario: press-approves-then-resumes
- **GIVEN** 批准带正显示已停飞的甲（计划改过，指纹 F2）与乙（计划未改）；`resumeFlight` 由测试替身记录调用
- **WHEN** 按下甲的「批准修订并续飞」，再按下乙的「续飞」
- **THEN** 甲的账本追加 approve，fp 为 F2，替身收到 `{change: 甲, replan: true}`；输入框没有被预填
- **AND** 乙的账本没有追加 approve，替身收到 `{change: 乙, replan: false}`

#### Scenario: resume-flight-sequence
- **GIVEN** 三组注入的依赖：
  - 甲：仍有诊断员 d1 在跑，baseline 退出 0，takeoff 回复「续飞 attempt 2：已合回 3 片跳过\n✈ 起飞 demo …」；
  - 乙：baseline 退出 1，reasons 首行「S2 verify 红」；
  - 丙：计划未改
- **WHEN** 分别调用 `resumeFlight(deps, 'demo', {replan: true})`（甲、乙）与 `resumeFlight(deps, 'demo', {replan: false})`（丙）
- **THEN** 甲依次调用 stopLive（停 d1）、baseline、takeoff（参数含 demo 与「授权提交」，resume 为 true），通知含「续飞 attempt 2」
- **AND** 乙调用了 baseline、没有调用 takeoff，通知含「基线红，未续飞」与「S2 verify 红」
- **AND** 丙没有调用 baseline，调用了 takeoff
