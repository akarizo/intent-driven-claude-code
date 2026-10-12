"""ship 工具纯模块（scenario: flight-ship-tool#ship-*）。
`claude plugin test` 没有 xfail 等价物：每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
骨架：S4 实现后去掉 xfail 标记。"""
import pytest

from test_flight_plugin import assert_ts_passed

# ---------------------------------------------------------------- flight-ship-ledger
# 骨架：S4 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_ship_tool_checks_pr_head():
    # Given: demo 已落地、分支 worktree-demo、HEAD h1、origin github.com；五个世界：头分支不符 / 头 commit 不符 / 未落地 / origin 为 gitlab / pr 为 abc
    # When: 各调用一次 shipPr
    # Then: 五次都 deny（含期望分支 / 先推送 / 还没落地 / 只支持 GitHub）；都没有运行 gh pr comment 与 gh pr ready，账本无新事件
    assert_ts_passed("ship-tool-checks-pr-head")


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_ship_tool_applies_ledger_verdict():
    # Given: demo 已落地、PR 7 头与 HEAD h1 相符；三个世界：ready 且 draft / draft 且非 draft / draft 且 draft
    # When: 各调用一次 shipPr
    # Then: 第一个依次 gh pr view、slice-gate ship、gh pr comment 7、gh pr ready 7 并记 ship 事件（verdict ready、commit h1）；第二个运行 gh pr ready 7 --undo 且评论含 reasons；第三个不切换、记 verdict draft
    assert_ts_passed("ship-tool-applies-ledger-verdict")


@pytest.mark.xfail(strict=True, reason="S4：同名 TS 测试尚未实现")
def test_ship_comment_lists_findings():
    # Given: ship JSON：draft、reasons 1 条、review whole-r1 / r9、blocking 1 条 HIGH、deferred 1 条 MEDIUM；日期 2026-10-13
    # When: 生成评论
    # Then: 依次含裁决、reasons、whole-r1、HIGH 行、MEDIUM 行，末行为「— flight 插件，2026-10-13」
    assert_ts_passed("ship-comment-lists-findings")
