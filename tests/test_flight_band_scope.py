"""批准带会话作用域（scenario: flight-band-session-scope#band-hides-unclaimed / read-does-not-claim / write-claims-change / command-claims-change）。
断言插件里同名的 TS 测试通过。骨架：S1 写好 TS 用例并实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="flight-band-session-scope S1 未实现")
def test_band_hides_unclaimed():
    # Given: 主 worktree 里有待批准的 demo（有 spec.html、tasks.md 有未勾选项、账本无批准）；本会话没写过 demo 的目录、也没发过点名 demo 的命令
    # When: 会话启动后绘制输入框上方区域
    # Then: 批准带不显示（没有 demo、没有任何按钮）；plan_fp.py 没有以 demo 的目录运行
    assert_ts_passed("band-hides-unclaimed")


@pytest.mark.xfail(strict=True, reason="flight-band-session-scope S1 未实现")
def test_read_does_not_claim():
    # Given: 主 worktree 里有待批准的 demo，会话已启动，批准带不显示
    # When: 本会话用 Bash 运行 cat <demo>/tasks.md 与 grep -n x <demo>/proposal.md，主会话一轮结束
    # Then: 批准带仍不显示
    assert_ts_passed("read-does-not-claim")


@pytest.mark.xfail(strict=True, reason="flight-band-session-scope S1 未实现")
def test_write_claims_change():
    # Given: 主 worktree 里有待批准的 demo 与 beta，会话已启动，批准带不显示
    # When: 本会话用 Write 写 <demo>/proposal.md，主会话一轮结束；再用 Bash 运行 touch <beta>/tasks.md，主会话一轮结束
    # Then: 第一轮后批准带显示 demo 与「批准起飞」、没有「另有」；第二轮后显示「另有 1 个待批准」
    assert_ts_passed("write-claims-change")


@pytest.mark.xfail(strict=True, reason="flight-band-session-scope S1 未实现")
def test_command_claims_change():
    # Given: 主 worktree 里有待批准的 demo 与 beta，会话已启动，批准带不显示
    # When: 插件来源发出 /flight status beta；随后人在终端（composer）发出 /flight status demo，命令返回，期间没有主会话一轮结束
    # Then: 前者之后批准带仍不显示；后者返回后批准带显示 demo 与「批准起飞」、没有「另有」
    assert_ts_passed("command-claims-change")
