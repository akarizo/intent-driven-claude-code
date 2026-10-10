"""起飞时经「授权提交」只提交本 change 的工件（scenario: flight-takeoff-commit#classify-* / takeoff-*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试见 template/plugins/flight/tests/land.test.ts（classify-dirty-paths）与 orchestrator.test.tsx（takeoff-*）。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="S1 未实现：未提交路径按工件机械分类")
def test_classify_dirty_paths():
    # Given: change 目录 template/openspec/changes/demo、scenario 测试文件 tests/test_a.py；未提交 timeline.md、proposal.md、DRAFT-x.md、0001-y.md、tests/test_a.py、src/x.py
    # When: 分类
    # Then: 记录恰为 timeline.md；工件恰为 proposal.md、DRAFT-x.md、tests/test_a.py；工件之外恰为 0001-y.md 与 src/x.py
    assert_ts_passed("classify-dirty-paths")


@pytest.mark.xfail(strict=True, reason="S1 未实现：授权提交时只提交工件后起飞")
def test_takeoff_commits_artifacts_when_authorized():
    # Given: demo 已批准；未提交的只有 proposal.md、DRAFT-x.md 与 scenario 测试文件
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 有一次说明含「工件」的提交、先于 takeoff；git add 的路径恰为这三个；回复含「✈ 起飞」
    assert_ts_passed("takeoff-commits-artifacts-when-authorized")


@pytest.mark.xfail(strict=True, reason="S1 未实现：授权词粘在 change 名后面")
def test_takeoff_accepts_glued_authorization():
    # Given: 同上
    # When: 人发出 /opsx-apply demo授权提交
    # Then: 按 change demo 起飞：有一次说明含「工件」的提交，回复含「✈ 起飞」
    assert_ts_passed("takeoff-accepts-glued-authorization")


@pytest.mark.xfail(strict=True, reason="S1 未实现：起飞守卫未过时不提交（补 TS 覆盖）")
def test_takeoff_never_commits_before_approval():
    # Given: demo 未批准；未提交的只有工件
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 回复含「起飞守卫未通过」；没有任何提交；账本没有 takeoff
    assert_ts_passed("takeoff-never-commits-before-approval")


@pytest.mark.xfail(strict=True, reason="S1 未实现：只有工件时提示授权提交")
def test_takeoff_hints_authorization_for_artifacts():
    # Given: demo 已批准；未提交的只有工件
    # When: 人发出 /opsx-apply demo
    # Then: 回复含「工作区不干净」与 /opsx-apply demo 授权提交；没有提交，账本没有新的 takeoff
    assert_ts_passed("takeoff-hints-authorization-for-artifacts")


@pytest.mark.xfail(strict=True, reason="S1 未实现：有工件之外的改动时只列这些路径")
def test_takeoff_refuses_foreign_dirt_even_authorized():
    # Given: demo 已批准；未提交的有工件，还有 src/x.py
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 回复含「工作区不干净」与 src/x.py、不含工件路径；没有提交，账本没有新的 takeoff
    assert_ts_passed("takeoff-refuses-foreign-dirt-even-authorized")
