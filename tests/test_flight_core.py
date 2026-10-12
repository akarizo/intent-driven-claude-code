"""flight 状态机核心（scenario: flight-state-machine#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
S2 已实现：骨架的 xfail 标记已去。flight-gate-speedup 的 S3 在末尾追加了 4 个 flight-blocked-halt#* 骨架（标记已去）。"""
import pytest

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
    # Given: 最新 final 事件 ok 为 false，failed 为 G2 lint
    # When: 求下一批动作
    # Then: 恰为停飞，原因含 G2 lint，没有落地
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
# 骨架：S3 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S3：同名 TS 测试尚未实现")
def test_summary_from_ledger():
    # Given: demo 的账本：attempt 1、waves [[S1, S2], [S3]]；S1 已合回且评审 1 条 HIGH，S2 门禁红 1 次后仍在执行，S3 未派
    # When: 求 summaryLines(summarize(state))
    # Then: 首行含 demo、attempt 1、W1/2；S1 已合回、S2 门禁红 1、S3 待派；末行含修复与 final
    assert_ts_passed("summary-from-ledger")
