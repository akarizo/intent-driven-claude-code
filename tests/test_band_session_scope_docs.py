"""批准带会话作用域：文档与版本（scenario: flight-band-session-scope-docs#docs-describe-session-scope / plugin-version-0-11-0）。
"""
import json

from conftest import ROOT

PROPOSE_DOCS = [
    "template/.claude/commands/opsx-propose.md",
    "template/.claude/skills/openspec-propose/SKILL.md",
]
SCOPE_DOCS = [
    "template/.claude/commands/opsx-apply.md",
    "template/.claude/skills/openspec-apply-change/SKILL.md",
    *PROPOSE_DOCS,
    "README.md",
    "docs/WORKFLOW_zh.md",
]


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_docs_describe_session_scope():
    # Given: opsx-apply 命令与 skill、opsx-propose 命令与 skill、README.md、docs/WORKFLOW_zh.md
    # When: 读取这六个文件
    # Then: 都含「本会话认领」；opsx-propose 的命令与 skill 都含「批准带没出现：先发 `/opsx-apply <name>`」，都不含「批准带没出现 = 未装 flight 插件」
    for rel in SCOPE_DOCS:
        assert "本会话认领" in _read(rel), f"{rel} 没写本会话认领"
    for rel in PROPOSE_DOCS:
        text = _read(rel)
        assert "批准带没出现：先发 `/opsx-apply <name>`" in text, f"{rel} 没把「先发 /opsx-apply <name>」写在批准带没出现之后"
        assert "批准带没出现 = 未装 flight 插件" not in text, f"{rel} 仍直接断言未装插件"


def test_plugin_version_0_11_0():
    # Given: 插件清单 template/plugins/flight/.claude-plugin/plugin.json
    # When: 解析其 JSON
    # Then: version 按数字逐段比较不低于 0.11.0（版本号在后续 change 里继续前进，不钉死）；description 含起飞待命、按下即起飞、自愈、看门狗、续飞、本会话认领
    data = json.loads(_read("template/plugins/flight/.claude-plugin/plugin.json"))
    assert tuple(int(p) for p in data["version"].split(".")) >= (0, 11, 0), data["version"]
    for word in ("起飞待命", "按下即起飞", "自愈", "看门狗", "续飞", "本会话认领"):
        assert word in data["description"], data["description"]
