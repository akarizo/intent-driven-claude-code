"""看门狗的模型请求跟踪（scenario: flight-self-heal#watchdog-flags-stalled-requests）。
纯模块 watchdog.ts 的 TS 测试；骨架：S3 实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="flight-unattended S3 未实现")
def test_watchdog_flags_stalled_requests():
    # Given: StepTracker：a1 在 t=0 start；a2 在 t=0 start、t=5000 end；a3 在 t=300000 start
    # When: 分别求 stale(599999)、stale(600001)、stale(900001)
    # Then: 依次为 []、[a1]、[a1, a3]；WATCHDOG_MS 为 600000
    assert_ts_passed("watchdog-flags-stalled-requests")
