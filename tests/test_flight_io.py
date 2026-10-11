"""flight 副作用层（scenario: flight-io#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
情形拆成同名 TS 测试与其补充测试（gives-up / reuses）。"""
import pytest

from test_flight_plugin import assert_ts_passed


def test_io_runs_judges_from_main_worktree():
    # Given: 主 worktree /repo 只有 template/.claude/hooks/slice-gate.py，change worktree 里也有一份
    # When: 对切片 worktree flight-demo-S1 跑 S1 门禁
    # Then: 运行 python3 /repo/template/.claude/hooks/slice-gate.py gate S1 …，cwd 是切片 worktree
    assert_ts_passed("io-runs-judges-from-main-worktree")


def test_io_appends_event_with_cas_retry():
    # Given: 第一次 update-ref 旧值不符、第二次成功；另一情形三次都不符
    # When: 追加一条 dispatch 事件
    # Then: 前者重读链尾后成功、blob 即事件 JSON；后者返回失败且恰尝试 3 次
    assert_ts_passed("io-appends-event-with-cas-retry")
    assert_ts_passed("io-appends-event-gives-up-after-three-conflicts")


def test_io_creates_or_reuses_slice_worktree():
    # Given: change 分支 worktree-demo，S1 的 worktree 不存在 / 已存在
    # When: 准备 S1 的 worktree
    # Then: 不存在时 git worktree add -b flight/demo/S1 …/flight-demo-S1 worktree-demo；已存在时不 add、返回同一路径
    assert_ts_passed("io-creates-or-reuses-slice-worktree")
    assert_ts_passed("io-reuses-existing-slice-worktree")

# ---------------------------------------------------------------- flight-orchestrator-wiring


def test_io_finds_flight_from_ledger():
    # Given: 进程内无登记；仓库有 refs/flight/demo/ledger（takeoff branch worktree-demo、model opus，agent A 的 dispatch）；worktree 列表 /repo 与 /repo/.worktrees/demo
    # When: 按 agent A 查找飞行，再按未派发过的 agent 查找
    # Then: 前者找到 demo（changeTree /repo/.worktrees/demo、branch worktree-demo、model opus）；后者返回空
    assert_ts_passed("io-finds-flight-from-ledger")
    assert_ts_passed("io-finds-flight-from-ledger/unknown-agent")


def test_io_finds_flight_when_change_dir_only_in_change_worktree():
    # Given: 进程内无登记；change 目录只在 change worktree /repo/.worktrees/demo 下存在，主 worktree 下没有
    # When: 按 agent a1 查找飞行
    # Then: 找到 demo，changeTree 为 /repo/.worktrees/demo
    assert_ts_passed("io-finds-flight-from-ledger/change-dir-only-in-change-worktree")


def test_io_cas_rereads_tip():
    # Given: 第一次读到链尾 T1、update-ref 旧值不符；第二次读到 T2、update-ref 成功
    # When: 追加一条事件
    # Then: 链尾读两次；第二次 commit-tree 以 T2 为父；两次 update-ref 旧值依次为 T1、T2
    assert_ts_passed("io-cas-rereads-tip")


def test_io_refuses_invalid_event():
    # Given: fp 为空串的 takeoff 事件；缺 agent 的 dispatch 事件（PR #39 评审 HIGH）
    # When: 分别追加
    # Then: 都返回 false，没有任何 git 调用
    assert_ts_passed("io-refuses-invalid-event")
    assert_ts_passed("io-refuses-invalid-event/dispatch-without-agent")

# ---------------------------------------------------------------- flight-hardening
# flight-hardening S2 的 scenario 测试。


def test_io_refuses_prototype_ev():
    # Given: 两条事件的 ev 分别为 toString 与 constructor，其余公共字段合法
    # When: 分别追加
    # Then: 都返回 false，没有任何 git 调用
    assert_ts_passed("io-refuses-prototype-ev")

# ---------------------------------------------------------------- flight-envelope-tightening S3


def test_owner_pending_until_dispatch():
    # Given: markPending('agent-9', 'demo')
    # When: 查询 agent-9 归属；写入其 dispatch（S2、W2）后再查
    # Then: 第一次为登记中（change demo）；第二次为 executor / S2 / W2 的正式归属
    assert_ts_passed("owner-pending-until-dispatch")


def test_owner_miss_cached_until_dispatch():
    # Given: 账本里没有 agent-x 的 dispatch
    # When: 连查两次 agent-x；写入任一 dispatch 后再查一次
    # Then: 第二次不读账本；dispatch 写入后的查询重新读账本
    assert_ts_passed("owner-miss-cached-until-dispatch")

# ---------------------------------------------------------------- flight-measure
# 骨架：S5 实现后去掉 xfail 标记。


def test_ledger_read_failure_not_cached():
    # Given: demo 是本进程登记的在飞飞行；ledger.py show 第一次退出 5、之后返回含 agent-7 dispatch 的账本
    # When: 连续两次查询 agent-7 的归属
    # Then: 第一次为判不出且带原因；第二次为 demo / executor / S1 / W1
    assert_ts_passed("ledger-read-failure-not-cached")


def test_measure_event_checked_before_write():
    # Given: 一条字段齐全的 measure 与一条缺 base 的 measure
    # When: 分别 eventProblem 与 appendEvent
    # Then: 前者合规且写入；后者原因含「measure 的 base」、不写入、不调用 git hash-object
    assert_ts_passed("measure-event-checked-before-write")
    assert_ts_passed("measure-event-checked-before-write/reason")
    assert_ts_passed("measure-event-checked-before-write/bad-outcome")
    assert_ts_passed("event-types-exported")
