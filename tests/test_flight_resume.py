"""批准带续飞与 resume.ts（scenario: flight-halt-handoff#band-offers-resume-for-halted / press-approves-then-resumes / resume-flight-sequence）。
断言插件里同名的 TS 测试通过；骨架：S6 实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


def test_band_offers_resume_for_halted():
    # Given: 甲：已停飞且计划改过；乙：已停飞且计划未改；丙：从未起飞、未批准
    # When: 在 terminal 与 desktop 上让批准带依次显示甲、乙、丙
    # Then: 甲为「批准修订并续飞」且说明行含「提交本 change 的工件」「重跑基线」；乙为「续飞」；丙为「批准起飞」
    assert_ts_passed("band-offers-resume-for-halted")


def test_press_approves_then_resumes():
    # Given: 批准带显示已停飞的甲（计划改过，F2，基线退出 0）与乙（计划未改）
    # When: 按下甲的「批准修订并续飞」与乙的「续飞」，等后台续飞跑完
    # Then: 甲追加 approve fp F2、跑过基线、预填 /opsx-apply 甲 授权提交；乙没有 approve、没跑基线、预填 /opsx-apply 乙 授权提交；通知含「回车续飞」
    assert_ts_passed("press-approves-then-resumes")


def test_resume_flight_sequence():
    # Given: 甲：诊断员 d1 在跑、baseline 绿、takeoff 回复「续飞 attempt 2 …」；乙：baseline 红（S2 verify 红）；丙：计划未改
    # When: 分别调用 resumeFlight（甲乙 replan true、丙 replan false）
    # Then: 甲依次 stopLive、baseline、takeoff（含 demo 与「授权提交」、resume true）并通知「续飞 attempt 2」；乙不起飞、通知「基线红，未续飞」与「S2 verify 红」；丙不跑 baseline、调用 takeoff
    assert_ts_passed("resume-flight-sequence")

# ---------------------------------------------------------------- flight-armed-takeoff S5（骨架：实现后去掉 xfail 标记）

@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S5 未实现")
def test_band_offers_takeoff_for_approved():
    # Given: demo 已批准（最近 approve 晚于最近 takeoff、指纹相同）；有 2 个工件未提交
    # When: 批准带刷新并显示 demo，按下按钮
    # Then: 按钮为「起飞」、说明行含提交本 change 的 2 个工件；按下不追加 approve、以 [demo, 授权提交] 起飞、不预填
    assert_ts_passed("band-offers-takeoff-for-approved")


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S5 未实现")
def test_band_ignores_landed_and_aborted():
    # Given: 甲先 land 后 halt（旧账本）；乙 halt kind abort；丙 halt kind blocked；计划都未改
    # When: 批准带刷新
    # Then: 甲、乙不显示，丙显示「续飞」；stoppedNow 对甲返回 land
    assert_ts_passed("band-ignores-landed-and-aborted")


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S5 未实现")
def test_band_approve_takes_off():
    # Given: demo 未批准，指纹 F
    # When: 按下「批准起飞」，推进时钟让后台起飞跑完
    # Then: 追加 approve fp F；以 [demo, 授权提交] 起飞；toast 含起飞回复首行；不预填
    assert_ts_passed("band-approve-takes-off")


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S5 未实现")
def test_band_resume_takes_off():
    # Given: 甲已停飞、计划改过（F2）、基线退出 0；乙已停飞、计划未改
    # When: 按下甲「批准修订并续飞」与乙「续飞」，推进时钟让后台续飞跑完
    # Then: 甲追加 approve F2、跑过基线、以续飞方式起飞；乙不追加 approve、不跑基线、以续飞方式起飞；不预填；不依赖先后顺序
    assert_ts_passed("band-resume-takes-off")


@pytest.mark.xfail(strict=True, reason="flight-armed-takeoff S5 未实现")
def test_band_resume_stops_diagnostician():
    # Given: 甲已停飞、计划未改；本 attempt 有诊断员 d1 的 dispatch、无 ended；agent 列表里 d1 为 running
    # When: 按下甲「续飞」，推进时钟让后台续飞跑完
    # Then: 起飞之前对 d1 调用了一次 TaskStop
    assert_ts_passed("band-resume-stops-diagnostician")

