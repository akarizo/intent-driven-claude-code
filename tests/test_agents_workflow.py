"""agent 定义与 opsx-apply 工作流脚本的静态契约（scenario: flight-apply#workflow-script-valid / executor-agent-contract / reviewer-no-rerun）。"""
import re
import shutil
import subprocess

import pytest

from conftest import ROOT

AGENTS = ROOT / "template" / ".claude" / "agents"
WORKFLOW = ROOT / "template" / ".claude" / "workflows" / "opsx-apply.js"


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    assert m, "%s 缺少 frontmatter" % path
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, m.group(2)


def test_workflow_script_valid():
    # Given: template/.claude/workflows/opsx-apply.js
    text = WORKFLOW.read_text(encoding="utf-8")
    body = re.sub(r"^\s*//.*$", "", text, flags=re.M).lstrip()

    # When: 静态检查脚本结构（并在有 node 时做语法检查）
    node_ok = True
    if shutil.which("node"):
        node_ok = subprocess.run(["node", "--check", str(WORKFLOW)], capture_output=True, text=True).returncode == 0

    # Then: 首条语句是 export const meta 字面量、name 为 opsx-apply、四个 phase 齐全；wave 用 parallel；评审只 push 不 await 且在 Fix 阶段之后才 Promise.all；无 Date.now / Math.random / import()；node --check 通过
    assert body.startswith("export const meta = {")
    assert "name: 'opsx-apply'" in text
    assert all(("title: '%s'" % p) in text for p in ("Implement", "Review", "Fix", "Finalize"))
    assert "await parallel(" in text
    assert "reviews.push(agent(" in text and "await reviews.push" not in text
    assert text.index("phase('Fix')") < text.index("Promise.all(reviews)")
    assert "Date.now(" not in text and "Math.random(" not in text and "import(" not in text
    assert node_ok


def test_executor_agent_contract():
    # Given: template/.claude/agents/slice-executor.md
    fm, body = frontmatter(AGENTS / "slice-executor.md")

    # When: 读取 frontmatter 与正文
    tools = [t.strip() for t in fm.get("tools", "").split(",")]

    # Then: model inherit、maxTurns 40、permissionMode acceptEdits、tools 含 Read/Edit/Write/Bash；正文含 start 命令、owns 约束、一轮多动作、禁 cd && 前缀、收尾 gate 并原样返回 JSON、不写报告
    assert fm.get("model") == "inherit"
    assert fm.get("maxTurns") == "40"
    assert fm.get("permissionMode") == "acceptEdits"
    assert all(t in tools for t in ("Read", "Edit", "Write", "Bash"))
    assert "slice-gate.py start" in body
    assert "owns" in body
    assert "一轮多动作" in body
    assert "cd &&" in body
    assert "slice-gate.py gate" in body and "原样" in body and "JSON" in body
    assert "不写报告" in body


def test_reviewer_no_rerun():
    # Given: template/.claude/agents/code-reviewer.md
    fm, body = frontmatter(AGENTS / "code-reviewer.md")

    # When: 读取正文
    modes = re.findall(r"\*\*`(full|integration|follow-up)`\*\*", body)

    # Then: 只保留 full 与 follow-up 两种模式，无 integration 与水位线；铁律含不重跑测试与 evidence.log；支持结构化 findings
    assert set(modes) == {"full", "follow-up"}
    assert "水位线" not in body
    assert "不重跑测试" in body and "evidence.log" in body
    assert "findings" in body and "severity" in body


def test_integrator_agent_contract():
    # Given: template/.claude/agents/integrator.md
    fm, body = frontmatter(AGENTS / "integrator.md")

    # When: 读取 frontmatter 与正文
    tools = [t.strip() for t in fm.get("tools", "").split(",")]

    # Then: model sonnet、effort low、tools 含 Bash；正文含合回 commit、_interfaces.md、slice-gate.py final
    assert fm.get("model") == "sonnet"
    assert fm.get("effort") == "low"
    assert "Bash" in tools
    assert "git merge" in body and "_interfaces.md" in body and "slice-gate.py final" in body
