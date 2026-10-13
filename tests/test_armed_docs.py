"""起飞待命与按下即起飞的文档（scenario: flight-armed-docs#*）。"""
import json

from conftest import ROOT

APPLY_DOCS = [
    "template/.claude/commands/opsx-apply.md",
    "template/.claude/skills/openspec-apply-change/SKILL.md",
    "README.md",
    "docs/WORKFLOW_zh.md",
]
PROPOSE_DOCS = [
    "template/.claude/commands/opsx-propose.md",
    "template/.claude/skills/openspec-propose/SKILL.md",
]


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_docs_describe_armed_takeoff():
    # Given: opsx-apply 命令与 skill、README、WORKFLOW_zh、opsx-propose 命令与 skill
    # When: 读取六个文件
    # Then: 前四个都写明起飞待命、按下即起飞、最多 3 次、30 分钟、/flight abort；README 与 WORKFLOW 写明人工中止除外；propose 两份写按下即起飞、不再写回车发出预填
    for rel in APPLY_DOCS:
        text = _read(rel)
        for word in ("起飞待命", "按下即起飞", "最多 3 次", "30 分钟", "/flight abort"):
            assert word in text, f"{rel} 缺少「{word}」"
    for rel in ("README.md", "docs/WORKFLOW_zh.md"):
        assert "人工中止除外" in _read(rel), f"{rel} 缺少「人工中止除外」"
    for rel in PROPOSE_DOCS:
        text = _read(rel)
        assert "按下即起飞" in text, f"{rel} 缺少「按下即起飞」"
        assert "回车发出预填" not in text, f"{rel} 仍写着「回车发出预填」"


def test_plugin_version_not_below_0_10_0():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    # Then: version 按数字逐段比较不低于 0.10.0，description 提到起飞待命与按下即起飞
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 10, 0), data["version"]
    assert "起飞待命" in data["description"]
    assert "按下即起飞" in data["description"]
