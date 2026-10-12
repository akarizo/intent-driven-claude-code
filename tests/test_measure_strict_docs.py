"""flight-measure-strict 的文档（scenario: flight-guard-scenarios#docs-state-guard-rule）。骨架：S4 实现后去掉 xfail 标记。"""
from conftest import ROOT

PLANNING = [
    "template/openspec/schemas/intent-driven/schema.yaml",
    "template/.claude/commands/opsx-propose.md",
    "template/.claude/skills/openspec-propose/SKILL.md",
    "template/.claude/commands/opsx-continue.md",
    "template/.claude/skills/openspec-continue-change/SKILL.md",
]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_docs_state_guard_rule():
    # Given: 规划文档（schema、两个命令与两个 skill）、执行体定义与测量协议 ADR
    docs = {rel: read(rel) for rel in PLANNING}
    executor = read("template/plugins/flight/agents/executor.md")
    adr = read("template/openspec/adr/DRAFT-flight-measure-protocol.md")

    # When: 逐份找 guards 与「护栏」
    missing = [rel for rel, d in docs.items() if "guards" not in d or "护栏" not in d]

    # Then: 规划文档都写明；执行体定义写明护栏与「改源码后的红不算」；ADR 写明 guards
    assert missing == [], missing
    assert "护栏" in executor and "改源码后的红不算" in executor
    assert "guards" in adr
