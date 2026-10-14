"""搁置的文档与插件版本（scenario: flight-shelve-followups-docs#docs-describe-shelve / plugin-version-bumped）。
骨架：每个 scenario 一个 strict xfail，断言是真实的；切片 S4 实现后去掉标记即解锁。"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ("template/.claude/commands/opsx-apply.md", "template/.claude/skills/openspec-apply-change/SKILL.md")


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _version(text):
    return tuple(int(p) for p in text.split("."))


def test_docs_describe_shelve():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    # When: 读取两份全文
    texts = {rel: _read(rel) for rel in DOCS}

    # Then: 两份都含「「搁置」」「改动计划后重新出现」与「已搁置」；都不含「四个按钮都按下即起飞」
    for rel, text in texts.items():
        for word in ("「搁置」", "改动计划后重新出现", "已搁置"):
            assert word in text, (rel, word)
        assert "四个按钮都按下即起飞" not in text, rel


def test_plugin_version_bumped():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))

    # Then: version 按数字逐段比较高于 0.10.2；description 含「搁置」
    assert _version(data["version"]) > (0, 10, 2), data["version"]
    assert "搁置" in data["description"], data["description"]
