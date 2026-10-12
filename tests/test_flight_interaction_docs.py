"""flight-interaction 的文档（scenario: flight-interaction-docs#docs-* / apply-*）。骨架：S5 实现后去掉 xfail 标记。"""
import pytest

from conftest import ROOT

CMD = "template/.claude/commands/opsx-apply.md"
SKILL = "template/.claude/skills/openspec-apply-change/SKILL.md"
FLIGHT = ("/flight status", "/flight panel", "/flight abort", "/flight resume")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def stop_section(text):
    start = text.index("即停飞")
    nxt = text.find("\n#", start)
    return text[start:] if nxt < 0 else text[start:nxt]


@pytest.mark.xfail(strict=True, reason="S5：文档尚未写 /flight 用法")
def test_docs_describe_flight_commands():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md 与 README.md
    docs = {rel: read(rel) for rel in (CMD, SKILL, "README.md")}

    # When: 逐份找四个子命令
    missing = {rel: [k for k in FLIGHT if k not in d] for rel, d in docs.items()}

    # Then: 都写明四个子命令；命令与 skill 都提到面板与只停本会话
    assert missing == {CMD: [], SKILL: [], "README.md": []}, missing
    assert all("面板" in docs[rel] and "本会话" in docs[rel] for rel in (CMD, SKILL))


@pytest.mark.xfail(strict=True, reason="S5：命令的 Guardrails 仍写 PreToolUse hook")
def test_apply_guardrails_consistent():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    docs = [read(CMD), read(SKILL)]

    # When: 找已退役的强制点说法
    stale = ["PreToolUse hook" in d for d in docs]

    # Then: 都不再出现，且都仍提到 takeoff-gate
    assert stale == [False, False]
    assert all("takeoff-gate" in d for d in docs)


@pytest.mark.xfail(strict=True, reason="S5：读到即停飞一段尚未区分自然语言触发")
def test_apply_skill_natural_language_trigger():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md 的「即停飞」一段
    parts = [stop_section(read(CMD)), stop_section(read(SKILL))]

    # When: 找自然语言触发时的处理
    ok = ["自然语言" in p and "/opsx-apply <name>" in p for p in parts]

    # Then: 两份都写明本轮没发 /opsx-apply 时提示人发出命令
    assert ok == [True, True]
