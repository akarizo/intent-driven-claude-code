## ADDED Requirements

### Requirement: final 绿之后先做全量评审
状态机 SHALL 在本 attempt 的 final 绿之后、落地之前，派全量评审员（slice `whole`，`commit` 为该 final 的 commit，`prior` 为切片评审的全部 CRITICAL/HIGH）。whole 的 review 没有 CRITICAL/HIGH 时 SHALL 落地。只有 blocked `review:whole` 时 SHALL 落地。切片级修复（slice `fix`）SHALL 只看切片评审的 findings。
Feature: 用户定（2026-10-13）：C1-A 控制面派全量评审

#### Scenario: whole-review-before-landing
- **GIVEN** waves `[[S1]]`；S1 已合回，切片评审给了 1 条 HIGH H1；修复 `fix` 已合回；本 attempt final ok，commit c9
- **WHEN** 求下一批动作；再追加 whole 的派发与一条没有 finding 的 review 后求一次；另取只追加 blocked `review:whole` 的账本求一次
- **THEN** 第一次恰为一条派发评审员动作：slice `whole`、mode `whole`、commit `c9`、prior 恰为 `[H1]`
- **AND** 第二次与第三次都恰为一条 land 动作

### Requirement: 修复至多 2 轮并复核
全量评审或复核给出 CRITICAL/HIGH，且本 attempt 已合回的修复轮少于 2 时，状态机 SHALL 派修复体（slice `fix-r<k+1>`，findings 为该轮的 CRITICAL/HIGH）。修复体收口门禁绿后 SHALL 以 via `fix` 合回该 slice；合回后 SHALL 先重跑 final，再派复核员（slice `whole-r<k>`、mode `followup`、base 为上一轮评审的 commit、commit 为新 final 的 commit、prior 为上一轮的 CRITICAL/HIGH）。已有 2 轮修复合回时 SHALL 落地，不再派修复体。
Feature: 用户定（2026-10-13）：C2-A 自动修，至多 2 轮

#### Scenario: fix-rounds-capped-at-two
- **GIVEN** 同上一个 scenario 的账本，whole 的 review 有 1 条 HIGH W1
- **WHEN** 依次推进：
  - 求动作；
  - 追加 fix-r1 修复体派发、绿的收口门禁、结束；
  - 追加 fix-r1 的 ok merge；
  - 追加 final ok（c10）；
  - 追加 whole-r1 派发与有 1 条 HIGH W2 的 review；
  - 再依次补齐 fix-r2 的派发、门禁、结束、merge、final ok（c11）、whole-r2 派发与有 1 条 HIGH W3 的 review
- **THEN** 依次得到：
  - 派发修复体（slice `fix-r1`，findings `[W1]`）；
  - 合回（slice `fix-r1`，via `fix`）；
  - final；
  - 派发评审员（slice `whole-r1`、mode `followup`、base `c9`、commit `c10`、prior `[W1]`）；
  - 派发修复体（slice `fix-r2`，findings `[W2]`）
- **AND** 最后一次恰为一条 land 动作
- **AND** 全程没有派发 slice 为 `fix` 的修复体

### Requirement: 面板显示全量评审
`summarize` SHALL 增加全量评审的状态：未开始 / 进行中 / 未返回 / 第 n 轮 x 条（CRITICAL/HIGH y）。`summaryLines` 的末行 SHALL 为 `修复 <fix> · final <final> · 全量评审 <状态>`。
Feature: 用户定（2026-10-13）：C1-A

#### Scenario: summary-shows-whole-review
- **GIVEN** 三份账本：final 绿但还没派全量评审；whole 已派未提交；whole-r1 已提交 2 条 finding，其中 1 条 HIGH
- **WHEN** 分别求 `summaryLines(summarize(...))` 的末行
- **THEN** 依次含「全量评审 未开始」「全量评审 进行中」「全量评审 第 2 轮 2 条（CRITICAL/HIGH 1）」

### Requirement: 全量评审与复核的提示词
插件 SHALL 用 `wholeReviewPrompt` 与 `followupReviewPrompt` 写提示词。两者都 SHALL 写明 `git diff <base> <commit>` 范围、逐条列出 prior 的 `file:line` 与摘要、要求经 `submit_findings` 提交，并写明取不到 diff 时报「取 diff 失败」的 HIGH。全量评审提示词 SHALL 写明 `timeline.py report` 是门禁与测量统计的依据；复核提示词 SHALL 写明轮次，并要求未闭环的照原级别再报。`reviewer.md` 正文 SHALL 写明三种范围（切片合回 commit、全量、复核），并保留「^1」「取 diff 失败」「HIGH」。
Feature: 用户定（2026-10-13）：C1-A 提示词由插件写

#### Scenario: whole-and-followup-prompts
- **GIVEN** change demo、change 目录 `template/openspec/changes/demo`、判定器目录 `/repo/hooks`；prior 为一条 HIGH `a.ts:3 空指针`
- **WHEN** 生成 base `b0`、commit `c9` 的全量评审提示词，与第 1 轮、base `c9`、commit `c10` 的复核提示词；再读 `agents/reviewer.md` 的正文
- **THEN** 全量提示词含 `git diff b0 c9`、`a.ts:3`、`submit_findings`、「取 diff 失败」与 `/repo/hooks/timeline.py report`
- **AND** 复核提示词含 `git diff c9 c10`、「第 1 轮」、`a.ts:3`、`submit_findings` 与「照原级别」
- **AND** reviewer.md 正文含「全量」「复核」「^1」「取 diff 失败」与「HIGH」

### Requirement: 派发全量评审与修复轮
派发 mode 为 `whole` 的评审员时，插件 SHALL 先算 `base = git merge-base <commit> <主 worktree HEAD>`，用全量提示词派发，并在 dispatch 事件里记 `commit` 与 `base`。算不出 base 或 base 等于 commit 时，SHALL NOT 派发，SHALL 记 blocked `review:whole`（infra），原因含「算不出全量评审的起点」。mode 为 `followup` 时，SHALL 用动作给出的 base 与 commit 派发复核员并记下二者。修复体动作带 slice 时，修复 worktree、分支、收口门禁事件与合回提交都 SHALL 用这个 slice。
Feature: 用户定（2026-10-13）：C1-A · C2-A

#### Scenario: whole-review-dispatch-records-range
- **GIVEN** 主 worktree HEAD 为 m0，`git merge-base c9 m0` 输出 b0；另一个世界 merge-base 退出 1
- **WHEN** 执行派发评审员动作（slice `whole`、mode `whole`、commit `c9`、prior `[]`）；再执行修复体动作（slice `fix-r1`）并让它收口
- **THEN** 第一个世界派发的提示词含 `git diff b0 c9`，账本末条 dispatch 的 slice 为 whole、commit 为 c9、base 为 b0
- **AND** 第二个世界没有派发，账本末条是 blocked `review:whole`，原因含「算不出全量评审的起点」
- **AND** 修复体的 worktree 为 `flight-demo-fix-r1`、dispatch 的 branch 为 `flight/demo/fix-r1`，收口门禁事件的 slice 为 `fix-r1`

### Requirement: 落地按 ship 的输出写记录
落地收口 SHALL 先运行 `slice-gate.py ship --change-dir` 并解析 JSON，用它的 `{blocked, blocking, deferred, fix}` 写 `review-findings.json`，再勾选 tasks、记 apply-done（note 中的数字取自 JSON）、提交记录；verdict SHALL 取 JSON 的 `ready`。输出无法解析时，verdict SHALL 为 draft，reasons 含「ship 输出无法解析」，SHALL NOT 写 `review-findings.json`。`mergeFix` SHALL 接受 slice，合回分支缺省为 `flight/<change>/<slice>`，提交信息为 `integrate: <slice>`。
Feature: 已定（2026-10-13）：记录只供人读

#### Scenario: closeout-writes-ship-output
- **GIVEN** ship 输出 `{ready:false, blocking:[1 条 HIGH], deferred:[1 条 LOW], blocked:[], fix:{ok:true, commit:"m1"}, …}`，退出 1；另一个世界 ship 输出 `oops`
- **WHEN** 执行落地收口；再以 slice `fix-r1` 调用 `mergeFix`
- **THEN** 第一个世界 `review-findings.json` 的四个字段恰为 JSON 中的对应值，apply-done 的 note 为 `blocked=0 blocking=1`，verdict 为 draft
- **AND** 第二个世界 verdict 为 draft，reasons 含「ship 输出无法解析」，没有写 `review-findings.json`
- **AND** `mergeFix` 合并的分支为 `flight/demo/fix-r1`，提交信息为 `integrate: fix-r1`
