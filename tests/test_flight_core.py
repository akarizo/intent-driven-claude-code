"""flight 状态机核心（scenario: flight-state-machine#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
S2 已实现：骨架的 xfail 标记已去。flight-gate-speedup 的 S3 在末尾追加了 4 个 flight-blocked-halt#* 骨架（标记已去）。"""

from test_flight_plugin import assert_ts_passed


def test_core_dispatches_first_wave():
    # Given: waves [[S1, S2], [S3]]，S3 依赖 S1；账本只有 approve 与 attempt 1 的 takeoff
    # When: 求下一批动作
    # Then: 恰为派发 S1、S2 的执行体，没有 S3 的动作
    assert_ts_passed("core-dispatches-first-wave")


def test_core_blocks_dependents_of_blocked():
    # Given: attempt 1 里 S1 已 blocked（gate），S2 已合回
    # When: 求下一批动作
    # Then: S3 记阻断（infra，含「依赖已 blocked：S1」），不派发 S3
    assert_ts_passed("core-blocks-dependents-of-blocked")


def test_core_limits_stop_blocks_to_two():
    # Given: 执行体 A 已有两条收口门禁红结论且都被续修
    # When: A 第三次收口门禁仍红（G7 x）
    # Then: 判放行；A 结束后 S1 记 blocked（gate），原因含 G7 x
    assert_ts_passed("core-limits-stop-blocks-to-two")
    assert_ts_passed("core-limits-stop-blocks-to-two/after-end")
    assert_ts_passed("core-limits-stop-blocks-to-two/second-red-blocks")


def test_core_respawns_once_after_silent_end():
    # Given: 执行体 A 结束，本轮没有收口门禁结论
    # When: 求下一批动作，再记入门禁红结论
    # Then: 先跑 S1 门禁，再在原 worktree 续接派发；续接者同样无结论结束且门禁红则 S1 blocked
    assert_ts_passed("core-respawns-once-after-silent-end")


def test_core_reviews_fixes_then_finals():
    # Given: 全部切片已合回；S1 评审 1 条 HIGH，S2 评审 1 条 LOW
    # When: 依次推进
    # Then: 先派修复 agent（只含那条 HIGH），修复合回后跑 final，final 绿后落地
    assert_ts_passed("core-reviews-fixes-then-finals")


def test_core_halts_on_final_red():
    # Given: 两份账本，最新 final 事件 ok 为 false、failed 为 G2 lint：甲已有 3 条 heal（预算用尽），乙的 final commit 为空串
    # When: 分别求下一批动作
    # Then: 两份都恰为停飞，haltKind 为 final，原因含 G2 lint，没有落地也没有派整合修复
    assert_ts_passed("core-halts-on-final-red")


def test_core_halts_on_plan_change():
    # Given: takeoff 指纹 F，当前计划指纹 G
    # When: 求下一批动作
    # Then: 恰为停飞，原因含「计划指纹已变」
    assert_ts_passed("core-halts-on-plan-change")


def test_core_continues_from_previous_attempt():
    # Given: attempt 1 里 S1 已合回且有评审，S2 已派发无结论；之后有 attempt 2 的 takeoff
    # When: 求下一批动作
    # Then: 只在 S2 原 worktree 续接派发；不派 S1 的执行体与评审员
    assert_ts_passed("core-continues-from-previous-attempt")


def test_core_builds_ledger_events():
    # Given: 一次派发、一次门禁结论、一次 agent 结束
    # When: 用事件构造函数生成三条事件
    # Then: 字段与类型与 flight-ledger-events 表的 dispatch、gate、ended 三行一致
    assert_ts_passed("core-builds-ledger-events")


def test_core_reports_routing_mismatch():
    # Given: takeoff 主模型 opus，一个执行体 ended 的实际模型为 claude-sonnet-5-5
    # When: 求收口阻断项
    # Then: 含一条 HIGH，summary 含「路由不符」、executor、opus、claude-sonnet-5-5
    assert_ts_passed("core-reports-routing-mismatch")


# ---------------------------------------------------------------- flight-gate-speedup · flight-blocked-halt#*

def test_core_halts_when_slices_blocked():
    # Given: waves [[S1, S2]]；attempt 1 里 S1 blocked（gate，G7 x），S2 已合回、评审给了 1 条 HIGH
    # When: 求下一批动作
    # Then: 恰为一条停飞，原因含 S1、G7 x 与「未跑 final」；没有派发修复 agent，没有 final
    assert_ts_passed("core-halts-when-slices-blocked")


def test_core_waits_reviews_before_halting():
    # Given: waves [[S1, S2]]；S1 blocked，S2 已合回、评审员已派发但还没结束
    # When: 求下一批动作
    # Then: 没有停飞动作
    assert_ts_passed("core-waits-reviews-before-halting")


def test_core_review_blocked_still_finals():
    # Given: waves [[S1, S2]] 全部合回；S1 评审为空列表，review:S2 blocked（infra，评审未返回）
    # When: 求下一批动作
    # Then: 恰为一条 final 动作
    assert_ts_passed("core-review-blocked-still-finals")


def test_core_resume_redispatches_blocked_slice():
    # Given: attempt 1 里 S1 blocked、S2 已合回且评审为空列表、之后停飞；随后有 attempt 2 的 takeoff
    # When: 求下一批动作
    # Then: 恰为派发 S1 的执行体，没有 S2 的动作
    assert_ts_passed("core-resume-redispatches-blocked-slice")

# ---------------------------------------------------------------- flight-measure-followups
# S2 已实现：骨架的 xfail 标记已去。


def test_plan_change_forces_fresh_dispatch():
    # Given: attempt 1（指纹 A）派过 S1 执行体（门禁已绿未合回），S2 中断（门禁红）
    # When: attempt 2 以指纹 B 求下一批动作，再以指纹 A 求一次
    # Then: 指纹 B 时 S1、S2 都是不带续接与 base 的新派发；指纹 A 时 S1 regate、S2 带续接说明
    assert_ts_passed("plan-change-forces-fresh-dispatch")


def test_dispatch_records_branch():
    # Given: 一条带 branch 的 dispatch 与一条不带 branch、worktree 为 …/flight-demo-S3 的 dispatch
    # When: 分别 agentOf
    # Then: 前者 branch 为记下的分支，后者推出 flight/demo/S3
    assert_ts_passed("dispatch-records-branch")

# ---------------------------------------------------------------- PR #47 评审修复


def test_old_plan_gate_not_regated():
    # Given: attempt 1（指纹 F）S1 门禁绿未合回；attempt 2（指纹 G）重派 S1 后在收口前中断；attempt 3 仍为指纹 G
    # When: 求 attempt 3 的下一批动作
    # Then: S1 是带续接、不带 base 的派发，不拿旧计划的绿门禁补跑
    assert_ts_passed("plan-change-forces-fresh-dispatch/old-plan-gate")

# ---------------------------------------------------------------- flight-measure-strict
# 骨架：S3 实现后去掉 xfail 标记。


def test_gate_from_other_agent_not_regated():
    # Given: attempt 1 派 S1 执行体 a1，attempt 2（同指纹）续派 a2，之后 a1 的绿门禁（base b1）才记入；attempt 3 同指纹起飞
    # When: 求 attempt 3 的下一批动作
    # Then: S1 是带续接、不带 base 的派发，不是 regate
    assert_ts_passed("gate-from-other-agent-not-regated")

# ---------------------------------------------------------------- flight-interaction
# S3 已实现：骨架的 xfail 标记已去。


def test_summary_from_ledger():
    # Given: demo 的账本：attempt 1、waves [[S1, S2], [S3]]；S1 已合回且评审 1 条 HIGH，S2 门禁红 1 次后仍在执行，S3 未派
    # When: 求 summaryLines(summarize(state))
    # Then: 首行含 demo、attempt 1、W1/2；S1 已合回、S2 门禁红 1、S3 待派；末行含修复与 final
    assert_ts_passed("summary-from-ledger")

# ---------------------------------------------------------------- flight-ship-ledger
# S2 已实现：骨架的 xfail 标记已去。


def test_whole_review_before_landing():
    # Given: waves [[S1]]；S1 已合回，切片评审 1 条 HIGH H1，fix 已合回；本 attempt final ok（c9）
    # When: 求下一批动作；追加 whole 派发与无 finding 的 review 后再求；另取只追加 blocked review:whole 的账本求
    # Then: 第一次恰为派发评审员（slice whole、mode whole、commit c9、prior [H1]）；后两次都恰为 land
    assert_ts_passed("whole-review-before-landing")


def test_fix_rounds_capped_at_two():
    # Given: 同上账本，whole 的 review 有 1 条 HIGH W1
    # When: 依次追加 fix-r1 派发 / 绿门禁 / 结束、merge、final ok（c10）、whole-r1 派发与 HIGH W2、再补齐第 2 轮直到 whole-r2 的 HIGH W3
    # Then: 依次为派发 fix-r1、合回 fix-r1、final、派发 whole-r1（followup、base c9、commit c10、prior [W1]）、派发 fix-r2；最后恰为 land；全程没有派发 slice fix 的修复体
    assert_ts_passed("fix-rounds-capped-at-two")


def test_summary_shows_whole_review():
    # Given: 三份账本：final 绿未派全量评审；whole 已派未提交；whole-r1 已提交 2 条（1 条 HIGH）
    # When: 分别求 summaryLines(summarize(...)) 的末行
    # Then: 依次含「全量评审 未开始」「全量评审 进行中」「全量评审 第 2 轮 2 条（CRITICAL/HIGH 1）」
    assert_ts_passed("summary-shows-whole-review")

# ---------------------------------------------------------------- flight-ledger-guards
# S5 已实现：骨架的 xfail 标记已去。


def test_summary_shows_blocked_review_and_fix():
    # Given: 四份账本：blocked review:S1、blocked fix（gate）、fix-r1 进行中、未派即 blocked fix（infra）
    # When: 分别求 summaryLines(summarize(...))
    # Then: 依次含「评审 阻断（infra）」「修复 阻断（gate）」「修复 第 1 轮 进行中」「修复 阻断（infra）」
    assert_ts_passed("summary-shows-blocked-review-and-fix")


def test_diag_events_do_not_move_the_plan():
    # Given: wave 1 进行中的账本 L，及末尾多一条 ev.diag 的 L2
    # When: 分别求 next 与摘要，并构造带 warnings 的 ev.final
    # Then: 两次 next 与摘要相同；diag 带 where/error/kind/agent/budget；final 带 warnings
    assert_ts_passed("diag-events-do-not-move-the-plan")


# ---------------------------------------------------------------- flight-unattended S1
# S1 已实现：骨架的 xfail 标记已去。


def test_merge_failure_retried_once():
    # Given: waves [[S1]]；执行体 a1 收口门禁绿后合回失败（非冲突），没有 heal
    # When: 依次求 next：初始；追加 heal 后；追加 a2 派发、a2 收口绿与 ended 后；再追加一条 S1 失败合回后
    # Then: 依次为 heal merge-retry S1、不带 continuation 的 S1 执行体派发、merge S1 via branch、blocked infra（含「合回失败」）
    assert_ts_passed("merge-failure-retried-once")


def test_heal_budget_caps():
    # Given: 甲：已有 3 条 heal、S1 合回失败（非冲突）；乙：已有 3 条 heal、全部合回、final 红（commit c9）
    # When: 分别求 next，并求 healVerdict(甲, merge-retry, S1)
    # Then: 甲 blocked infra 含「合回失败」「自愈预算已用尽」；乙停飞 haltKind final 含「final 未通过」「自愈预算已用尽」；healVerdict ok 为 false
    assert_ts_passed("heal-budget-caps")


def test_watchdog_heal_redispatches_once():
    # Given: 甲：S1 评审员 r1 结束无 review、有 watchdog heal 指向 r1；乙：同甲无 heal；丙：修复体 fx 结束无收口门禁、有 watchdog heal 指向 fx
    # When: 分别求 next；甲再追加重派的 r2 结束（仍无 review）后求 next
    # Then: 甲重派 S1 评审员；乙 blocked review:S1；丙重派修复体 fix（同 findings）；甲追加 r2 后 blocked review:S1
    assert_ts_passed("watchdog-heal-redispatches-once")


def test_summary_shows_heals():
    # Given: 一份账本有 heal merge-retry S9 与 watchdog review:S2；另一份没有 heal
    # When: 分别求 summaryLines(summarize(...))
    # Then: 前者有一行含「自愈 2/3」「merge-retry S9」「watchdog review:S2」；后者含「自愈 0/3」
    assert_ts_passed("summary-shows-heals")


def test_final_red_dispatches_integ():
    # Given: waves [[S1, S2]] 全部合回、评审无阻断；最新 final 红（commit c9，G2 test 新增 3 条失败）；没有 heal
    # When: 求 next；追加 heal 后再求；另把 final 的 commit 改为空串再求
    # Then: 依次为 heal integ、派发修复体 slice integ（findings 空、failed 同 final）；commit 为空时停飞 haltKind final
    assert_ts_passed("final-red-dispatches-integ")


def test_integ_reviewed_before_merge():
    # Given: integ 修复体 fi 已派（base c9）、收口门禁绿（commit c10）、已 ended
    # When: 求 next；追加 integ 评审派发与只有 MEDIUM 的 review 后求；追加 merge integ ok 后求
    # Then: 依次为派发评审员（slice integ、mode integ、base c9、commit c10）、merge integ via fix（没有 fix 修复体）、final
    assert_ts_passed("integ-reviewed-before-merge")


def test_integ_failures_halt():
    # Given: 甲：review(integ) 有 1 条 HIGH；乙：blocked integ（gate）；丙：integ 已合回、其后 final 红
    # When: 分别求 next
    # Then: 甲停飞 haltKind integ 含「整合修复复核未通过」；乙停飞 haltKind integ；丙停飞 haltKind final，无 heal 无派发
    assert_ts_passed("integ-failures-halt")


def test_halts_carry_kind():
    # Given: 甲：S1 blocked；乙：takeoff 指纹 F、当前 G；丙：integ 已合回后 final 红
    # When: 分别求 next，并构造 ev.halt(b, {attempt: 1, reason: x, kind: watchdog})
    # Then: haltKind 依次为 blocked、fingerprint、final；事件 kind 为 watchdog
    assert_ts_passed("halts-carry-kind")
