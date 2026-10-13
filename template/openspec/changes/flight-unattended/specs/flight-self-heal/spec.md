## ADDED Requirements

### Requirement: 切片合回失败（非冲突）先重派一次
切片合回失败、failed 里没有 `conflict:` 项、且未派过解冲突 agent 时，`next` SHALL 先返回 `heal`（kind `merge-retry`，slice 为该切片）。账本里已有这条 heal（在该次合回之后）时，SHALL 返回一个不带 continuation 的全新执行体派发。判断该切片的合回结果时，SHALL 只看最后一次执行体派发之后的合回事件。重派后再次合回失败（非冲突）时，SHALL 记 blocked（infra），原因含「合回失败」。
Feature: 用户定（2026-10-13）：无人值守到 PR；ledger-guards a1 的 S9 合回失败，人只发了 `/flight resume`，重派一次就绿。

#### Scenario: merge-failure-retried-once
- **GIVEN** waves `[[S1]]`，attempt 1 里执行体 a1 收口门禁绿（commit c1）后合回失败：`merge {slice: S1, ok: false, failed: ['合回对第一父无变更：…']}`；账本里没有任何 heal
- **WHEN** 求 `next`；追加它返回的 heal 事件后再求 `next`；再追加执行体 a2 的派发、a2 收口门禁绿（commit c2）与 `ended` 后求 `next`
- **THEN** 第一次恰为 `heal {heal: 'merge-retry', slice: 'S1'}`
- **AND** 第二次恰为派发 S1 的执行体，且不带 continuation
- **AND** 第三次恰为 `merge S1 via branch`，此前那条失败的合回不再起作用
- **AND** 若在第三次之后再追加一条 S1 的失败合回（非冲突），`next` 返回 `blocked {slice: 'S1', blockKind: 'infra'}`，原因含「合回失败」，不再返回 heal

### Requirement: 自愈有预算
`healVerdict(state, kind, slice)` SHALL 在本 attempt 的 heal 事件已达 3 条时返回 `{ok: false}`，原因含「自愈预算已用尽」。同一 attempt 已有相同 (kind, slice) 的 heal 时 SHALL 返回 `{ok: false}`，否则 SHALL 返回 `{ok: true}`。预算不允许时，原本会自愈的地方 SHALL 照原行为处理：合回失败记 blocked、final 红停飞，原因追加预算原因。
Feature: 用户定 Q4：每次飞行合计 ≤ 3，同片同类 ≤ 1。

#### Scenario: heal-budget-caps
- **GIVEN** 两份 attempt 1 的账本：
  - 甲：已有 3 条 heal（merge-retry S2、watchdog review:S3、merge-retry S4），S1 合回失败（非冲突）；
  - 乙：已有 3 条 heal，全部切片已合回且评审无阻断，最新 final 红（commit c9，failed `['G2 test: exit 1（新增 1 条失败）']`）
- **WHEN** 分别求 `next`，并对甲求 `healVerdict(state, 'merge-retry', 'S1')`
- **THEN** 甲返回 `blocked {slice: 'S1', blockKind: 'infra'}`，原因含「合回失败」与「自愈预算已用尽」
- **AND** 乙恰为停飞，`haltKind` 为 `final`，原因含「final 未通过」与「自愈预算已用尽」
- **AND** `healVerdict` 返回 `ok: false`，reason 含「自愈预算已用尽（3/3）」

### Requirement: 被看门狗停掉的评审员与修复体各重派一次
评审员结束、没有交 review，且本 attempt 有一条 watchdog heal 的 agent 指向它时，`next` SHALL 重派一个评审员：同 slice、同 mode、同范围。没有这条 heal 时，SHALL 维持原行为（blocked review）。修复体结束、没有收口门禁结论，且有指向它的 watchdog heal 时，SHALL 重派一个修复体：同 slice、同 findings 与 failed。重派者也没有交结果时，SHALL 照原行为 blocked。
Feature: 用户定：看门狗停掉 agent 后按角色处理；执行体走现有的续派路径。

#### Scenario: watchdog-heal-redispatches-once
- **GIVEN** 三份账本，都是 waves `[[S1, S2]]` 且已全部合回：
  - 甲：S1 评审员 r1 已结束、没有 review，另有 `heal {kind: 'watchdog', slice: 'review:S1', agent: 'r1'}`；
  - 乙：同甲，但没有那条 heal；
  - 丙：评审均为空列表、S2 评审有 1 条 HIGH，修复体 fx（slice fix）已结束、没有收口门禁，另有 `heal {kind: 'watchdog', slice: 'fix', agent: 'fx'}`
- **WHEN** 分别求 `next`；再给甲追加重派评审员 r2 的派发与 r2 的 `ended`（仍无 review）后求 `next`
- **THEN** 甲返回派发 S1 评审员（commit 同 r1 的范围）
- **AND** 乙返回 `blocked {slice: 'review:S1'}`，原因含「评审未返回」
- **AND** 丙返回派发修复体，slice 为 `fix`，findings 为那条 HIGH
- **AND** 甲追加 r2 之后返回 `blocked {slice: 'review:S1'}`

### Requirement: 自愈在面板与飞行记录里可见
`summarize` SHALL 给出本 attempt 的自愈信息，`summaryLines` SHALL 含一行「自愈 k/3」，k 后列出每条 heal 的 kind 与 slice。`timeline.py report` 在账本有 heal 时 SHALL 打印「自愈：k 次」与各条明细，有 triage 时 SHALL 打印「停飞诊断：<首行>」。
Feature: 铁律 8：度量必打印。

#### Scenario: summary-shows-heals
- **GIVEN** attempt 1 的账本有两条 heal：merge-retry S9、watchdog review:S2；另一份账本没有 heal
- **WHEN** 分别求 `summaryLines(summarize(...))`
- **THEN** 第一份含一行，包含「自愈 2/3」「merge-retry S9」「watchdog review:S2」
- **AND** 第二份含「自愈 0/3」

#### Scenario: report-prints-heals-and-triage
- **GIVEN** 一个 git 仓库里的账本：takeoff、两条 heal（merge-retry S1、integ integ）、halt（kind final）、triage（text 首行「S2 的 owns 漏了守卫测试」）
- **WHEN** 运行 `timeline.py report --change-dir <D>`
- **THEN** 输出含「自愈：2 次」「merge-retry S1」「integ integ」
- **AND** 输出含「停飞诊断：S2 的 owns 漏了守卫测试」

### Requirement: 账本认得新事件
`ledger.py` 与插件 `io.ts` 的字段表 SHALL 认得以下内容，不合字段表的 SHALL 被拒（ledger.py 的 verify 判损坏、插件 `eventProblem` 返回原因）：
- `heal {attempt, kind ∈ merge-retry | watchdog | integ, slice, reason}`，agent 可选；
- `triage {attempt, agent, text}`；
- dispatch 的 role 认 `diagnostician`；
- halt 的 `kind` 可选，有则须属 blocked / final / integ / fingerprint / control / watchdog / abort。

Feature: 判定器与插件的字段表一致（`DRAFT-flight-orchestrator-state-machine`）。

#### Scenario: ledger-accepts-heal-and-triage
- **GIVEN** 一个账本依次含合法的 takeoff、`heal {kind: 'watchdog', slice: 'review:S1', reason: '空等 >10 分钟', agent: 'r1'}`、`dispatch {role: 'diagnostician', …}`、`halt {kind: 'final', …}`、`triage {agent: 'd1', text: '根因…'}`；另有三个各只坏一处的账本：heal 的 kind 为 `retry`、triage 缺 text、halt 的 kind 为 `oops`
- **WHEN** 分别运行 `ledger.py verify --change-dir <D>`
- **THEN** 第一个以 0 退出
- **AND** 三个坏账本都以非 0 退出，stderr 分别点名 heal.kind、triage.text、halt.kind

#### Scenario: io-knows-new-events
- **GIVEN** 插件 `io.ts` 的字段表
- **WHEN** 读取 `EVENT_TYPES`，并用 `eventProblem` 校验合法的 heal、triage、role 为 diagnostician 的 dispatch、kind 为 watchdog 的 halt，以及 kind 为 `oops` 的 halt
- **THEN** `EVENT_TYPES` 含 `heal` 与 `triage`
- **AND** 四个合法事件返回 undefined，kind 为 `oops` 的 halt 返回含 kind 的原因

### Requirement: 看门狗识别卡住的模型请求
`watchdog.ts` SHALL 导出 `WATCHDOG_MS = 600000` 与 `StepTracker`：
- `start(id, at)` 记下 agent 正在等的模型请求起点（同一 agent 再次 start 时覆盖）；
- `end(id)` 清除；
- `stale(now, limitMs = WATCHDOG_MS)` 返回起点早于 `now - limitMs` 的 agent，不含已 end 的。

Feature: 用户定 Q3：10 分钟。依据：2528 个历史 agent 转录里，正常回复的最长间隔为 581 s。

#### Scenario: watchdog-flags-stalled-requests
- **GIVEN** 一个 `StepTracker`：a1 在 t=0 start；a2 在 t=0 start、t=5000 end；a3 在 t=300000 start
- **WHEN** 分别求 `stale(599999)`、`stale(600001)`、`stale(900001)`
- **THEN** 依次为 `[]`、`['a1']`、`['a1', 'a3']`
- **AND** `WATCHDOG_MS` 为 600000

### Requirement: 控制面执行自愈并停掉卡住的 agent
`perform` 收到 `heal` 动作时 SHALL 追加 heal 事件，之后由下一轮 `next` 给出的派发完成重试；合回重试的执行体 SHALL 用一棵新的 worktree。看门狗发现某个飞行 agent 的模型请求等待超过 10 分钟时，处理如下：
- attempt 未结束且预算允许：SHALL 先追加 `heal {kind: 'watchdog'}`，再 TaskStop 该 agent；
- 预算不允许：SHALL 追加 halt（kind watchdog），并停掉本 attempt 仍在跑的全部 agent；
- attempt 已 land 或 halt：SHALL 直接 TaskStop，不记 heal、不停飞；
- TaskStop 返回 `isError` 或抛错：SHALL 追加 diag（where watchdog）。

Feature: 用户定：自愈先记后做；预算用尽即停飞并通知人。

同一个 agent SHALL 只处理一次。

#### Scenario: heal-recorded-then-retried
- **GIVEN** 测试世界里一次单片飞行（waves `[[S1]]`）：S1 执行体第一次收口门禁绿，但第一次合回失败（非冲突），第二次合回成功
- **WHEN** 起飞并让两个执行体先后收口结束
- **THEN** 账本依次出现 S1 的失败 merge、`heal {kind: 'merge-retry', slice: 'S1'}`、第二个 S1 执行体的 dispatch、S1 的成功 merge
- **AND** 第二个执行体的 worktree 路径与第一个不同

#### Scenario: watchdog-stops-stalled-agent
- **GIVEN** 测试世界里一次在飞的飞行：执行体 a1 有一个已开始的模型请求，从未结束；另一个执行体 a2 的请求已开始 9 分钟
- **WHEN** 时钟推进到 a1 的请求开始后 10 分钟零 1 秒，看门狗 tick 一次，之后再 tick 一次
- **THEN** 账本恰好追加一条 `heal {kind: 'watchdog', slice: <a1 的切片>, agent: 'a1'}`，且在 TaskStop a1 之前写入
- **AND** TaskStop 恰好对 a1 调用一次，a2 没有被停
- **AND** 若 TaskStop 返回 `isError`，账本追加一条 diag，where 为 `watchdog`

#### Scenario: watchdog-exhausted-halts
- **GIVEN** 测试世界里一次在飞的飞行，本 attempt 已有 3 条 heal；执行体 a1 的模型请求已等待超过 10 分钟，a2 也在跑
- **WHEN** 看门狗 tick
- **THEN** 账本追加 halt，kind 为 `watchdog`，原因含 a1 与「自愈预算已用尽」
- **AND** a1、a2 都被 TaskStop
- **AND** 没有追加新的 heal
