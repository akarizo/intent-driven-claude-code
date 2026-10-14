"""批准带「搁置」、读账本用主检出的判定器、逐行列出工件（scenario: flight-band-shelve#shelve-press-writes-event-and-hides / shelve-hides-halted-flight / replanned-shelved-change-reappears / shelve-refused-when-judges-unaware / band-reads-ledger-with-main-judges，takeoff-dirty-reporting#band-lists-artifact-paths）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试写在 template/plugins/flight/tests/flight.test.tsx；切片 S3 写好 TS 测试并实现后去掉标记。"""
from test_flight_plugin import assert_ts_passed


def test_shelve_press_writes_event_and_hides():
    # Given: demo 已批准（最近 approve 晚于最近 takeoff，指纹 F），批准带显示 demo 的「起飞」
    # When: 按下 key 为 shelve:demo:<F> 的按钮
    # Then: 账本追加 ev=shelve、fp=F、by.surface=terminal 的事件；toast 含「已搁置」；刷新后没有任何按钮；起飞守卫没有运行
    assert_ts_passed("shelve-press-writes-event-and-hides")


def test_shelve_hides_halted_flight():
    # Given: gamma 最新 attempt 以 kind=blocked 的 halt 结束、计划未改，批准带显示 gamma 的「续飞」
    # When: 按下 key 为 shelve:gamma:<F> 的按钮
    # Then: 账本追加 fp=F 的 shelve；刷新后没有 gamma；没有跑基线、起飞守卫没有运行
    assert_ts_passed("shelve-hides-halted-flight")


def test_replanned_shelved_change_reappears():
    # 护栏（规划时预写、base 上已通过、不带 xfail）：搁置判定只在指纹相同时隐藏
    # Given: demo 的账本依次有 approve F 与 shelve F；计划改动后当前指纹为 G
    # When: 批准带刷新并绘制
    # Then: 出现 key=approve:demo:<G>、label=批准起飞 的按钮
    assert_ts_passed("replanned-shelved-change-reappears")


def test_shelve_refused_when_judges_unaware():
    # Given: demo 未批准（指纹 F），批准带显示「批准起飞」与「搁置」；ledger.py events 的输出不含 shelve
    # When: 按下 key 为 shelve:demo:<F> 的按钮
    # Then: toast 含「不认识 shelve」与「未搁置」；没有写账本的 git 调用；批准带仍显示 approve:demo:<F>
    assert_ts_passed("shelve-refused-when-judges-unaware")


def test_band_reads_ledger_with_main_judges():
    # Given: 主 worktree /repo 的判定器在 /repo/template/.claude/hooks；/repo/.worktrees/demo（worktree-demo）有未完成的 demo，也自带一份判定器
    # When: 会话启动、批准带刷新
    # Then: 每次 ledger.py 调用的脚本路径都是 /repo/template/.claude/hooks/ledger.py；plan_fp.py 仍取 worktree 自带的
    assert_ts_passed("band-reads-ledger-with-main-judges")


def test_band_lists_artifact_paths():
    # Given: demo 未批准；git status 列出 demo 的 7 个未提交工件 <cd>/f1.md … <cd>/f7.md
    # When: 批准带刷新并绘制
    # Then: 有含「提交本 change 的 7 个工件」的说明行；f1.md 至 f5.md 各一行；有「…另 2 个」；没有含 f6.md 或 f7.md 的文字
    assert_ts_passed("band-lists-artifact-paths")
