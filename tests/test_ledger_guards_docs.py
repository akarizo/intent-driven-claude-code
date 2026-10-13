"""flight-ledger-guards 的文档（scenario: flight-ledger-docs#*）。骨架：S9 实现后去掉 xfail 标记。"""
import pytest

from conftest import ROOT


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="S9：尚未实现")
def test_pr_ship_docs_follow_ledger():
    # Given: template/plugins/flight/commands/pr-ship.md
    # When: 读取全文、第 7 步与 Output Summary 段
    # Then: 全文不含 timeline.py record；第 7 步含 glab mr create --draft 与「只支持 GitHub」；Output Summary 含「见 ship 评论」且「已自动修复」所在行含「飞行外」
    pytest.fail("骨架：S9 写实断言")


@pytest.mark.xfail(strict=True, reason="S9：尚未实现")
def test_apply_docs_and_iron_rules():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md、README.md、docs/WORKFLOW_zh.md、CLAUDE.md
    # When: 读取全文
    # Then: 命令与 skill 不含 timeline.py record 与「起飞只接受人发出的命令」且含「从账本生成」与「Bash」；README 与 WORKFLOW 含「从账本生成」；铁律 11 含 $.session.model() 与 session-model.py
    pytest.fail("骨架：S9 写实断言")
