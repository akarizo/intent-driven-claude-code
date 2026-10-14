"""批准带「计划需修订」与命令认领 hook 保留下游错误（scenario: flight-plan-defect-halt#band-shows-plan-defect-without-resume，flight-small-fixes#claim-hook-keeps-downstream-error）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试写在 template/plugins/flight/tests/flight.test.tsx；切片 S5 写好 TS 测试并实现后去掉标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="S5 未实现：批准带显示计划需修订、不给续飞")
def test_band_shows_plan_defect_without_resume():
    # Given: gamma 最新 attempt 以 kind blocked 停飞，同 attempt 的 blocked 原因为 G5「在改生产代码之前就已通过」；计划未改（F）；本会话已认领 gamma
    # When: 批准带刷新并绘制
    # Then: 有含「计划需修订」的文字、没有 key 以 resume: 开头的按钮；有 shelve:gamma:<F>
    assert_ts_passed("band-shows-plan-defect-without-resume")


@pytest.mark.xfail(strict=True, reason="S5 未实现：认领 hook 保留下游错误")
def test_claim_hook_keeps_downstream_error():
    # Given: 插件之下没有 /opsx-propose 的实现（下游以「no implementation for command.run」拒绝；引擎会跳过抛错的 hook，不能用抛错的测试 hook 构造）
    # When: 人发出 /opsx-propose demo
    # Then: 回复含「flight：命令执行出错」与「no implementation for command.run」
    assert_ts_passed("claim-hook-keeps-downstream-error")
