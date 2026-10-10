"""flight 编排接线（scenario: flight-orchestrator#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
骨架：S7 写同名 TS 测试并实现后逐条去掉 xfail 标记。"""
import pytest

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


def test_drive_halts_on_action_exception():
    # Given: S1 合回后派发评审员时 agent.spawn 抛异常
    # When: 处理执行体的结束（turn.complete）
    # Then: 异常不冒到引擎；账本末条为 halt（原因含「动作异常」）
    assert_ts_passed("drive-halts-on-action-exception")


def test_takeoff_refuses_bad_fingerprint():
    # Given: 起飞检查都过，但 plan_fp.py 非 0 退出；另一情形输出不是 64 位十六进制（PR #39 评审 HIGH）
    # When: 人发出 /opsx-apply demo
    # Then: 回复含「计算计划指纹失败」；账本没有事件、没有派发、没有记 approve
    assert_ts_passed("takeoff-refuses-bad-fingerprint")
    assert_ts_passed("takeoff-refuses-bad-fingerprint/not-hex")

# ---------------------------------------------------------------- flight-hardening
# 同名 TS 测试在 template/plugins/flight/tests/orchestrator.test.tsx。


def test_drive_reports_fp_failure_distinctly():
    # Given: 已起飞，之后 plan_fp.py 以 1 退出、stderr「plan_fp 超时」
    # When: 处理 S1 执行体的结束
    # Then: 账本末条 halt 的原因含「计算计划指纹失败」与「plan_fp 超时」、不含「计划指纹已变」；$.ui.log 收到含「停飞 · demo」的文本
    assert_ts_passed("drive-reports-fp-failure-distinctly")


def test_executor_dispatch_commits_records_first():
    # Given: 已起飞，waves [[S1, S2], [S3]]，S1、S2 已合回，change 目录 slices/_interfaces.md 有未提交改动
    # When: drive 派发 S3 的执行体
    # Then: 「chore(flight): 记录」的 git commit 排在 S3 切片 worktree 的 git worktree add 之前
    assert_ts_passed("executor-dispatch-commits-records-first")


def test_takeoff_waits_for_live_agents_after_halt():
    # Given: demo 的 attempt 1 已 halt，它派出的 agent-1 在 agent.list 里仍为 running
    # When: 人再次发出 /opsx-apply demo
    # Then: 回复含「仍在运行」，账本没有新的 takeoff
    assert_ts_passed("takeoff-waits-for-live-agents-after-halt")


def test_merge_survives_missing_interfaces_summary():
    # Given: 已起飞，测试世界的 fs.read 对不存在的文件抛 ENOENT，change 目录还没有 slices/_interfaces.md
    # When: S1 执行体以绿门禁结束
    # Then: 账本有 S1 的 merge 且 ok、没有 halt；_interfaces.md 被写出且含「## S1」
    assert_ts_passed("merge-survives-missing-interfaces-summary")

# ---------------------------------------------------------------- flight-envelope S4
# 同名 TS 测试在 template/plugins/flight/tests/orchestrator.test.tsx。


def test_resume_regates_green_slice():
    # Given: attempt 1 派过 S1 执行体、S1 最近门禁 ok（base B）、无 S1 merge、已 halt；attempt 2 已起飞，S1 worktree 仍在
    # When: drive 处理 attempt 2
    # Then: 跑了带 --base B 的 slice-gate gate S1、没有派发 S1 执行体；账本依次有 gate(regate, ok) 与 merge(S1, ok)
    assert_ts_passed("resume-regates-green-slice")


def test_resume_red_regate_dispatches_with_original_base():
    # Given: 同上，但补跑的门禁为红
    # When: drive 处理 attempt 2
    # Then: 派发了 S1 的续接执行体，派发前的 slice-gate start S1 带 --base B
    assert_ts_passed("resume-red-regate-dispatches-with-original-base")


def test_takeoff_commits_leftover_records():
    # Given: demo 已批准、attempt 1 已 halt；只有 change 目录的 timeline.md 与 gate-report.md 未提交（另一情形还有 src/x.py）
    # When: 人发出 /opsx-apply demo
    # Then: chore(flight): 记录 的提交排在 takeoff 之前、回复含「✈ 起飞」；另一情形回复含「工作区不干净」且没有新 takeoff
    assert_ts_passed("takeoff-commits-leftover-records")
    assert_ts_passed("takeoff-commits-leftover-records/foreign-dirty")


def test_drive_stops_after_terminal_without_fp():
    # Given: attempt 1 已因指纹失败 halt，agent-2 仍在运行，plan_fp.py 仍以 1 退出
    # When: agent-2 结束（turn.complete）
    # Then: 没有运行 plan_fp.py，attempt 1 的 halt 仍只有 1 条
    assert_ts_passed("drive-stops-after-terminal-without-fp")


# ---------------------------------------------------------------- flight-envelope S6
# 同名 TS 测试在 template/plugins/flight/tests/orchestrator.test.tsx。


def test_tool_call_denies_out_of_envelope_write():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发（owns 为 src/s1.py）
    # When: agent-1 Write <S1 worktree>/src/b.py 与 <S1 worktree>/src/s1.py
    # Then: 前者 tool.call 答 deny 且理由含「owns」，后者交给下游执行
    assert_ts_passed("tool-call-denies-out-of-envelope-write")


def test_tool_check_upgrades_ask_only_in_envelope():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: 引擎对 agent-1 包络内的 Write 判 ask / deny / ask 且 ceiling 为 ask；对 agent-1 的 Bash npm install 判 ask；对主会话的 Write 判 ask
    # Then: 只有第一种改答 allow，其余原样返回引擎判定
    assert_ts_passed("tool-check-upgrades-ask-only-in-envelope")


def test_main_session_read_only_during_flight():
    # Given: demo 已起飞（在飞），之后 attempt 1 halt
    # When: 起飞后、停飞前与停飞后，主会话各 Edit 一次 <change worktree>/src/a.py
    # Then: 前者 tool.call 答 deny 且理由含「只读」，后者交给下游执行
    assert_ts_passed("main-session-read-only-during-flight")


def test_agent_spawn_guard_wired():
    # Given: 插件已加载
    # When: 主会话的模型经 Agent 工具派发 subagent_type: flight:executor
    # Then: agent.spawn 答 deny，理由含「控制面」
    assert_ts_passed("agent-spawn-guard-wired")



def test_spawn_prompt_names_worktree():
    # Given: demo 已批准，waves [[S1, S2], [S3]]；引擎派发的 agent 不一定落在 cwd 参数给的目录里
    # When: 人发出 /opsx-apply demo，派发 S1、S2 的执行体
    # Then: 每份提示词写明自己的切片 worktree 绝对路径与 git -C 该路径，不得在别的 worktree 写入或提交
    assert_ts_passed("spawn-prompt-names-worktree")

def test_resume_regate_merges_already_integrated_slice():
    # Given: attempt 1 的 S1 门禁绿且分支已 integrate、账本缺 merge，已 halt；S1 worktree 仍在
    # When: 人再次发出 /opsx-apply demo
    # Then: 不对 S1 运行 merge --no-ff；attempt 2 里 S1 依次为 gate(regate, ok) 与 merge(ok)（R2）
    assert_ts_passed("resume-regate-merges-already-integrated-slice")


def test_agent_spawn_guard_denies_child_of_flight_agent():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: 以非 flight 来源、父 agent 为 agent-1 派发 general-purpose
    # Then: 答 deny 且理由含「不得再派发」（R1 的反向回归）
    assert_ts_passed("agent-spawn-guard-denies-child-of-flight-agent")

# ---------------------------------------------------------------- flight-envelope-tightening S4
# 骨架：S4 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_bash_runs_in_own_worktree():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: agent-1 调用 Bash git status
    # Then: 执行端收到的命令为 cd '<S1 worktree>' && git status
    assert_ts_passed("bash-runs-in-own-worktree")


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_commit_outside_own_worktree_denied():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: agent-1 调用 Bash git -C <change worktree> commit -m x
    # Then: tool.call 答 deny，理由含「自己的 worktree」
    assert_ts_passed("commit-outside-own-worktree-denied")


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_read_outside_repo_not_upgraded():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: 引擎对 agent-1 的 Read ~/.ssh/id_rsa 与 Read <S1 worktree>/a.py 都判 ask
    # Then: 前者原样返回 ask，后者改答 allow
    assert_ts_passed("read-outside-repo-not-upgraded")


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_pending_agent_writes_denied():
    # Given: demo 已起飞，agent-1 已派发但 dispatch 事件没能写入账本
    # When: agent-1 调用 Write <S1 worktree>/src/s1.py
    # Then: tool.call 答 deny，理由含「登记中」
    assert_ts_passed("pending-agent-writes-denied")


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_takeoff_refuses_old_git():
    # Given: demo 已批准，git --version 输出 git version 2.37.1
    # When: 人发出 /opsx-apply demo
    # Then: 回复含「git ≥ 2.38」，账本没有 takeoff
    assert_ts_passed("takeoff-refuses-old-git")

