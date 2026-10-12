"""flight-entry-handoff 的文档（scenario: flight-entry-docs#docs-reference-plugin-ship）。骨架：S5 实现后去掉 xfail 标记。"""
import re

from conftest import ROOT

LEGACY = "template/.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md"
DOCS = ("README.md", "docs/WORKFLOW_zh.md", LEGACY, "CLAUDE.md")
BARE = re.compile(r"(?<![\w:])/pr-ship")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_docs_reference_plugin_ship():
    # Given: README.md、docs/WORKFLOW_zh.md、legacy skill 与 CLAUDE.md
    docs = {rel: read(rel) for rel in DOCS}

    # When: 找不带 flight: 前缀的 /pr-ship
    bare = {rel: BARE.findall(d) for rel, d in docs.items()}

    # Then: 四份都没有、都含 /flight:pr-ship；README、WORKFLOW、legacy 含 flight:code-reviewer；README 与 WORKFLOW 不再指向 .claude/agents/code-reviewer.md
    assert all(not v for v in bare.values()), bare
    assert all("/flight:pr-ship" in d for d in docs.values())
    assert all("flight:code-reviewer" in docs[rel] for rel in ("README.md", "docs/WORKFLOW_zh.md", LEGACY))
    assert all(".claude/agents/code-reviewer.md" not in docs[rel] for rel in ("README.md", "docs/WORKFLOW_zh.md"))
