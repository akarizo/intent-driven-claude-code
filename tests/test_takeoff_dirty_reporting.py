"""起飞时的未提交改动：改名行归为工件之外、逐行列出工件（scenario: takeoff-dirty-reporting#rename-refused-before-any-commit / refusal-lists-artifact-paths / takeoff-reply-lists-committed-artifacts）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试写在 template/plugins/flight/tests/orchestrator.test.tsx。"""
from test_flight_plugin import assert_ts_passed


def test_rename_refused_before_any_commit():
    # Given: demo 已批准、账本为空；porcelain 有 X 位改名 `R  <cd>/a.md -> <cd>/b.md`、Y 位改名 ` R <cd>/c.md -> <cd>/d.md` 与 `?? <cd>/proposal.md`
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 回复含「工作区不干净」「工件之外」与两条改名行；没有任何 git add / commit；账本没有 takeoff
    assert_ts_passed("rename-refused-before-any-commit")


def test_refusal_lists_artifact_paths():
    # Given: demo 已批准、账本为空；未提交的只有 <cd>/proposal.md、template/openspec/adr/DRAFT-x.md 与 tests/test_s1.py
    # When: 人发出 /opsx-apply demo（不带授权词）
    # Then: 回复含「工作区不干净」与 `/opsx-apply demo 授权提交`，三个路径各占一行；没有提交；账本没有 takeoff
    assert_ts_passed("refusal-lists-artifact-paths")


def test_takeoff_reply_lists_committed_artifacts():
    # Given: 同上
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 回复含「✈ 起飞」「已提交工件 3 个文件」，三个路径各占一行
    assert_ts_passed("takeoff-reply-lists-committed-artifacts")
