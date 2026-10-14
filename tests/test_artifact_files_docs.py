"""文档写明 artifact_files 与插件版本（scenario: flight-takeoff-artifact-files#artifact-files-documented / plugin-version-0-10-4）。"""
import json

import pytest

from conftest import ROOT

CMD = ROOT / "template" / ".claude" / "commands"
SKILLS = ROOT / "template" / ".claude" / "skills"


def read(path):
    return path.read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="骨架：S3 实现后去掉")
def test_artifact_files_documented():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md、opsx-propose.md、openspec-propose/SKILL.md、schema.yaml
    apply_docs = [read(CMD / "opsx-apply.md"), read(SKILLS / "openspec-apply-change" / "SKILL.md")]
    others = [read(CMD / "opsx-propose.md"), read(SKILLS / "openspec-propose" / "SKILL.md"),
              read(ROOT / "template" / "openspec" / "schemas" / "intent-driven" / "schema.yaml")]

    # When: 取 apply 两份里写到 artifact_files 的行
    lines = [[ln for ln in t.splitlines() if "artifact_files" in ln] for t in apply_docs]

    # Then: 每份都含 artifact_files；apply 两份写到 artifact_files 的行同时写到「授权提交」
    for found in lines:
        assert any("授权提交" in ln for ln in found), found
    for t in others:
        assert "artifact_files" in t


@pytest.mark.xfail(strict=True, reason="骨架：S3 实现后去掉")
def test_plugin_version_0_10_4():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    data = json.loads(read(ROOT / "template" / "plugins" / "flight" / ".claude-plugin" / "plugin.json"))

    # Then: version 为 0.10.4
    assert data["version"] == "0.10.4", data["version"]
