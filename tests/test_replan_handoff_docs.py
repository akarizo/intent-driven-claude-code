"""文档写明诊断为改计划时交主会话修订、插件版本（scenario: flight-replan-handoff#docs-describe-replan-handoff / plugin-version-0-13-0）。"""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ("template/.claude/commands/opsx-apply.md", "template/.claude/skills/openspec-apply-change/SKILL.md")


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="骨架：S2 实现后去掉")
def test_docs_describe_replan_handoff():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md 与 README.md
    # When: 读取三份全文
    texts = {rel: _read(rel) for rel in DOCS}
    readme = _read("README.md")

    # Then: 前两份各有一行同时含「改计划」与「主会话」，且都含「批准修订并续飞」；三份都不含「不参与任何判定」
    for rel, text in texts.items():
        assert any("改计划" in ln and "主会话" in ln for ln in text.splitlines()), rel
        assert "批准修订并续飞" in text, rel
    for rel, text in [*texts.items(), ("README.md", readme)]:
        assert "不参与任何判定" not in text, rel


@pytest.mark.xfail(strict=True, reason="骨架：S2 实现后去掉")
def test_plugin_version_0_13_0():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))

    # Then: version 按数字逐段比较不低于 0.13.0；description 含「交主会话修订计划」
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 13, 0), data["version"]
    assert "交主会话修订计划" in data["description"], data["description"]
