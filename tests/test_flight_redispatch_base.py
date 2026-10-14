"""同一 attempt 内续派执行体沿用首个执行体的起点（scenario: flight-redispatch-base#*）。
`claude plugin test` 没有 xfail 等价物：每个插件 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试：core.test.ts（redispatch-carries-dispatch-base、redispatch-without-dispatch-base-unchanged）、
orchestrator.test.tsx（redispatch-pins-original-base）。
护栏 redispatch-without-dispatch-base-unchanged 在 base 上已成立：TS 用例规划时预写，包装不带 xfail。"""
import json
import os

import pytest

from test_flight_plugin import assert_ts_passed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.mark.xfail(strict=True, reason="待 S1 实现")
def test_redispatch_carries_dispatch_base():
    # Given: 两份账本，waves [S1]：甲 A 的派发记 base b0、收口门禁红（G4 GWT）后结束、补跑门禁仍红；乙 A 的派发记 base b0、无收口结论就结束、补跑门禁红（G3 test）
    # When: 各求下一批动作
    # Then: 都是续派 S1 执行体，续接原因「执行体未正常收口」，失败项分别为 G4 GWT、G3 test，base 都是 b0
    assert_ts_passed("redispatch-carries-dispatch-base")


def test_redispatch_without_dispatch_base_unchanged():
    # Given: waves [S1]；A 的派发没有 base 字段，收口门禁红（G4 GWT）后结束、补跑门禁仍红
    # When: 求下一批动作
    # Then: 续派 S1 执行体，续接原因「执行体未正常收口」、失败项 G4 GWT，动作不含 base
    assert_ts_passed("redispatch-without-dispatch-base-unchanged")


@pytest.mark.xfail(strict=True, reason="待 S1 实现")
def test_redispatch_pins_original_base():
    # Given: /opsx-apply demo 已起飞，waves [S1]；S1 执行体 A 在 S1 worktree 派发，起点 base-flight-demo-S1；A 收口门禁红（G4 GWT）
    # When: A 结束，控制面续派 S1 的执行体
    # Then: 第二次 slice-gate base S1 带 --base base-flight-demo-S1；续派 dispatch 的 base 为 base-flight-demo-S1；agent 为 dispatch 的起点测量恰一次
    assert_ts_passed("redispatch-pins-original-base")


@pytest.mark.xfail(strict=True, reason="待 S1 实现")
def test_plugin_version_0_13_1():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    with open(os.path.join(ROOT, "template/plugins/flight/.claude-plugin/plugin.json"), encoding="utf-8") as f:
        # When: 解析其 JSON
        data = json.load(f)

    # Then: version 按数字逐段比较不低于 0.13.1
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 13, 1), data["version"]
