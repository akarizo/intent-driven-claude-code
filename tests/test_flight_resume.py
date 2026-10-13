"""批准带续飞与 resume.ts（scenario: flight-halt-handoff#band-offers-resume-for-halted / press-approves-then-resumes / resume-flight-sequence）。
断言插件里同名的 TS 测试通过；骨架：S6 实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="flight-unattended S6 未实现")
def test_band_offers_resume_for_halted():
    # Given: 甲：已停飞且计划改过；乙：已停飞且计划未改；丙：从未起飞、未批准
    # When: 在 terminal 与 desktop 上让批准带依次显示甲、乙、丙
    # Then: 甲为「批准修订并续飞」且说明行含「提交本 change 的工件」「重跑基线」；乙为「续飞」；丙为「批准起飞」
    assert_ts_passed("band-offers-resume-for-halted")


@pytest.mark.xfail(strict=True, reason="flight-unattended S6 未实现")
def test_press_approves_then_resumes():
    # Given: 批准带显示已停飞的甲（计划改过，F2）与乙（计划未改）；resumeFlight 由替身记录
    # When: 按下甲的「批准修订并续飞」与乙的「续飞」
    # Then: 甲追加 approve fp F2、替身收到 replan true、未预填；乙没有 approve、替身收到 replan false
    assert_ts_passed("press-approves-then-resumes")


@pytest.mark.xfail(strict=True, reason="flight-unattended S6 未实现")
def test_resume_flight_sequence():
    # Given: 甲：诊断员 d1 在跑、baseline 绿、takeoff 回复「续飞 attempt 2 …」；乙：baseline 红（S2 verify 红）；丙：计划未改
    # When: 分别调用 resumeFlight（甲乙 replan true、丙 replan false）
    # Then: 甲依次 stopLive、baseline、takeoff（含 demo 与「授权提交」、resume true）并通知「续飞 attempt 2」；乙不起飞、通知「基线红，未续飞」与「S2 verify 红」；丙不跑 baseline、调用 takeoff
    assert_ts_passed("resume-flight-sequence")
