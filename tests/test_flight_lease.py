"""派发凭证 lease.ts（scenario: flight-dispatch-lease#dispatch-refused-after-hook-returns / dispatch-allowed-in-live-hook）。
断言插件里同名的 TS 测试通过。"""
from test_flight_plugin import assert_ts_passed


def test_dispatch_refused_after_hook_returns():
    # Given: 在 withLease 的 body 里取得凭证并保存，body 已返回；另有一次请求不带凭证
    # When: 分别用失效凭证与「没有凭证」请求派发（guardedSpawn）
    # Then: 两次都得到含「派发须在处理外部事件的 hook 里」的拒绝；派发函数一次都没被调用
    assert_ts_passed("dispatch-refused-after-hook-returns")


def test_dispatch_allowed_in_live_hook():
    # Given: withLease 的 body 正在执行
    # When: body 里用它的凭证请求派发
    # Then: 派发函数被调用恰一次，并原样返回它的结果
    assert_ts_passed("dispatch-allowed-in-live-hook")
