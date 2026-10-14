"""预合并、重验与计划需修订的文档与插件版本（scenario: flight-premerge-docs#docs-describe-premerge / plugin-version-0-12-0）。
骨架：strict xfail，断言是真实的；切片 S3 实现后去掉标记即解锁。"""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ("template/.claude/commands/opsx-apply.md", "template/.claude/skills/openspec-apply-change/SKILL.md")
PR_SHIP = "template/plugins/flight/commands/pr-ship.md"


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="S3 未实现：文档写明预合并、重验与计划需修订")
def test_docs_describe_premerge():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md 与 flight 插件的 pr-ship.md
    # When: 读取三份全文
    texts = {rel: _read(rel) for rel in DOCS}
    ship = _read(PR_SHIP)

    # Then: 前两份都含「预合并」「/flight recheck」「计划需修订」；pr-ship.md 含「/flight recheck」
    for rel, text in texts.items():
        for word in ("预合并", "/flight recheck", "计划需修订"):
            assert word in text, (rel, word)
    assert "/flight recheck" in ship


@pytest.mark.xfail(strict=True, reason="S3 未实现：插件 0.12.0")
def test_plugin_version_0_12_0():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))

    # Then: version 按数字逐段比较不低于 0.12.0；description 含「预合并」
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 12, 0), data["version"]
    assert "预合并" in data["description"], data["description"]
