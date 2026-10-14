"""派发修复遗留：插件版本（scenario: flight-dispatch-followups-docs#plugin-version-0-10-3）。"""
import json

from conftest import ROOT


def test_plugin_version_0_10_3():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    # Then: version 按数字逐段比较不低于 0.10.3；description 仍含起飞待命、按下即起飞、自愈、看门狗、续飞
    data = json.loads((ROOT / "template/plugins/flight/.claude-plugin/plugin.json").read_text(encoding="utf-8"))
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 10, 3), data["version"]
    for word in ("起飞待命", "按下即起飞", "自愈", "看门狗", "续飞"):
        assert word in data["description"], data["description"]
