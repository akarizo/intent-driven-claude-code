"""flight 编排接线（scenario: flight-orchestrator#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
骨架：S7 写同名 TS 测试并实现后逐条去掉 xfail 标记。"""
from test_flight_plugin import assert_ts_passed


def test_opsx_apply_taken_over():
    # Given: demo 已批准、worktree 干净、lint/preflight 绿、waves [[S1, S2], [S3]]、session-model.py 输出 opus
    # When: 人发出 /opsx-apply demo
    # Then: 插件作答、模型无回合；账本追加 takeoff 与 S1、S2 的 dispatch；以 flight:executor、opus、各自切片 worktree 派发
    assert_ts_passed("opsx-apply-taken-over")


def test_takeoff_refused_without_approval():
    # Given: takeoff-gate.py 以 3 退出，stderr 为「未批准」
    # When: 人发出 /opsx-apply demo
    # Then: 回复含「未批准」与 spec.html 路径；不写账本、不派发
    assert_ts_passed("takeoff-refused-without-approval")


def test_engine_workflow_passes_through():
    # Given: 插件已加载
    # When: 人发出 /opsx-apply demo --engine=workflow
    # Then: 插件不作答，命令交给模型；不写账本
    assert_ts_passed("engine-workflow-passes-through")


def test_stop_gate_blocks_red_executor():
    # Given: S1 的执行体 A 收口，门禁 ok false、failed [G7 demo#s1]
    # When: 处理 A 的收口
    # Then: 回答 block 且含 G7 demo#s1；账本追加 S1 的 gate（ok false）
    assert_ts_passed("stop-gate-blocks-red-executor")


def test_silent_end_runs_gate_and_respawns():
    # Given: A 未经收口就结束（answer 为空），补跑的门禁为红
    # When: 处理 A 的结束
    # Then: 账本依次追加 ended、gate（ok false）；在 S1 原 worktree 派发新执行体，提示词含「未正常收口」
    assert_ts_passed("silent-end-runs-gate-and-respawns")


def test_conflict_spawns_resolver():
    # Given: S2 门禁绿，合回时冲突（a.py）
    # When: 处理 S2 执行体的结束，再处理解冲突 agent 的收口与结束
    # Then: 以 flight:fixer 在 flight-demo-S2-resolve 派发、提示词含 a.py；其门禁绿并结束后 --ff-only，账本追加 S2 的 merge（ok true）
    assert_ts_passed("conflict-spawns-resolver")


def test_flight_status_line():
    # Given: /opsx-apply demo 已起飞，waves [[S1, S2], [S3]]
    # When: 派发完第一个 wave
    # Then: 状态行含 demo、W1/2 与「运行 2」
    assert_ts_passed("flight-status-line")


def test_flight_types_hidden_from_model():
    # Given: 插件已加载
    # When: 引擎询问是否向模型提供 flight:executor / reviewer / fixer 与 general-purpose
    # Then: 三个飞行类型都不提供；general-purpose 不干预
    assert_ts_passed("flight-types-hidden-from-model")

# ---------------------------------------------------------------- flight-orchestrator-wiring
# 同名 TS 测试在 template/plugins/flight/tests/orchestrator.test.tsx。


def test_takeoff_exception_stays_grounded():
    # Given: 起飞检查全部通过，派发 agent 时抛异常
    # When: 人发出 /opsx-apply demo
    # Then: 插件回复含「异常」，命令没有交给模型
    assert_ts_passed("takeoff-exception-stays-grounded")


def test_drive_hands_landing_actions():
    # Given: S1 门禁绿，合回成功
    # When: 处理 S1 执行体的结束
    # Then: 以 flight:reviewer 在 change worktree 派发评审员；账本追加 role reviewer、slice S1 的 dispatch
    assert_ts_passed("drive-hands-landing-actions")


def test_drive_stops_without_progress():
    # Given: update-ref 一直旧值不符（账本写入总失败）
    # When: 处理一个执行体的结束
    # Then: drive 读账本不超过 2 次就停止
    assert_ts_passed("drive-stops-without-progress")
