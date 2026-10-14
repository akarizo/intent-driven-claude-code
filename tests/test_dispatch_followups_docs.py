"""派发修复遗留：插件版本（scenario: flight-dispatch-followups-docs#plugin-version-0-10-3）。骨架：S3 改完 plugin.json 后去掉 xfail 标记。"""
import json

import pytest

from conftest import ROOT


@pytest.mark.xfail(strict=True, reason="flight-dispatch-followups S3 未实现")
def test_plugin_version_0_10_3():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    # Then: version 为 0.10.3；description 含起飞待命、按下即起飞、自愈、看门狗、续飞
    data = json.loads((ROOT / "template/plugins/flight/.claude-plugin/plugin.json").read_text(encoding="utf-8"))
    assert data["version"] == "0.10.3", data["version"]
    for word in ("起飞待命", "按下即起飞", "自愈", "看门狗", "续飞"):
        assert word in data["description"], data["description"]
