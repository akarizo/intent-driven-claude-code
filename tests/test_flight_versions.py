"""flight 插件的版本核对（scenario: flight-version-check#*）。versions.ts 是纯函数，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。"""
import pytest

from test_flight_plugin import assert_ts_passed

# ---------------------------------------------------------------- flight-measure
# S6 已实现：同名 TS 测试在 template/plugins/flight/tests/versions.test.ts。


def test_loaded_matches_installed():
    # Given: 加载目录与 project 条目的 installPath 是同一缓存目录（0.4.0）
    # When: 核对插件副本
    # Then: 通过，文本为「插件 0.4.0」，不含「未核对」
    assert_ts_passed("loaded-matches-installed")


def test_loaded_differs_from_installed():
    # Given: 加载 0.3.2 的缓存目录，project 条目指向 0.4.0 的缓存目录
    # When: 核对插件副本
    # Then: 拒飞，理由含 0.4.0、0.3.2 与 /reload-plugins
    assert_ts_passed("loaded-differs-from-installed")


def test_installed_unverifiable_noted():
    # Given: 四种情形：无 installed_plugins.json、JSON 损坏、无 flight 条目、加载目录不在缓存下
    # When: 分别核对插件副本
    # Then: 都通过，文本都含「已安装版本未核对」与各自原因
    assert_ts_passed("installed-unverifiable-noted")


def test_judges_must_know_events():
    # Given: ledger.py events 的三种应答：全有、缺 measure、退出 2
    # When: 分别核对判定器
    # Then: 第一种通过；第二种拒飞且含 measure 与主检出；第三种拒飞且含判定器过旧
    assert_ts_passed("judges-must-know-events")

# ---------------------------------------------------------------- flight-interaction
# S2 已实现：同名 TS 测试在 template/plugins/flight/tests/versions.test.ts。


def test_takeoff_refuses_stale_judges():
    # Given: 三个判定器目录：features 以 2 退出 / 只列 evidence-ledger-only / 列全三项
    # When: 分别运行 checkJudges
    # Then: 前两个不通过（原因含「判定器过旧」或缺少的能力，并含「主检出」），第三个通过
    assert_ts_passed("takeoff-refuses-stale-judges")

# ---------------------------------------------------------------- flight-ship-ledger
# 骨架：S5 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S5：同名 TS 测试尚未实现")
def test_judges_need_ship_ledger():
    # Given: 判定器 /j4：events 列出全部所需事件，features 只输出 evidence-ledger-only、g5-per-target、guards
    # When: 对 /j4 运行 checkJudges
    # Then: 拒飞，原因含「缺少能力 ship-ledger」与「先把主检出更新到与插件同一版本」
    assert_ts_passed("judges-need-ship-ledger")
