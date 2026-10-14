"""预合并冲突、落地后重验、计划缺陷拒续飞、改名行出路（scenario: flight-landing-premerge#premerge-conflict-dispatches-resolver / premerge-resolver-red-halts / recheck-after-land-reruns-final-and-review / recheck-refused-when-fresh，flight-plan-defect-halt#resume-refused-on-plan-defect，flight-small-fixes#rename-refusal-advice）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 包装，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试写在 template/plugins/flight/tests/orchestrator.test.tsx。"""
from test_flight_plugin import assert_ts_passed


def test_premerge_conflict_dispatches_resolver():
    # Given: 收口时 merge-tree 判 origin/main 与 HEAD 在 a.py 冲突；解冲突 agent 收口时 final 门禁绿
    # When: drive 推进，解冲突 agent 结束
    # Then: 依次有 conflicts ["a.py"] 的 premerge、slice premerge 的 resolver dispatch（worktree 含 premerge-resolve）、slice premerge 的 ok merge、final；change worktree 从未 git merge --no-edit origin/main
    assert_ts_passed("premerge-conflict-dispatches-resolver")


def test_premerge_resolver_red_halts():
    # Given: 同上，但解冲突 agent 三次收口的 final 门禁都红
    # When: 解冲突 agent 结束
    # Then: kind premerge 的 halt，原因含 a.py 与「/flight resume」；没有 slice premerge 的 merge，也没有 final
    assert_ts_passed("premerge-resolver-red-halts")


def test_recheck_after_land_reruns_final_and_review():
    # Given: attempt 1 已落地；slice-gate.py ship 的 reasons 含「final 过期」
    # When: 人发出 /flight recheck demo
    # Then: 追加 attempt 2 的 takeoff，随后依次有 premerge、final、全量评审 dispatch；attempt 2 没有 executor dispatch
    assert_ts_passed("recheck-after-land-reruns-final-and-review")


def test_recheck_refused_when_fresh():
    # Given: attempt 1 已落地；slice-gate.py ship 的 reasons 为空
    # When: 人发出 /flight recheck demo
    # Then: 回复含「无需重验」；没有新的 takeoff
    assert_ts_passed("recheck-refused-when-fresh")


def test_resume_refused_on_plan_defect():
    # Given: attempt 1 以 kind blocked 停飞，S1 的 blocked 原因为 G5「在改生产代码之前就已通过」；计划指纹未变，起飞守卫放行
    # When: 人发出 /flight resume demo
    # Then: 回复含「计划需修订」与「在改生产代码之前就已通过」、不含「未批准」「计划已变」；没有 attempt 2 的 takeoff
    assert_ts_passed("resume-refused-on-plan-defect")


def test_rename_refusal_advice():
    # Given: demo 已批准、账本为空；porcelain 只有 `R  <cd>/a.md -> <cd>/b.md` 与 `?? <cd>/proposal.md`
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 回复含「工件之外」、改名行与「git mv」，不含「artifact_files」；没有提交，账本没有 takeoff
    assert_ts_passed("rename-refusal-advice")
