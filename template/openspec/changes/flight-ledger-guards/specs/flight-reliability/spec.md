## ADDED Requirements

### Requirement: 阻断态如实显示
`summarize` 的评审列 SHALL 在没有 review、但有 `blocked review:<S>` 时显示 `阻断（<kind>）`；修复列 SHALL 取本 attempt 最新一个修复体（`fix` 或 `fix-r<k>`），显示 `已合回`、`阻断（<kind>）` 或 `进行中`，`fix-r<k>` SHALL 带前缀 `第 <k> 轮 `；没有修复体派发但有 `blocked fix` 时 SHALL 显示 `阻断（<kind>）`。
Feature: 用户定（2026-10-13）：D4 第 4 项

#### Scenario: summary-shows-blocked-review-and-fix
- **GIVEN** 四份账本，都是 waves `[[S1]]` 且 S1 已合回：
  - 甲：S1 评审员已派、结束，有 `blocked review:S1`（infra），没有 review；
  - 乙：修复体 fix 已派，有 `blocked fix`（gate）；
  - 丙：fix-r1 已派，未合回，也没有 blocked；
  - 丁：没有修复体派发，有 `blocked fix`（infra）
- **WHEN** 分别求 `summaryLines(summarize(...))`
- **THEN** 甲的 S1 行含「评审 阻断（infra）」
- **AND** 乙的末行含「修复 阻断（gate）」
- **AND** 丙的末行含「修复 第 1 轮 进行中」
- **AND** 丁的末行含「修复 阻断（infra）」

### Requirement: diag 事件不影响飞行推进
`ev.diag` SHALL 构造 `{ev: 'diag', attempt, where, error, …}`；`reduce` / `next` / `summarize` SHALL 忽略 diag。`ev.final` SHALL 接受可选的 `warnings`。
Feature: 用户定（2026-10-13）：D4 第 5 项只留证据，行为不变

#### Scenario: diag-events-do-not-move-the-plan
- **GIVEN** 一份正在 wave 1 的账本 L（S1 已派执行体未结束），以及在 L 末尾追加一条 `ev.diag(b, {attempt: 1, where: 'SubagentStop', error: 'aborted', kind: 'timeout', agent: 'a1', budget: 10000})` 的账本 L2
- **WHEN** 分别求 `next(reduce(L))` 与 `next(reduce(L2))`、两者的 `summaryLines(summarize(...))`，并构造 `ev.final(b, {attempt: 1, ok: true, commit: 'c', failed: [], warnings: ['w']})`
- **THEN** 两次 `next` 的结果相同，两次摘要相同
- **AND** diag 事件的 ev 为 `diag`，带 where、error、kind、agent、budget
- **AND** final 事件带 `warnings: ['w']`

### Requirement: ship 工具校验判定器输出的形状
`shipPr` SHALL 在 ship JSON 缺 `review`、或 `review` 不是 null 也不是带 `slice` 字符串的对象时，按「ship 输出无法解析」拒绝，且 SHALL NOT 抛错、SHALL NOT 运行 gh；`git remote get-url origin` 失败时 SHALL 以「读取 origin 失败」拒绝。
Feature: change 1 评审 LOW（S4 ship.ts:55、:71、ship.test.ts:157）

#### Scenario: ship-output-shape-checked
- **GIVEN** 三个已落地（land ready）的世界：
  - 甲：ship 输出的 JSON 缺 `review` 键；
  - 乙：`git remote get-url origin` 以 2 退出，stderr「fatal: No such remote」；
  - 丙：一切正常，裁决 ready，PR 7 是 draft
- **WHEN** 分别调用 `shipPr(ctx, f, state, '7')`
- **THEN** 甲返回 deny，含「ship 输出无法解析」，没有运行任何 gh 的 comment 或 ready
- **AND** 乙返回 deny，含「读取 origin 失败」与「No such remote」，不含「只支持 GitHub」
- **AND** 丙运行的 `gh pr ready` 的 argv 恰为 `['gh', 'pr', 'ready', '7']`

### Requirement: 复核缺 base 时阻断
派发复核员（mode followup）时，base 为空或等于 commit SHALL NOT 派发，SHALL 记 `blocked review:<slice>`（infra），原因含「复核范围缺 base」。
Feature: change 1 评审 MEDIUM（S3 landing.tsx:113）

#### Scenario: followup-review-needs-base
- **GIVEN** S1 已合回、评审为空列表
- **WHEN** 分别以 `{slice: 'whole-r1', mode: 'followup', base: '', commit: 'c10'}` 与 `{… base: 'c10', commit: 'c10'}` 两个派发动作调用 `runLandingAction`
- **THEN** 两次都没有派发 agent
- **AND** 账本末条都是 `blocked review:whole-r1`（kind infra），原因含「复核范围缺 base」

### Requirement: draft 原因进飞行记录
落地 verdict 为 draft 且 closeout 给出 reasons 时，飞行记录 SHALL 含一行 `draft 原因：<reasons>`。
Feature: change 1 评审 MEDIUM（S3 landing.tsx:233）

#### Scenario: draft-reasons-in-flight-record
- **GIVEN** 两个世界都已 final 绿、全量评审为空列表：
  - 甲：slice-gate ship 输出 ready 为 false、reasons 为「final 过期」；
  - 乙：ship 输出「not json」
- **WHEN** 分别推进飞行到落地
- **THEN** 甲的账本末条 land 的 verdict 为 draft，飞行记录含「draft 原因：final 过期」
- **AND** 乙的飞行记录含「draft 原因：ship 输出无法解析：not json」

### Requirement: 落地动作在派发前再查停飞
`runLandingAction` SHALL 在派发评审员或修复体的 spawn 之前调用 `stoppedNow`；返回非 undefined 时 SHALL 不派发、不追加事件。
Feature: 用户定（2026-10-13）：D4 第 2 项

#### Scenario: landing-actions-skip-after-halt
- **GIVEN** 账本里 S1 已合回、评审有 1 条 HIGH；但在动作算出之后、执行之前，账本本 attempt 已追加 halt「人工中止」
- **WHEN** 以「派发修复体（1 条 HIGH）」和「派发全量评审员（commit c9）」两个动作调用 `runLandingAction`
- **THEN** 没有调用 spawn
- **AND** 账本没有新增事件

### Requirement: 派发执行体改调 base
`perform` 派发执行体与解冲突 agent 时 SHALL 运行 `slice-gate.py base`（全新执行体带 `--expect-branch <change 分支>`；续接带 `--base <原 base>`；解冲突不带），取其打印的 base 写入 dispatch 事件；SHALL NOT 运行 `slice-gate.py start`。base 退出非 0 时 SHALL 记 blocked，原因含其输出。
Feature: 用户定（2026-10-13）：D1-A

#### Scenario: dispatch-takes-base-without-start
- **GIVEN** 起飞后 wave 1 只有 S1；`slice-gate.py base` 打印 `{"slice": "S1", "base": "b1"}`
- **AND** 另一个世界里 base 以 1 退出，stdout 含「G0 base: HEAD …」
- **WHEN** drive 派发 S1 执行体
- **THEN** 世界一运行了 `python3 <hooks>/slice-gate.py base S1 --change-dir <D> --expect-branch worktree-demo`，cwd 为切片 worktree
- **AND** 世界一账本的 dispatch 事件 base 为 b1，全程没有 argv 含 `start` 的 slice-gate 调用
- **AND** 世界二没有派发，账本末条为 S1 的 blocked，原因含「G0 base」

### Requirement: 起飞以引擎判主模型
未给 `--model=` 时，起飞 SHALL 以 `$.session.model()` 的返回值按别名规则（opus / sonnet / haiku / fable，子串、不区分大小写）定主模型；取不出或调用抛错时 SHALL 拒飞，提示 `--model=`。起飞 SHALL NOT 运行 `session-model.py`。
Feature: 已定（2026-10-13）：插件改用 `$.session.model()`

#### Scenario: takeoff-reads-engine-model
- **GIVEN** 三个世界的 `session.model` 分别应答 `claude-opus-5-5`、`gpt-x`、抛出 Error「denied」；change 已批准、工作区干净
- **WHEN** 分别发 `/opsx-apply demo`；再在第二个世界发 `/opsx-apply demo --model=sonnet`
- **THEN** 第一个世界起飞，takeoff 事件的 model 为 `opus`
- **AND** 第二个世界首次拒飞，回复含「判不出主模型」与「gpt-x」与「--model=」
- **AND** 第三个世界拒飞，回复含「判不出主模型」与「denied」
- **AND** 带 `--model=sonnet` 那次起飞，takeoff 的 model 为 `sonnet`
- **AND** 四次都没有 argv 含 `session-model.py` 的调用

### Requirement: abort 先停 agent，再等动作收尾
在飞时 `abortFlight` SHALL 依次：记 halt → 停 `live()` 列出的 agent → `await drain()` → 再求 `live()`，只停第一段没有出现过的 agent。
Feature: 用户定（2026-10-13）：D4 第 1 项

#### Scenario: abort-stops-agents-before-draining
- **GIVEN** 本会话在飞的 attempt 1；`live()` 第一次返回 `[a1, a2]`，第二次返回 `[a1, a3]`；`drain()` 返回一个由测试控制何时完成的 promise
- **WHEN** 调用 `abortFlight`，在 drain 完成前检查调用记录，然后让 drain 完成
- **THEN** drain 完成前的调用顺序为 halt → live → stop a1 → stop a2 → drain
- **AND** drain 完成后只多出 live → stop a3
- **AND** 回复列出 a1、a2、a3 均「已停」

### Requirement: 自动停飞后可停残留 agent
本 attempt 已 halt 而 `live()` 非空时，`abortFlight` SHALL 停掉这些 agent，SHALL NOT 再记 halt，回复 SHALL 含 halt 原因与 `/flight resume <change>`；`live()` 为空时 SHALL 回答「没有在飞的 attempt，无需中止。」；本 attempt 已 land 时行为不变。
Feature: 用户定（2026-10-13）：D4 第 3 项

#### Scenario: abort-stops-residual-agents
- **GIVEN** 三份账本：
  - 甲：attempt 1 已 halt「final 未通过：G2」，`live()` 返回 `[a3]`；
  - 乙：同甲，但 `live()` 返回 `[]`；
  - 丙：attempt 1 已 land
- **WHEN** 分别调用 `abortFlight`
- **THEN** 甲调用了 stop a3、没有调用 halt，回复含「已停飞（final 未通过：G2）」「a3：已停」与「/flight resume demo」
- **AND** 乙与丙都回答「没有在飞的 attempt，无需中止。」，没有调用 halt 与 stop

### Requirement: perform 在派发与合回前再查停飞
`perform` SHALL 在派发执行体或解冲突 agent 的 spawn 之前，以及合回（切片、解冲突、修复）之前调用 `stoppedNow`；返回非 undefined 时 SHALL 不派发、不合回、不追加事件。
Feature: 用户定（2026-10-13）：D4 第 2 项

#### Scenario: perform-skips-after-halt
- **GIVEN** 起飞后 drive 正派发 S1：建 worktree 与起点测量期间，另一路记下 halt「人工中止」
- **AND** 另一世界里 S1 门禁已绿、待合回，合回动作算出后账本被追加 halt
- **WHEN** 两个世界各自推进
- **THEN** 第一个世界没有派发 S1 执行体（spawn 未被调用），账本 halt 之后没有 dispatch
- **AND** 第二个世界没有运行 `git merge`，账本 halt 之后没有 merge

### Requirement: SubagentStop 失败留 diag
执行体收口的 SubagentStop hook 失败（throw 或 timeout）时，`.catch` 处理器 SHALL 往账本追加 `diag {attempt, where: 'SubagentStop', agent, kind, error, budget}`，再按 hook 缺席处理。
Feature: 用户定（2026-10-13）：D4 第 5 项

#### Scenario: subagent-stop-error-leaves-diag
- **GIVEN** 在飞执行体 a1（S1）结束；收口门禁的 `slice-gate.py gate` 运行时抛出 Error「$.process.run(python3) aborted」
- **WHEN** 引擎发出 a1 的 SubagentStop
- **THEN** 账本末条为 diag，where 为 `SubagentStop`、agent 为 a1、kind 为 `throw`，error 含「aborted」，budget 为数字
- **AND** 没有为 a1 记 gate 事件

### Requirement: drive 写下停飞或落地后刷新面板
`driveNow` 执行完 halt 或 land 动作后 SHALL 按最新账本刷新面板。
Feature: 用户定（2026-10-13）：D4 第 4 项

#### Scenario: panel-refreshes-on-terminal
- **GIVEN** 面板已打开；S1 已合回、评审为空列表；final 输出 ok false、failed「G2 lint」
- **WHEN** drive 推进到停飞
- **THEN** 面板最后一次绘制的首行含「已停飞（final 未通过：G2 lint）」
