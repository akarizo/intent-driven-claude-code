"""插件侧意图判定模块（scenario: flight-intent-guard#intent-verdict-module）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
S4 已实现：骨架标记已去。"""
from test_flight_plugin import assert_ts_passed


def test_intent_verdict_module():
    # Given: 假 Io 的三个世界：check 拒 /r/src/x.py；check 以 2 退出（Traceback boom）；check 全部放行
    # When: 求三次 toolTargets，用空目标调一次 intentVerdict，再在三个世界各用 [/r/src/x.py] 调一次
    # Then: toolTargets 依 spec；空目标不运行命令；世界一 argv 恰为 check 命令且 deny 含路径与原因；世界二 deny 含「意图门禁判定失败」；世界三放行
    assert_ts_passed("intent-verdict-module")
