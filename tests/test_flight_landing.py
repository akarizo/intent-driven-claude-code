"""flight 评审回收与落地接线（scenario: flight-findings-intake#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试见 template/plugins/flight/tests/landing.test.tsx。"""
import pytest

from test_flight_plugin import assert_ts_passed


def test_findings_tool_accepts_flight_reviewer():
    # Given: 当前飞行里 R 以 reviewer、S1 被派发
    # When: R 调用 submit_findings（1 条 HIGH）
    # Then: 账本追加 review（slice S1、agent R、那 1 条）；工具返回字符串
    assert_ts_passed("findings-tool-accepts-flight-reviewer")


def test_findings_tool_denies_others():
    # Given: 当前飞行里 A 是 S1 的执行体
    # When: 主会话与 A 各调用一次 submit_findings
    # Then: 两次都被拒绝，理由含「只有本次飞行派发的评审员」；账本无新增
    assert_ts_passed("findings-tool-denies-others")


def test_reviewer_stop_without_findings_blocks_once():
    # Given: S1 的评审员 R 没有调用过 submit_findings
    # When: R 两次收口，随后结束
    # Then: 第一次 block（含 submit_findings 与「空列表」），第二次放行；结束后账本追加 blocked review:S1（infra）
    assert_ts_passed("reviewer-stop-without-findings-blocks-once")


def test_fixer_stop_runs_final():
    # Given: 修复 agent F 收口，修复 worktree 里 final ok false、failed [G7 demo#s3]
    # When: 处理 F 的收口
    # Then: 回答 block 且含 G7 demo#s3；账本追加 slice 为 fix 的 gate（ok false）
    assert_ts_passed("fixer-stop-runs-final")


def test_landing_runs_pr_ship():
    # Given: 全部合回、评审有结果、无阻断、final 绿、ship 为 ready
    # When: 推进飞行
    # Then: 账本依次追加 final（ok true）与 land（ready）；运行了 /pr-ship demo
    assert_ts_passed("landing-runs-pr-ship")


def test_final_red_halts():
    # Given: change worktree 的 final ok false、failed [G2 lint]
    # When: 推进飞行
    # Then: 账本追加 final（ok false）与 halt（含 G2 lint）；没有运行 /pr-ship
    assert_ts_passed("final-red-halts")


def test_landing_stops_when_ledger_unreadable():
    # Given: 账本有未闭环的 HIGH，但 ledger.py show 以 1 退出
    # When: drive 交来 land 动作
    # Then: 不写 review-findings.json、不运行 /pr-ship、账本无新增、提示「账本读取失败」
    assert_ts_passed("landing-stops-when-ledger-unreadable")
