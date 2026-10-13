"""收 #54 遗留的文档与版本（scenario: flight-armed-docs#docs-say-press-takes-off-everywhere / plugin-version-0-10-1）。
骨架：S3 改完文档与 plugin.json 后去掉 xfail 标记。"""
import json

import pytest

from conftest import ROOT

DOCS = [
    "template/.claude/commands/opsx-propose.md",
    "template/.claude/skills/openspec-propose/SKILL.md",
    "template/.claude/commands/opsx-apply.md",
    "template/.claude/skills/openspec-apply-change/SKILL.md",
    "README.md",
    "docs/WORKFLOW_zh.md",
]
STALE = ("后自己发出", "后重新发出", "人发 /opsx-apply")


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="flight-armed-followups S3 未实现")
def test_docs_say_press_takes_off_everywhere():
    # Given: opsx-propose 命令与 skill、opsx-apply 命令与 skill、README.md、docs/WORKFLOW_zh.md
    # When: 读取六个文件
    # Then: 都不含「后自己发出」「后重新发出」「人发 /opsx-apply」，都含「按下即起飞」
    for rel in DOCS:
        text = _read(rel)
        for word in STALE:
            assert word not in text, f"{rel} 仍写着「{word}」"
        assert "按下即起飞" in text, f"{rel} 缺少「按下即起飞」"


@pytest.mark.xfail(strict=True, reason="flight-armed-followups S3 未实现")
def test_plugin_version_0_10_1():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    # Then: version 为 0.10.1；description 仍含起飞待命、按下即起飞、自愈、看门狗、续飞
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))
    assert data["version"] == "0.10.1", data["version"]
    for word in ("起飞待命", "按下即起飞", "自愈", "看门狗", "续飞"):
        assert word in data["description"], data["description"]
