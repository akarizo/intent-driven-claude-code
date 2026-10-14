"""诊断为「改计划」：读出结论、判计划缺陷、交主会话修订计划（scenario: flight-replan-handoff#*，文档两条除外）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试：core.test.ts（triage-verdict-parsed、plan-defect-*）、prompts.test.ts（replan-prompt-states-bounds）、
flight.test.tsx（band-shows-plan-defect-from-triage）、orchestrator.test.tsx（resume-refused-on-triage-replan、replan-triage-handed-to-main-session、other-verdicts-not-handed-over）。
两条护栏（plan-defect-ignores-other-triage、other-verdicts-not-handed-over）在 base 上已成立：TS 用例规划时预写，包装不带 xfail。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_triage_verdict_parsed():
    # Given: 七段 triage 文本：「根因\n改计划\n草案」「根因\n**改计划**」「根因\n「修插件」」「根因\n\n  人工操作  」「根因\n建议改计划」「只有一行」「根因\n改计划。」
    # When: 逐段调用 triageVerdict
    # Then: 依次为 改计划、改计划、修插件、人工操作、undefined、undefined、undefined
    assert_ts_passed("triage-verdict-parsed")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_plan_defect_from_triage_replan():
    # Given: attempt 1 的 S1 blocked（G1 verify: exit 1）、kind blocked 的 halt，再有 triage「S1 的 owns 漏了 tests/test_x.py\n改计划\n…」
    # When: 求 planDefect
    # Then: 结果为「S1 的 owns 漏了 tests/test_x.py」
    assert_ts_passed("plan-defect-from-triage-replan")


def test_plan_defect_ignores_other_triage():
    # Given: 三份账本：triage 结论为「修插件」；结论「改计划」但之后 attempt 2 已起飞；同 attempt 先「改计划」后「人工操作」
    # When: 各求 planDefect
    # Then: 三份都是 undefined
    assert_ts_passed("plan-defect-ignores-other-triage")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_band_shows_plan_defect_from_triage():
    # Given: gamma 指纹 F 未变；账本 approve F → takeoff F → S1 blocked（G1 verify: exit 1）→ kind blocked 的 halt → triage「S1 的 owns 漏了 tests/test_x.py\n改计划\n草案」；本会话已认领 gamma
    # When: 批准带刷新并绘制
    # Then: 有含「计划需修订」与根因的文字；没有 key 以 resume: 开头的按钮；有 shelve:gamma:<F>
    assert_ts_passed("band-shows-plan-defect-from-triage")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_resume_refused_on_triage_replan():
    # Given: demo 的 attempt 1（本会话、指纹 F）以 kind blocked 的 halt 结束，之后 triage 结论为「改计划」；当前指纹仍为 F
    # When: 人发出 /flight resume demo
    # Then: 回复含「计划需修订」与根因，不含「护栏」「未批准」「计划已变」；账本没有 attempt 2 的 takeoff
    assert_ts_passed("resume-refused-on-triage-replan")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_replan_prompt_states_bounds():
    # Given: change demo、change 目录、判定器目录 /repo/template/.claude/hooks、attempt 2、一段结论为「改计划」的 triage
    # When: 调用 replanPrompt
    # Then: 正文含 demo、attempt 2、triage 全文、只改计划工件与不改生产代码、spec_html.py 与 slice-gate.py lint 的全路径命令、不要发 /opsx-apply、/flight resume、批准修订并续飞、不硬改
    assert_ts_passed("replan-prompt-states-bounds")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_replan_triage_handed_to_main_session():
    # Given: demo 本会话起飞，S1 门禁一律红直到停飞；诊断员回答结论为「改计划」
    # When: 诊断员结束，时钟推进到 clock.after(0)
    # Then: prompt.submit 恰一次，含诊断全文与边界；通知含根因与「已交主会话修订计划」；triage 之后没有新的 approve、takeoff、dispatch
    assert_ts_passed("replan-triage-handed-to-main-session")


def test_other_verdicts_not_handed_over():
    # Given: 同上，但诊断员回答结论为「修插件」
    # When: 诊断员结束，时钟推进到 clock.after(0)
    # Then: prompt.submit 没有收到提交；有含根因的通知，且没有通知含「已交主会话」
    assert_ts_passed("other-verdicts-not-handed-over")
