"""人工中止（scenario: flight-abort#*）。abort.ts 是纯逻辑，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。"""

import pytest

from test_flight_plugin import assert_ts_passed


def test_abort_halts_then_stops_live_agents():
    # Given: 本会话起飞的 demo attempt 1 在飞，在飞的 agent 为 a2、a3，停 a3 会失败（not found）
    # When: 调用 abortFlight
    # Then: 先 halt（原因含「人工中止」）再依次停 a2、a3；回复含 a2 已停、a3 未停与 not found，并含 /flight resume demo
    assert_ts_passed("abort-halts-then-stops-live-agents")


def test_abort_refuses_without_own_flight():
    # Given: 三份账本：attempt 1 已落地 / 最新 takeoff 来自 other-session-1234 且在飞 / 没有 takeoff
    # When: 分别调用 abortFlight（本会话 sess-1）
    # Then: 第一、三份含「没有在飞的 attempt」，第二份含「另一个会话」与 other-se；都没有调用 halt 或 stop
    assert_ts_passed("abort-refuses-without-own-flight")

# ---------------------------------------------------------------- flight-ledger-guards
# 骨架：S7 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S7：同名 TS 测试尚未实现")
def test_abort_stops_agents_before_draining():
    # Given: 在飞 attempt 1；live 先后返回 [a1, a2] 与 [a1, a3]；drain 由测试控制
    # When: abortFlight，drain 完成前后各检查一次调用记录
    # Then: drain 前为 halt → live → stop a1 → stop a2 → drain；之后只多 live → stop a3
    assert_ts_passed("abort-stops-agents-before-draining")


@pytest.mark.xfail(strict=True, reason="S7：同名 TS 测试尚未实现")
def test_abort_stops_residual_agents():
    # Given: 甲：已 halt 且 live 为 [a3]；乙：已 halt 且 live 为空；丙：已 land
    # When: 分别 abortFlight
    # Then: 甲停 a3、不记 halt、回复含已停飞原因与 /flight resume demo；乙丙回答「没有在飞的 attempt，无需中止。」
    assert_ts_passed("abort-stops-residual-agents")
