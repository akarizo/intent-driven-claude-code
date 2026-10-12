"""flight-ship-ledger 的文档（scenario: flight-ship-docs#*）。骨架：S6 实现后去掉 xfail 标记。"""
import pytest

from conftest import ROOT


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="S6：尚未实现")
def test_pr_ship_flight_mode_uses_ship_tool():
    # Given: template/plugins/flight/commands/pr-ship.md
    # When: 切出第 7 步，并取第 8、9、10 步的标题行
    # Then: 第 7 步含「飞行模式」、--draft 与「`ship` 工具」且不含 gh pr ready；第 8–10 步标题都含「飞行外」；全文含「非账本裁决」且不再要求改写 blocking
    pytest.fail("骨架：S6 写实断言")


@pytest.mark.xfail(strict=True, reason="S6：尚未实现")
def test_apply_docs_describe_whole_review():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md、README.md、docs/WORKFLOW_zh.md
    # When: 逐份查找关键词
    # Then: 四份都含「全量评审」与「按账本裁决」；两份 apply 文档含「至多 2 轮」「复核」「`ship` 工具」，且「**来源规则**」各恰好一次
    pytest.fail("骨架：S6 写实断言")
