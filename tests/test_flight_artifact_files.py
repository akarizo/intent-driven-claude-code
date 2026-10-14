"""计划声明的周边文件按工件起飞提交；工件之外拒绝给出路（scenario: flight-takeoff-artifact-files#classify-* / takeoff-* / band-* / foreign-*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
同名 TS 测试见 template/plugins/flight/tests/land.test.ts（classify-declared-artifact-files）、orchestrator.test.tsx（takeoff-* / foreign-*）、flight.test.tsx（band-*）。
骨架：S1 实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_classify_declared_artifact_files():
    # Given: change 目录 template/openspec/changes/demo、声明文件 tests/helpers.py 与 openspec/adr/INDEX.md；未提交 tests/helpers.py、openspec/adr/INDEX.md、tests/helpers.py.bak、src/x.py
    # When: 分类
    # Then: 工件恰为 tests/helpers.py 与 openspec/adr/INDEX.md；工件之外恰为 tests/helpers.py.bak 与 src/x.py
    assert_ts_passed("classify-declared-artifact-files")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_takeoff_commits_declared_artifacts():
    # Given: demo 已批准；slices.json 的 artifact_files 为 tests/helpers.py 与 openspec/adr/INDEX.md；未提交的有 proposal.md、DRAFT-x.md、scenario 测试文件与这两个声明文件
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 起飞前有一次提交、git add 的路径恰为这 5 个；回复含「✈ 起飞」
    assert_ts_passed("takeoff-commits-declared-artifacts")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_band_counts_declared_artifacts():
    # Given: demo 已批准且从未起飞；未提交的有 change 目录下 proposal.md、design.md 与 artifact_files 声明的 tests/helpers.py
    # When: 读出批准带上 demo 的说明行
    # Then: 说明行含「提交本 change 的 3 个工件」
    assert_ts_passed("band-counts-declared-artifacts")


@pytest.mark.xfail(strict=True, reason="骨架：S1 实现后去掉")
def test_foreign_dirt_refusal_explains_way_out():
    # Given: demo 已批准；未提交的有工件，还有未声明的 src/x.py
    # When: 人发出 /opsx-apply demo 授权提交
    # Then: 回复含「工作区不干净」与 src/x.py、不含工件路径；含「授权提交」「不覆盖」「撤销」与 artifact_files；没有提交、账本没有 takeoff；classifyRefusal(回复) 为 human
    assert_ts_passed("foreign-dirt-refusal-explains-way-out")
