"""派发绕过包络的修复：文档与版本（scenario: flight-dispatch-docs#docs-describe-wake-turn / propose-description-current / plugin-version-0-10-2）。"""
import json

from conftest import ROOT

APPLY_DOCS = [
    "template/.claude/commands/opsx-apply.md",
    "template/.claude/skills/openspec-apply-change/SKILL.md",
]
WAKE_DOCS = APPLY_DOCS + ["README.md", "docs/WORKFLOW_zh.md"]


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _description(rel):
    text = _read(rel)
    assert text.startswith("---\n"), f"{rel} 没有 frontmatter"
    head = text.split("\n---", 1)[0]
    for line in head.splitlines():
        if line.startswith("description:"):
            return line[len("description:"):].strip()
    raise AssertionError(f"{rel} 的 frontmatter 没有 description")


def test_docs_describe_wake_turn():
    # Given: opsx-apply 命令与 skill、README.md、docs/WORKFLOW_zh.md
    # When: 读取这四个文件
    # Then: 都含「唤醒轮」；命令与 skill 两份都含「只回复「收到」」
    for rel in WAKE_DOCS:
        assert "唤醒轮" in _read(rel), f"{rel} 没写唤醒轮"
    for rel in APPLY_DOCS:
        assert "只回复「收到」" in _read(rel), f"{rel} 没写「只回复「收到」」"


def test_propose_description_current():
    # Given: template/.claude/commands/opsx-propose.md
    # When: 读取其 frontmatter 的 description
    # Then: 含「按下即起飞」，不含「自己发 /opsx-apply」
    desc = _description("template/.claude/commands/opsx-propose.md")
    assert "按下即起飞" in desc, desc
    assert "自己发 /opsx-apply" not in desc, desc


def test_plugin_version_not_below_0_10_2():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    # Then: version 按数字逐段比较不低于 0.10.2；description 仍含起飞待命、按下即起飞、自愈、看门狗、续飞
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 10, 2), data["version"]
    for word in ("起飞待命", "按下即起飞", "自愈", "看门狗", "续飞"):
        assert word in data["description"], data["description"]
