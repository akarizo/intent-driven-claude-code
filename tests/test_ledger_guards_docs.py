"""flight-ledger-guards 的文档（scenario: flight-ledger-docs#*）。"""
import re

from conftest import ROOT


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _section(text, start_pat, end_pat):
    m = re.search(start_pat, text, re.M)
    assert m, start_pat
    rest = text[m.end():]
    e = re.search(end_pat, rest, re.M)
    return rest[: e.start()] if e else rest


def test_pr_ship_docs_follow_ledger():
    # Given: template/plugins/flight/commands/pr-ship.md
    # When: 读取全文、第 7 步与 Output Summary 段
    # Then: 全文不含 timeline.py record；第 7 步含 glab mr create --draft 与「只支持 GitHub」；Output Summary 含「见 ship 评论」且「已自动修复」所在行含「飞行外」
    text = read("template/plugins/flight/commands/pr-ship.md")
    step7 = _section(text, r"^\s*(#+\s*)?7[.、）)]", r"^\s*(#+\s*)?8[.、）)]")
    summary = _section(text, r"^\**Output Summary", r"^\*\*Guardrails")
    fixed_lines = [ln for ln in summary.splitlines() if "已自动修复" in ln]

    assert "timeline.py record" not in text
    assert "glab mr create --draft" in step7
    assert "只支持 GitHub" in step7
    assert "见 ship 评论" in summary
    assert fixed_lines and all("飞行外" in ln for ln in fixed_lines)


def test_apply_docs_and_iron_rules():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md、README.md、docs/WORKFLOW_zh.md、CLAUDE.md
    # When: 读取全文
    # Then: 命令与 skill 不含 timeline.py record 与「起飞只接受人发出的命令」且含「从账本生成」与「Bash」；README 与 WORKFLOW 含「从账本生成」；铁律 11 含 $.session.model() 与 session-model.py
    apply_docs = [
        read("template/.claude/commands/opsx-apply.md"),
        read("template/.claude/skills/openspec-apply-change/SKILL.md"),
    ]
    readme = read("README.md")
    workflow = read("docs/WORKFLOW_zh.md")
    rule11 = [ln for ln in read("CLAUDE.md").splitlines() if ln.startswith("11. ")]

    assert all("timeline.py record" not in t for t in apply_docs)
    assert all("起飞只接受人发出的命令" not in t for t in apply_docs)
    assert all("从账本生成" in t for t in apply_docs)
    assert all("Bash" in t for t in apply_docs)
    assert "从账本生成" in readme
    assert "从账本生成" in workflow
    assert len(rule11) == 1 and "$.session.model()" in rule11[0] and "session-model.py" in rule11[0]
