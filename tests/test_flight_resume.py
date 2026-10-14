"""批准带续飞与 resume.ts（scenario: flight-halt-handoff#band-offers-resume-for-halted / press-approves-then-resumes / resume-flight-sequence）。
断言插件里同名的 TS 测试通过。"""
from test_flight_plugin import assert_ts_passed


def test_band_offers_resume_for_halted():
    # Given: 甲：已停飞且计划改过；乙：已停飞且计划未改；丙：从未起飞、未批准
    # When: 在 terminal 与 desktop 上让批准带依次显示甲、乙、丙
    # Then: 甲为「批准修订并续飞」且说明行含「提交本 change 的工件」「重跑基线」；乙为「续飞」；丙为「批准起飞」
    assert_ts_passed("band-offers-resume-for-halted")


def test_press_approves_then_resumes():
    # Given: 批准带显示已停飞的甲（计划改过，F2，基线退出 0）与乙（计划未改）
    # When: 按下甲的「批准修订并续飞」与乙的「续飞」，等后台续飞跑完
    # Then: 甲追加 approve fp F2、跑过基线；乙没有 approve、没跑基线；甲乙都直接起飞、不预填；通知含起飞回复首行
    assert_ts_passed("press-approves-then-resumes")


def test_resume_flight_sequence():
    # Given: 甲：诊断员 d1 在跑、baseline 绿、takeoff 回复「续飞 attempt 2 …」；乙：baseline 红（S2 verify 红）；丙：计划未改
    # When: 分别调用 resumeFlight（甲乙 replan true、丙 replan false）
    # Then: 甲依次 stopLive、baseline、takeoff（含 demo 与「授权提交」、resume true）并通知「续飞 attempt 2」；乙不起飞、通知「基线红，未续飞」与「S2 verify 红」；丙不跑 baseline、调用 takeoff
    assert_ts_passed("resume-flight-sequence")

# ---------------------------------------------------------------- flight-armed-takeoff S5


def test_band_offers_takeoff_for_approved():
    # Given: demo 已批准（最近 approve 晚于最近 takeoff、指纹相同）；有 2 个工件未提交
    # When: 批准带刷新并显示 demo，按下按钮
    # Then: 按钮为「起飞」、说明行含提交本 change 的 2 个工件；按下不追加 approve、以 [demo, 授权提交] 起飞、不预填
    assert_ts_passed("band-offers-takeoff-for-approved")


def test_band_ignores_landed_and_aborted():
    # Given: 甲先 land 后 halt（旧账本）；乙 halt kind abort；丙 halt kind blocked；计划都未改
    # When: 批准带刷新
    # Then: 甲、乙不显示，丙显示「续飞」；stoppedNow 对甲返回 land
    assert_ts_passed("band-ignores-landed-and-aborted")
    assert_ts_passed("band-ignores-landed-and-aborted/stopped-now")


def test_band_approve_takes_off():
    # Given: demo 未批准，指纹 F
    # When: 按下「批准起飞」，推进时钟让后台起飞跑完
    # Then: 追加 approve fp F；以 [demo, 授权提交] 起飞；toast 含起飞回复首行；不预填
    assert_ts_passed("band-approve-takes-off")


def test_band_resume_takes_off():
    # Given: 甲已停飞、计划改过（F2）、基线退出 0；乙已停飞、计划未改
    # When: 按下甲「批准修订并续飞」与乙「续飞」，推进时钟让后台续飞跑完
    # Then: 甲追加 approve F2、跑过基线、以续飞方式起飞；乙不追加 approve、不跑基线、以续飞方式起飞；不预填；不依赖先后顺序
    assert_ts_passed("band-resume-takes-off")


def test_band_resume_stops_diagnostician():
    # Given: 甲已停飞、计划未改；本 attempt 有诊断员 d1 的 dispatch、无 ended；agent 列表里 d1 为 running
    # When: 按下甲「续飞」，推进时钟让后台续飞跑完
    # Then: 起飞之前对 d1 调用了一次 TaskStop
    assert_ts_passed("band-resume-stops-diagnostician")

# ---------------------------------------------------------------- flight-armed-followups S5

def test_band_shows_busy_while_taking_off():
    # Given: demo 未批准；takeoff-gate.py 迟迟不答
    # When: 按下「批准起飞」，起飞返回前重绘批准带，随后放行
    # Then: 重绘时 demo 一项含「起飞中…」、没有按钮；放行后不再显示「起飞中…」
    assert_ts_passed("band-shows-busy-while-taking-off")


def test_band_shows_baseline_progress():
    # Given: 甲已停飞、计划改过；基线迟迟不结束；gate.full_suite_sec 为 132
    # When: 按下「批准修订并续飞」，推进 60 秒，再放行基线
    # Then: 状态行含「基线已跑 1 分钟」「上次全量约 2 分钟」，批准带甲一项含「基线运行中」、无按钮；基线只启动一次；放行后不再更新
    assert_ts_passed("band-shows-baseline-progress")


def test_band_dedupe_toast_says_takeoff():
    # Given: 批准带显示「批准起飞」，但同指纹的 approve 已在账本
    # When: 按下「批准起飞」
    # Then: toast 含「已批准（指纹相同），直接起飞」、不含「无需重复按」；随后起飞
    assert_ts_passed("band-dedupe-toast-says-takeoff")

# ---------------------------------------------------------------- flight-dispatch-origin S3（骨架：实现后去掉 xfail 标记）

def test_press_takes_off_before_returning():
    # Given: demo 未批准，批准带显示「批准起飞」
    # When: 按下「批准起飞」，等按键处理返回（期间不推进时钟）
    # Then: 按键返回时账本已有 approve、起飞守卫已以 demo 运行恰一次，起飞回复首行已 toast
    assert_ts_passed("press-takes-off-before-returning")


def test_resume_press_takes_off_before_returning():
    # Given: alpha 已停飞、计划已改，批准带显示「批准修订并续飞」；基线立即以 0 退出
    # When: 按下「批准修订并续飞」，等按键处理返回（期间不推进时钟）
    # Then: 按键返回时基线已对 alpha 运行恰一次、起飞守卫已以 alpha 运行恰一次
    assert_ts_passed("resume-press-takes-off-before-returning")


def test_second_press_while_busy_refused():
    # Given: demo 未批准，批准带显示「批准起飞」；起飞守卫要等放行才作答
    # When: 按「批准起飞」，等到守卫已被调用、尚未作答时再按一次同一按钮，随后放行（期间不推进时钟）
    # Then: 第二次按键在放行前已返回并得到含「正在起飞」的 toast；起飞守卫总共只以 demo 运行一次
    assert_ts_passed("second-press-while-busy-refused")


def test_refresh_failure_clears_busy():
    # Given: demo 已批准、未起飞，批准带显示「起飞」；按键后的第一次重绘读取抛错一次
    # When: 按下「起飞」并等它返回，随后再重绘批准带
    # Then: 起飞守卫已以 demo 运行；重绘后的批准带不含「起飞中…」
    assert_ts_passed("refresh-failure-clears-busy")


def test_baseline_status_restored():
    # Given: alpha 已停飞、计划已改，批准带显示「批准修订并续飞」；基线以 1 退出；没有别的待命与在飞 change
    # When: 按下「批准修订并续飞」并等它返回
    # Then: 最后一次状态行不含「续飞准备中」
    assert_ts_passed("baseline-status-restored")

# ---------------------------------------------------------------- flight-dispatch-followups S2

def test_rapid_second_press_refused():
    # Given: demo 未批准，批准带显示「批准起飞」；plan_fp.py 要等放行后才作答
    # When: 按「批准起飞」，等到 plan_fp.py 已被调用、尚未作答时再按一次同一按钮，随后放行（期间不推进时钟）
    # Then: 第二次按键在放行前已返回并得到含「正在起飞」的 toast；账本只追加一条 approve，起飞守卫只以 demo 运行一次
    assert_ts_passed("rapid-second-press-refused")


def test_replan_duplicate_resumes():
    # Given: alpha 已停飞、计划已改（当前 G），批准带显示「批准修订并续飞」；按下前账本在停飞之后已有指纹 G 的 approve；基线立即以 0 退出
    # When: 按下「批准修订并续飞」并等它返回
    # Then: 有一条 toast 含「已批准（指纹相同），直接续飞」；基线已对 alpha 运行一次，起飞守卫已以 alpha 运行一次
    assert_ts_passed("replan-duplicate-resumes")


def test_other_baseline_line_kept():
    # Given: alpha 与 beta 都已停飞；beta 的「批准修订并续飞」已按下、基线迟迟不结束；alpha 计划未改，显示「续飞」
    # When: 按下 alpha 的「续飞」并等它返回
    # Then: 最后一次状态行含「续飞准备中 beta」
    assert_ts_passed("other-baseline-line-kept")

