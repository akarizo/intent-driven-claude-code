"""文档与铁律（scenario: executable-specs#claudemd-iron-rules / docs-updated, flight-apply#legacy-mode-optional）。"""
import re

from conftest import ROOT

IRON = ["先意图后代码", "规格即验收", "TDD", "独立评审", "门禁", "Git 边界", "两处", "度量", "零 token", "回退", "显式路由"]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def before_legacy(text):
    """返回第一个含 legacy 的标题之前的正文（水位线只允许出现在 legacy 段）。"""
    m = re.search(r"^#{1,6} .*legacy.*$", text, re.I | re.M)
    return text[: m.start()] if m else text


def test_claudemd_iron_rules():
    # Given: 本仓库根 CLAUDE.md 与 template/CLAUDE.md.snippet
    root = read("CLAUDE.md")
    snippet = read("template/CLAUDE.md.snippet")

    # When: 找出两者的铁律段
    sections = [root, snippet]

    # Then: 两者都含「铁律」并覆盖 10 条关键短语；根 CLAUDE.md 另含仓库开发纪律（schema validate / pytest / 假名谚文）；snippet 不超过 8KB
    assert all("铁律" in s for s in sections)
    assert all(all(k in s for k in IRON) for s in sections)
    assert "openspec schema validate" in root and "pytest" in root and "假名" in root
    assert len(snippet.encode("utf-8")) <= 8 * 1024


def test_docs_updated():
    # Given: README.md、docs/WORKFLOW_zh.md、template/CLAUDE.md.snippet
    readme, workflow, snippet = read("README.md"), read("docs/WORKFLOW_zh.md"), read("template/CLAUDE.md.snippet")

    # When: 取 legacy 段之前的正文
    main_readme, main_workflow = before_legacy(readme), before_legacy(workflow)

    # Then: 主体不再把水位线 / 逐 task 守门描述为默认，而描述 slices.json 与飞行流程；snippet 含 v2.1.251 顺序且不再声称 env 压过一切
    assert "水位线" not in main_readme and "水位线" not in main_workflow
    assert "slices.json" in readme and "飞行" in readme
    assert "slices.json" in workflow and "飞行" in workflow
    assert "2.1.251" in snippet and "压过一切" not in snippet


def test_legacy_mode_optional():
    # Given: 安装后的 skills 目录
    legacy = ROOT / "template" / ".claude" / "skills" / "legacy" / "openspec-subagent-apply-change" / "SKILL.md"
    old = ROOT / "template" / ".claude" / "skills" / "openspec-subagent-apply-change"

    # When: 检查 legacy 位置与旧位置
    head = legacy.read_text(encoding="utf-8")[:1200] if legacy.exists() else ""

    # Then: legacy 路径存在且开头说明仅 --gate=per-task 时读取；旧路径不再存在
    assert legacy.exists()
    assert "legacy" in head and "--gate=per-task" in head
    assert not old.exists()


# ---------------------------------------------------------------- 判据机械化（scenario: model-routing#docs-state-mechanical-resolution）
def test_docs_state_mechanical_resolution():
    # Given: README.md、docs/WORKFLOW_zh.md、template/CLAUDE.md.snippet、仓库根 CLAUDE.md、install.sh
    docs = {rel: read(rel) for rel in
            ("README.md", "docs/WORKFLOW_zh.md", "template/CLAUDE.md.snippet", "CLAUDE.md", "install.sh")}

    # When: 检索模型路由与起飞批准相关段落
    routed = [docs["README.md"], docs["docs/WORKFLOW_zh.md"], docs["template/CLAUDE.md.snippet"], docs["CLAUDE.md"]]

    # Then: 都声明主模型由 session-model.py 判定；铁律含"禁自述"与起飞批准的机械校验；无"看 /model"式措辞；install.sh 说明同步
    assert all("session-model.py" in t for t in routed)
    assert all("看 `/model`" not in t for t in docs.values())
    assert "禁自述" in docs["CLAUDE.md"] and "禁自述" in docs["template/CLAUDE.md.snippet"]
    assert "takeoff-gate" in docs["CLAUDE.md"] and "takeoff-gate" in docs["install.sh"]
    assert "session-model.py" in docs["install.sh"]


# ---------------------------------------------------------------- 起飞批准文档（scenario: approval-docs#*，S6 骨架）
def rule7(text):
    return next(line for line in text.splitlines() if line.startswith("7. "))


def step0(text):
    start = text.index("0. **批准自检")
    return text[start:text.index("1. **选 change**", start)]


def test_iron_rule_7_states_ledger_approval():
    # Given: 根 CLAUDE.md 与 template/CLAUDE.md.snippet
    texts = {"CLAUDE.md": rule7(read("CLAUDE.md")), "snippet": read("template/CLAUDE.md.snippet")}

    # When: 读取铁律 7 与对应条目
    # Then: 都含「批准带」「指纹」与 takeoff-gate，都不含「人类消息证据」
    for label, t in texts.items():
        assert "批准带" in t and "指纹" in t and "takeoff-gate" in t, label
        assert "人类消息证据" not in t, label


def test_propose_handoff_points_to_band():
    # Given: opsx-propose.md 与 openspec-propose/SKILL.md
    cmd = read("template/.claude/commands/opsx-propose.md")
    skill = read("template/.claude/skills/openspec-propose/SKILL.md")

    # When: 读取收尾交接
    # Then: 都含绝对路径 / spec.html / 批准带 / 指纹 / /opsx-apply / takeoff-gate，各自声明到此结束，都不含「转录」
    for t in (cmd, skill):
        for word in ("绝对路径", "spec.html", "批准带", "指纹", "/opsx-apply", "takeoff-gate"):
            assert word in t, word
        assert "转录" not in t
    assert "本命令到此结束" in cmd and "本 skill 到此结束" in skill


def test_apply_step0_explains_ledger_gate():
    # Given: opsx-apply.md 的 step 0 与 openspec-apply-change/SKILL.md
    cmd = step0(read("template/.claude/commands/opsx-apply.md"))
    skill = read("template/.claude/skills/openspec-apply-change/SKILL.md")

    # When: 读取起飞自检
    # Then: 都含 takeoff-gate.py --change-dir、账本、指纹、claude plugin install，都不含「人类消息」
    for t in (cmd, skill):
        for word in ("takeoff-gate.py --change-dir", "账本", "指纹", "claude plugin install"):
            assert word in t, word
        assert "人类消息" not in t


def test_docs_drop_transcript_approval():
    # Given: README.md、docs/WORKFLOW_zh.md、install.sh
    docs = {rel: read(rel) for rel in ("README.md", "docs/WORKFLOW_zh.md", "install.sh")}

    # When: 检索起飞批准相关文字
    # Then: 都不含「人类消息证据」；README 与 WORKFLOW 都含「批准带」与 flight@intent-driven
    for rel, t in docs.items():
        assert "人类消息证据" not in t, rel
    for rel in ("README.md", "docs/WORKFLOW_zh.md"):
        assert "批准带" in docs[rel] and "flight@intent-driven" in docs[rel], rel


def test_readme_links_control_plane_doc():
    # Given: 仓库中的 docs/flight-control-plane.html 与 README.md
    # When: 检查文件存在性与链接
    # Then: 文件存在，README 链接到它
    assert (ROOT / "docs" / "flight-control-plane.html").is_file()
    assert "docs/flight-control-plane.html" in read("README.md")

# ---------------------------------------------------------------- flight-measure
# 骨架：S8 实现后去掉 xfail 标记。


import pytest  # noqa: E402


def test_iron_rule_3_trusted_runner():
    # Given: 根 CLAUDE.md、template/CLAUDE.md.snippet、README.md、docs/WORKFLOW_zh.md
    root, snippet = read("CLAUDE.md"), read("template/CLAUDE.md.snippet")
    readme, workflow = read("README.md"), read("docs/WORKFLOW_zh.md")

    # When: 取两处铁律 3 那一行
    rules = [next(line for line in t.splitlines() if re.match(r"^\s*3\.\s*TDD", line)) for t in (root, snippet)]

    # Then: 都含「可信方」「账本」「不接受自述」，不含「测试运行由 hook 留痕」；README 与 WORKFLOW 提到测量与账本
    for rule in rules:
        assert "可信方" in rule and "账本" in rule and "不接受自述" in rule, rule
        assert "测试运行由 hook 留痕" not in rule, rule
    for text in (readme, workflow):
        assert ("measure" in text or "测量" in text) and "账本" in text


def test_measure_adr_and_review_refs():
    # Given: 新 ADR、pr-ship.md 与 code-reviewer.md
    adr_path = ROOT / "template" / "openspec" / "adr" / "DRAFT-flight-measure-protocol.md"

    # When: 读取 ADR 与两份文档
    adr = adr_path.read_text(encoding="utf-8") if adr_path.exists() else ""
    docs = [read("template/.claude/commands/pr-ship.md"), read("template/.claude/agents/code-reviewer.md")]

    # Then: ADR 已采纳并点名两份关联 ADR；两份文档写明飞行模式看测量统计、evidence.log 属回退路径
    assert "Status: accepted" in adr
    assert "DRAFT-gate-evidence-not-self-reported" in adr and "DRAFT-apply-as-flight" in adr
    for text in docs:
        assert "timeline.py report" in text or "测量" in text
        assert "evidence.log" in text and "回退" in text
