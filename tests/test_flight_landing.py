"""flight 评审回收与落地接线（scenario: flight-findings-intake#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试见 template/plugins/flight/tests/landing.test.tsx。flight-gate-speedup 的 S4 在末尾追加了 2 个 final-gate-fastpath#* 骨架。"""
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
    # Then: 账本依次追加 final（ok true）与 land（ready）；运行了 /flight:pr-ship --worktree /repo/.worktrees/demo --change-dir template/openspec/changes/demo --judges /repo/template/.claude/hooks
    assert_ts_passed("landing-runs-pr-ship")


def test_final_red_halts():
    # Given: change worktree 的 final ok false、failed [G2 lint]
    # When: 推进飞行
    # Then: 账本追加 final（ok false）与 halt（含 G2 lint）；没有运行 /flight:pr-ship
    assert_ts_passed("final-red-halts")


def test_landing_stops_when_ledger_unreadable():
    # Given: 账本有未闭环的 HIGH，但 ledger.py show 以 1 退出
    # When: drive 交来 land 动作
    # Then: 不写 review-findings.json、不运行 /flight:pr-ship、账本无新增、提示「账本读取失败」
    assert_ts_passed("landing-stops-when-ledger-unreadable")

# ---------------------------------------------------------------- flight-hardening
# flight-hardening S2 的 scenario 测试。


def test_landing_prints_flight_record():
    # Given: 全部合回、评审有结果、final 绿；timeline report 输出「批准 → apply 完成：12.0 min」；各 agent 实际模型都是 claude-opus-5-5、主模型 opus
    # When: 执行落地动作
    # Then: Ctx.log 收到含「飞行记录 · demo」「批准 → apply 完成：12.0 min」「路由对账：一致」的文本，且在运行 /flight:pr-ship 之前
    assert_ts_passed("landing-prints-flight-record")


def test_halt_prints_flight_record():
    # Given: timeline report 输出「门禁红次数：2」
    # When: 执行停飞动作（原因「final 红：G2 lint」）
    # Then: Ctx.log 收到含「停飞 · demo：final 红：G2 lint」与「门禁红次数：2」的文本
    assert_ts_passed("halt-prints-flight-record")


def test_fixer_dispatch_commits_records_first():
    # Given: change 目录的 slices/_interfaces.md 有未提交改动
    # When: 派发修复 agent
    # Then: 「chore(flight): 记录」的 git commit 排在修复 worktree 的 git worktree add 之前
    assert_ts_passed("fixer-dispatch-commits-records-first")

# ---------------------------------------------------------------- flight-envelope S2
# flight-envelope S2 的 scenario 测试。


def test_land_handoff_failure_keeps_landing():
    # Given: 全部合回、final 绿；运行 /flight:pr-ship 抛出「no command named /flight:pr-ship in this session」
    # When: 执行落地动作
    # Then: 落地动作不抛错，账本末条为 land；toast 含「手动运行 /flight:pr-ship」，Ctx.log 收到含「/flight:pr-ship」的文本
    assert_ts_passed("land-handoff-failure-keeps-landing")


def test_flight_record_survives_report_throw():
    # Given: 全部合回、final 绿；timeline report 时 io.run 抛错「spawn ENOENT」
    # When: 执行落地动作
    # Then: Ctx.log 收到含「（timeline report 失败：spawn ENOENT）」的文本，且先 log 后运行 /flight:pr-ship
    assert_ts_passed("flight-record-survives-report-throw")


def test_flight_record_shows_exit_code():
    # Given: timeline report 以 2 退出、stderr 为空
    # When: 执行停飞动作
    # Then: Ctx.log 收到含「（timeline report 失败：exit 2）」的文本
    assert_ts_passed("flight-record-shows-exit-code")


# ---------------------------------------------------------------- flight-gate-speedup · final-gate-fastpath#landing-* / fixer-*

def test_landing_final_requests_fix_reuse():
    # Given: S1 已合回、评审结果为空列表
    # When: 推进飞行到 final
    # Then: slice-gate.py final 的调用在 change worktree 里运行，参数含 --reuse-fix
    assert_ts_passed("landing-final-requests-fix-reuse")


def test_fixer_stop_final_never_reuses():
    # Given: 修复 agent F 已派发，worktree 为修复 worktree
    # When: 处理 F 的收口
    # Then: slice-gate.py final 的调用在修复 worktree 里运行，参数不含 --reuse-fix
    assert_ts_passed("fixer-stop-final-never-reuses")

# ---------------------------------------------------------------- flight-entry-handoff


def test_landing_hands_off_to_flight_pr_ship():
    # Given: demo 全部合回、final 绿；change worktree /repo/.worktrees/demo、change 目录 template/openspec/changes/demo、判定器 /repo/template/.claude/hooks
    # When: 执行落地；另一个世界里运行命令抛「no command named /flight:pr-ship」后执行落地
    # Then: 运行的命令恰为 flight:pr-ship --worktree /repo/.worktrees/demo --change-dir template/openspec/changes/demo --judges /repo/template/.claude/hooks；失败时账本末条为 land、toast 含「请手动运行 /flight:pr-ship --worktree /repo/.worktrees/demo」
    assert_ts_passed("landing-hands-off-to-flight-pr-ship")

# ---------------------------------------------------------------- flight-ship-ledger
# 骨架：S3 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S3：同名 TS 测试尚未实现")
def test_whole_review_dispatch_records_range():
    # Given: 主 worktree HEAD 为 m0，merge-base c9 m0 输出 b0；另一世界 merge-base 退出 1
    # When: 执行派发评审员（slice whole、mode whole、commit c9）；再执行修复体动作（slice fix-r1）并让它收口
    # Then: 提示词含 git diff b0 c9，dispatch 带 commit c9、base b0；另一世界记 blocked review:whole（算不出全量评审的起点）且未派发；修复体 worktree flight-demo-fix-r1、branch flight/demo/fix-r1、收口门禁 slice fix-r1
    assert_ts_passed("whole-review-dispatch-records-range")
