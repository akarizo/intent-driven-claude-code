"""flight-unattended 的文档与发布（scenario: flight-unattended-docs#*）。骨架：S7 实现后去掉 xfail 标记。"""
import json

import pytest

from conftest import ROOT

DOCS = (
    "template/.claude/commands/opsx-apply.md",
    "template/.claude/skills/openspec-apply-change/SKILL.md",
    "README.md",
    "docs/WORKFLOW_zh.md",
)
KEYWORDS = ("自愈", "看门狗", "10 分钟", "整合修复", "G9", "诊断员", "批准修订并续飞")


@pytest.mark.xfail(strict=True, reason="flight-unattended S7 未实现")
def test_docs_describe_self_heal_and_resume():
    # Given: opsx-apply 命令文件、openspec-apply-change 的 SKILL.md、README.md、docs/WORKFLOW_zh.md
    files = {p: (ROOT / p).read_text(encoding="utf-8") for p in DOCS}

    # When: 逐个查关键词
    missing = {p: [w for w in KEYWORDS if w not in t] for p, t in files.items()}
    cmd_skill = [files[p] for p in DOCS[:2]]

    # Then: 四个文件都含全部关键词；命令文件与 SKILL.md 都含「每次飞行 3 次」与「只读」
    assert not any(missing.values()), missing
    assert all("每次飞行 3 次" in t and "只读" in t for t in cmd_skill)


@pytest.mark.xfail(strict=True, reason="flight-unattended S7 未实现")
def test_plugin_version_0_9_0():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    manifest = json.loads((ROOT / "template/plugins/flight/.claude-plugin/plugin.json").read_text(encoding="utf-8"))

    # When: 读取 version 与 description
    version, desc = manifest.get("version"), manifest.get("description", "")

    # Then: version 为 0.9.0；description 含「自愈」「看门狗」「续飞」
    assert version == "0.9.0", version
    assert all(w in desc for w in ("自愈", "看门狗", "续飞")), desc
