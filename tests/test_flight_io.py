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
# 骨架：S3 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S3：同名 TS 测试尚未实现")
def test_io_finds_flight_from_ledger():
    # Given: 进程内无登记；仓库有 refs/flight/demo/ledger（takeoff branch worktree-demo、model opus，agent A 的 dispatch）；worktree 列表 /repo 与 /repo/.worktrees/demo
    # When: 按 agent A 查找飞行，再按未派发过的 agent 查找
    # Then: 前者找到 demo（changeTree /repo/.worktrees/demo、branch worktree-demo、model opus）；后者返回空
    assert_ts_passed("io-finds-flight-from-ledger")


@pytest.mark.xfail(strict=True, reason="S3：同名 TS 测试尚未实现")
def test_io_cas_rereads_tip():
    # Given: 第一次读到链尾 T1、update-ref 旧值不符；第二次读到 T2、update-ref 成功
    # When: 追加一条事件
    # Then: 链尾读两次；第二次 commit-tree 以 T2 为父；两次 update-ref 旧值依次为 T1、T2
    assert_ts_passed("io-cas-rereads-tip")
