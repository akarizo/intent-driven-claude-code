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


def test_bash_runs_in_own_worktree():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: agent-1 调用 Bash git status
    # Then: 执行端收到的命令为 cd '<S1 worktree>' && git status
    assert_ts_passed("bash-runs-in-own-worktree")


def test_commit_outside_own_worktree_denied():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: agent-1 调用 Bash git -C <change worktree> commit -m x
    # Then: tool.call 答 deny，理由含「自己的 worktree」
    assert_ts_passed("commit-outside-own-worktree-denied")


def test_read_outside_repo_not_upgraded():
    # Given: demo 已起飞，S1 执行体 agent-1 已派发
    # When: 引擎对 agent-1 的 Read ~/.ssh/id_rsa 与 Read <S1 worktree>/a.py 都判 ask
    # Then: 前者原样返回 ask，后者改答 allow
    assert_ts_passed("read-outside-repo-not-upgraded")


def test_pending_agent_writes_denied():
    # Given: demo 已起飞，agent-1 已派发但 dispatch 事件没能写入账本
    # When: agent-1 调用 Write <S1 worktree>/src/s1.py
    # Then: tool.call 答 deny，理由含「登记中」
    assert_ts_passed("pending-agent-writes-denied")


def test_takeoff_refuses_old_git():
    # Given: demo 已批准，git --version 输出 git version 2.37.1
    # When: 人发出 /opsx-apply demo
    # Then: 回复含「git ≥ 2.38」，账本没有 takeoff
    assert_ts_passed("takeoff-refuses-old-git")

# ---------------------------------------------------------------- flight-measure
# 同名 TS 测试在 template/plugins/flight/tests/orchestrator.test.tsx。


def test_measure_tool_records_event():
    # Given: demo 在飞，agent-1 是 S1 的执行体，dispatch 记有 base B；测量应答为一个目标 FAILED、source 为空
    # When: agent-1 调用 mcp__flight__measure
    # Then: 执行端收到 slice-gate measure S1 --base B（cwd 为其 worktree）；账本新增 agent-1 的 measure；结果含 FAILED 与「见红」
    assert_ts_passed("measure-tool-records-event")


def test_measure_tool_only_for_flight_executors():
    # Given: demo 在飞；agent-2 是 S1 的评审员；agent-x 不属于任何飞行
    # When: 两者分别调用 mcp__flight__measure
    # Then: 都被拒（理由含「只有本次飞行的执行体可以请求测量」），没有运行测量、没有新增 measure
    assert_ts_passed("measure-tool-only-for-flight-executors")


def test_measure_tool_upgraded_for_executor():
    # Given: demo 在飞；引擎对 mcp__flight__measure 判 ask
    # When: tool.check 处理执行体 agent-1 与评审员 agent-2 的调用
    # Then: agent-1 为 allow，agent-2 仍为 ask
    assert_ts_passed("measure-tool-upgraded-for-executor")


def test_fresh_dispatch_takes_start_measure():
    # Given: demo 起飞，S1 的切片 worktree 新建、start 打印 base B；S2 的测量应答为退出 1
    # When: 控制面派发 S1 与 S2 的执行体
    # Then: S1 的 dispatch 测量（agent=dispatch、base=B）先于带 base 的 dispatch 写入；S2 记 blocked 且含「起点测量失败」，未派发
    assert_ts_passed("fresh-dispatch-takes-start-measure")


def test_gate_runs_with_ledger_evidence():
    # Given: S1 的 start 打印 base B；另一次飞行 S2 合回冲突，执行体 base B2、解冲突 start 打印 R
    # When: S1 执行体收口；解冲突 agent 收口
    # Then: start 带 --evidence ledger；S1 门禁带 --evidence ledger --base B；解冲突门禁带 --base R --measure-base B2
    assert_ts_passed("gate-runs-with-ledger-evidence")


def test_takeoff_checks_versions():
    # Given: demo 已批准、其余起飞检查都过；CLAUDE_CONFIG_DIR 为 C，C 下没有 installed_plugins.json
    # When: 两次起飞：ledger.py events 缺 measure；ledger.py events 列出全部类型
    # Then: 第一次回复含「主检出」且账本无新事件；第二次回复含「✈ 起飞」「插件 」「已安装版本未核对」、读取过 C/plugins/installed_plugins.json、新增 takeoff
    assert_ts_passed("takeoff-checks-versions")


def test_unknown_owner_fails_closed():
    # Given: demo 在飞；对 agent-7 的账本读取失败
    # When: agent-7 调用 Write 与 Bash，引擎对 Bash 判 ask
    # Then: Write 与 Bash 都被拒（理由含「归属判定失败」）；tool.check 仍为 ask
    assert_ts_passed("unknown-owner-fails-closed")

# ---------------------------------------------------------------- flight-measure-followups
# 同名 TS 测试见 orchestrator.test.tsx 末尾（S5）。


def test_fresh_dispatch_gets_new_worktree():
    # Given: demo 的 S1 在 attempt 1 被 blocked，flight-demo-S1 仍在；attempt 2 起飞
    # When: 派发 S1 执行体，收口绿后合回
    # Then: worktree add -b flight/demo/S1-a2；dispatch 记该 worktree 与分支；提示词含 flight/demo/S1；合回合并 flight/demo/S1-a2
    assert_ts_passed("fresh-dispatch-gets-new-worktree")


def test_continuation_reuses_same_plan_worktree():
    # Given: S1 在 attempt 1（指纹 A）中断，flight-demo-S1 仍在；attempt 2 以同一指纹起飞
    # When: 派发 S1 执行体
    # Then: 没有新的 worktree add，在 flight-demo-S1 续接；dispatch 的 branch 为 flight/demo/S1，提示词含续接说明
    assert_ts_passed("continuation-reuses-same-plan-worktree")


def test_fixer_gets_new_worktree():
    # Given: attempt 1 派过修复体，flight-demo-fix 仍在；attempt 2 切片都已合回、评审有 HIGH
    # When: 派发修复体，收口绿后合回
    # Then: worktree add -b flight/demo/fix-a2；修复体 dispatch 的 branch 为 flight/demo/fix-a2；修复合回合并它
    assert_ts_passed("fixer-gets-new-worktree")


def test_cross_session_takeoff_refused():
    # Given: 账本最新 takeoff 来自 other-session-1234 且未 land / halt
    # When: 本会话发 /opsx-apply demo，再发 /opsx-apply demo --takeover
    # Then: 第一次拒飞（含另一个会话、other-se、--takeover）且无新事件；第二次起飞，takeoff 的 takeover 为原会话 id
    assert_ts_passed("cross-session-takeoff-refused")


def test_halted_attempt_from_other_session_resumes():
    # Given: 账本最新 takeoff 来自 other-session-1234 且该 attempt 已 halt
    # When: 本会话发 /opsx-apply demo
    # Then: 照常起飞，新 takeoff 没有 takeover 字段
    assert_ts_passed("halted-attempt-from-other-session-resumes")


def test_measure_unknown_owner_says_retry():
    # Given: demo 在飞，agent-1 是 S1 执行体；ledger.py show 对 demo 退出 5
    # When: agent-1 调用 mcp__flight__measure
    # Then: 被拒，理由含「暂时无法判定」与「稍后重试」、不含「只有本次飞行的执行体」；没有运行测量
    assert_ts_passed("measure-unknown-owner-says-retry")

# ---------------------------------------------------------------- PR #47 评审修复


def test_old_session_stops_driving():
    # Given: 本会话起飞 attempt 1 后，另一个会话以 --takeover 接管（账本有 attempt 2 的 takeoff）
    # When: 本会话 attempt 1 的执行体结束
    # Then: 本会话不再驱动：attempt 2 只有那条 takeoff，没有新的派发
    assert_ts_passed("cross-session-takeoff-refused/old-session-stops-driving")

# ---------------------------------------------------------------- flight-measure-strict
# 骨架：S3 实现后去掉 xfail 标记。


def test_measure_hints_unguarded_pass():
    # Given: demo 在飞，agent-1 是 S1 执行体；测量应答 test_a PASSED、test_b FAILED、source 为空，guards 分别为空与 [test_a]
    # When: agent-1 两次调用 mcp__flight__measure
    # Then: 第一次结果含 test_a、「在改生产代码之前就已通过」「护栏」「不要改坏生产代码造红」；第二次不含「在改生产代码之前就已通过」
    assert_ts_passed("measure-hints-unguarded-pass")

# ---------------------------------------------------------------- flight-retire-workflow-engine
# 骨架：S6（per-task-passes-through 为护栏，已预写、不带 xfail） 实现后去掉 xfail 标记。


def test_engine_workflow_refused():
    # Given: demo 已批准、工作区干净
    # When: 人发出 /opsx-apply demo --engine=workflow
    # Then: 插件作答含「旧 Workflow 引擎已删除」与 DRAFT-flight-single-implementation；命令没到达模型，账本无新事件
    assert_ts_passed("engine-workflow-refused")


def test_per_task_passes_through():
    # Given: demo 已批准（护栏：base 上已成立，规划时预写）
    # When: 人发出 /opsx-apply demo --gate=per-task
    # Then: 命令交给模型（插件不作答），账本无新事件
    assert_ts_passed("per-task-passes-through")

# ---------------------------------------------------------------- flight-interaction
# 骨架：S4 实现后去掉 xfail 标记。


def test_flight_status_prints_progress():
    # Given: 插件已加载，demo 已起飞（attempt 1）
    # When: 发出 /flight status demo 与不带 change 的 /flight status
    # Then: 会话开始时登记过 flight 命令；两次回复都含 demo、attempt 1、W1/2
    assert_ts_passed("flight-status-prints-progress")


def test_flight_abort_stops_agents():
    # Given: demo 已起飞并派出 agent-1、agent-2，agent.list 里都是 running
    # When: 发出 /flight abort demo，随后 agent-1 结束（aborted）
    # Then: 账本有原因含「人工中止」的 halt，排在两次 TaskStop 之前；TaskStop 依次停 agent-1、agent-2；之后没有新的 dispatch 或 merge
    assert_ts_passed("flight-abort-stops-agents")


def test_flight_resume_only_unfinished():
    # Given: 三份账本：没有 takeoff / attempt 1 已落地 / attempt 1 已停飞
    # When: 分别发出 /flight resume demo
    # Then: 前两份拒绝（含 /opsx-apply 或「已落地」）且无新事件；第三份含「续飞」与「✈ 起飞」，有 attempt 2 的 takeoff
    assert_ts_passed("flight-resume-only-unfinished")


def test_panel_opens_at_takeoff():
    # Given: demo 已批准、工作区干净
    # When: 发出 /opsx-apply demo，再请求绘制 Pane flight
    # Then: 插件以 id flight 调用过 ui.open；面板文本含 demo 与 W1/2
    assert_ts_passed("panel-opens-at-takeoff")


def test_abort_during_drive_stops_late_dispatch():
    # Given: 起飞后 drive 派发 S1 执行体时 spawn 被挂起（S2 尚未派发），agent-1 在 agent.list 里 running
    # When: 人发出 /flight abort demo，halt 写入后放行 spawn（PR #50 评审 HIGH）
    # Then: drive 只做完手上的 S1 派发、不再派发 S2；agent-1 被 TaskStop 停下
    assert_ts_passed("abort-during-drive-stops-late-dispatch")


def test_flight_command_human_only():
    # Given: 两份账本：demo attempt 1 在飞（agent-1 running）/ demo attempt 1 已停飞
    # When: 以 scheduled-trigger 来源与不带来源分别发出 /flight abort demo（第一份）、/flight resume demo（第二份），再以 scheduled-trigger 来源发出 /flight status demo（第一份）
    # Then: 四次 abort / resume 都回复「只接受人或宿主程序发出」与所见来源，账本无新事件、没有 TaskStop；status 回复含 demo 与 attempt 1
    assert_ts_passed("flight-command-human-only")

# ---------------------------------------------------------------- flight-entry-handoff
# 骨架：S1 实现后去掉 xfail 标记。


def test_opsx_apply_registered_or_intercepted():
    # Given: 两个世界，demo 都已批准、工作区干净：甲的 command.register 照常应答；乙对 opsx-apply 抛「refused: it is the user's /opsx-apply」
    # When: 各自开始会话，再由人在终端发出 /opsx-apply demo
    # Then: 甲登记的命令排序后恰为 flight、opsx-apply；乙只登记 flight 且会话开始不抛错；两个世界的回复都含「✈ 起飞 demo」
    # 同一 TS 用例里建不了两个世界，拆成同名前缀的两个用例：甲 -registers、乙 -refused
    assert_ts_passed("opsx-apply-registered-or-intercepted-registers")
    assert_ts_passed("opsx-apply-registered-or-intercepted-refused")


def test_ledger_entries_accept_host_origins():
    # Given: demo 已批准、工作区干净
    # When: 依次以 scheduled-trigger、不带来源、sdk 发出 /opsx-apply demo，再以 sdk 发出 /flight abort demo
    # Then: 前两次回复含「只接受人或宿主程序发出」与 scheduled-trigger / 未标明且无新事件；第三次含「✈ 起飞 demo」；第四次后账本有原因含「人工中止」的 halt
    assert_ts_passed("ledger-entries-accept-host-origins")
