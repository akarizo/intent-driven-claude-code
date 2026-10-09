"""flight 合回与收口过程（scenario: flight-integration#*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。"""
from test_flight_plugin import assert_ts_passed


def test_land_merges_green_slice():
    # Given: S1 门禁绿，change 目录有未提交的 gate-report.md，owns 含 src/a.py（有 def run(x):）
    # When: 合回 S1
    # Then: 依次提交飞行记录、merge --no-ff、record --json；_interfaces.md 的 S1 一节含 def run(x):；返回 ok 与合并 commit
    assert_ts_passed("land-merges-green-slice")


def test_land_aborts_conflict_and_prepares_resolver():
    # Given: 合回 S2 时 git merge 非 0，未合并文件 a.py
    # When: 合回 S2
    # Then: merge --abort；建 flight-demo-S2-resolve 并在其中重做合并；返回冲突文件 [a.py]
    assert_ts_passed("land-reports-conflict-and-aborts")
    assert_ts_passed("land-aborts-conflict-and-prepares-resolver")


def test_land_fast_forwards_after_resolution():
    # Given: 解冲突 worktree 无未合并文件、HEAD 有两个父提交 / 仍有未合并文件
    # When: 完成 S2 的合回
    # Then: 前者 change worktree 里 merge --ff-only flight/demo/S2-resolve；后者返回失败且未 --ff-only
    assert_ts_passed("land-fast-forwards-after-resolution")
    assert_ts_passed("land-refuses-ff-with-unmerged-files")


def test_land_validates_findings():
    # Given: findings 第 2 项 severity 为 SEVERE；另一份为空列表
    # When: 校验
    # Then: 前者拒绝且理由含「第 2 项」与 severity；空列表接受
    assert_ts_passed("land-validates-findings")
    assert_ts_passed("land-accepts-empty-findings")


def test_land_closeout_writes_records():
    # Given: S1、S2 已合回，S3 blocked（gate），阻断 0，deferred 1 条 LOW，无修复
    # When: 落地收口
    # Then: review-findings.json 形状正确；tasks.md 勾 S1、S2 不勾 S3；跑了 apply-done、收口提交与 ship 并返回裁决
    assert_ts_passed("land-closeout-writes-records")
