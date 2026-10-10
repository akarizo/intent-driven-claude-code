"""/opsx-apply 命令与同名 skill 写明插件接管（scenario: opsx-apply-plugin-engine#*）。
骨架：S4 改两份文档后去掉 xfail 标记。"""
import re

from conftest import ROOT

COMMAND = ROOT / "template" / ".claude" / "commands" / "opsx-apply.md"
SKILL = ROOT / "template" / ".claude" / "skills" / "openspec-apply-change" / "SKILL.md"


def preamble(path):
    """第一个步骤（`**Steps**` 或第一个编号步骤）之前的部分。"""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"^\*\*Steps\*\*|^0\. |^1\. ", text, re.MULTILINE)
    return text[: m.start()] if m else text


def test_apply_docs_describe_plugin_engine():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    docs = {p.name: preamble(p) for p in (COMMAND, SKILL)}

    # When: 读两份文档在第一个步骤之前的部分
    missing = {name: [w for w in ("插件", "状态机", "--engine=workflow", "停飞") if w not in text]
               for name, text in docs.items()}

    # Then: 两份都含「插件」「状态机」「--engine=workflow」「停飞」，且都写明不会自动回退到旧引擎
    assert missing == {COMMAND.name: [], SKILL.name: []}, missing
    for name, text in docs.items():
        assert re.search(r"不会?自动回退", text), name
