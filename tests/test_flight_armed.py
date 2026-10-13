"""起飞待命的纯判定 armed.ts（scenario: flight-armed-takeoff#refusals-classified / armed-budget-and-expiry / armed-decides-next-step）。
断言插件里同名的 TS 测试通过；骨架：S1 实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S1 未实现")
def test_refusals_classified():
    # Given: 11 条起飞回复（基线仍在跑、agent 仍在运行、起飞异常、git status 失败、lint 红、基线中断、未批准、账本损坏、工件未提交、跨会话、认不出的话）
    # When: 逐个调用 classifyRefusal
    # Then: 依次为 wait-baseline、wait-agents、transient、transient、model、model、human-key、human、human-key、human、human
    assert_ts_passed("refusals-classified")


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S1 未实现")
def test_armed_budget_and_expiry():
    # Given: 甲 model 类已重试 3 次；乙 wait-baseline 重试 5 次、待命 10 分钟；丙 wait-baseline 待命 31 分钟；丁 transient 且上次重试仍为 transient
    # When: 甲、丁遇 refused，乙、丙遇 tick
    # Then: 甲 give-up（重试已用尽）；乙 retry；丙 give-up（已过期）；丁 give-up
    assert_ts_passed("armed-budget-and-expiry")


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S1 未实现")
def test_armed_decides_next_step():
    # Given: wait-agents、transient、model 各一个待命，都未用过预算
    # When: wait-agents 遇 agent-ended；transient 遇 refused 与 timer；model 遇 refused、（awaitingModel 后）main-turn 与 tick
    # Then: retry；wait（10000）与 retry；submit、retry 与 wait；submit 正文含拒绝原文与三段边界文字
    assert_ts_passed("armed-decides-next-step")
