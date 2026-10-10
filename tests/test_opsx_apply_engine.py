"""/opsx-apply 命令与同名 skill 写明插件接管（scenario: opsx-apply-plugin-engine#*）。
骨架：S4 改两份文档后去掉 xfail 标记。"""
import re

import pytest

from conftest import ROOT

COMMAND = ROOT / "template" / ".claude" / "commands" / "opsx-apply.md"
SKILL = ROOT / "template" / ".claude" / "skills" / "openspec-apply-change" / "SKILL.md"


def preamble(path):
    """第一个步骤（`**Steps**` 或第一个编号步骤）之前的部分。"""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"^\*\*Steps\*\*|^0\. |^1\. ", text, re.MULTILINE)
    return text[: m.start()] if m else text


def test_apply_docs_describe_plugin_engine():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    docs = {p.name: preamble(p) for p in (COMMAND, SKILL)}

    # When: 读两份文档在第一个步骤之前的部分
    missing = {name: [w for w in ("插件", "状态机", "--engine=workflow", "停飞") if w not in text]
               for name, text in docs.items()}

    # Then: 两份都含「插件」「状态机」「--engine=workflow」「停飞」，且都写明不会自动回退到旧引擎
    assert missing == {COMMAND.name: [], SKILL.name: []}, missing
    for name, text in docs.items():
        assert re.search(r"不会?自动回退", text), name

# ---------------------------------------------------------------- flight-envelope S5


def test_docs_state_envelope():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md 与 template/openspec/adr/
    docs = {p.name: preamble(p) for p in (COMMAND, SKILL)}
    adr = ROOT / "template" / "openspec" / "adr" / "DRAFT-flight-capability-envelope.md"

    # When: 读两份文档在第一个步骤之前的部分，以及 ADR
    missing = {name: [w for w in ("包络", "白名单", "只读", "尽力") if w not in text] for name, text in docs.items()}

    # Then: 两份文档都含「包络」「白名单」「只读」「尽力」；ADR 存在、为 accepted、关联 state-machine ADR
    assert missing == {COMMAND.name: [], SKILL.name: []}, missing
    text = adr.read_text(encoding="utf-8")
    assert "Status: accepted" in text
    assert "DRAFT-flight-orchestrator-state-machine" in text

# ---------------------------------------------------------------- flight-envelope-tightening S6
# 骨架：S6 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S6：agent 定义、命令、skill 与新 ADR 尚未写明收紧后的包络")
def test_docs_state_tightened_envelope():
    # Given: 三份 agent 定义、opsx-apply.md、openspec-apply-change/SKILL.md 与 template/openspec/adr/
    agents = ROOT / "template" / "plugins" / "flight" / "agents"
    body = {n: (agents / ("%s.md" % n)).read_text(encoding="utf-8").split("---", 2)[-1] for n in ("executor", "fixer", "reviewer")}
    docs = {p.name: preamble(p) for p in (COMMAND, SKILL)}
    adr = ROOT / "template" / "openspec" / "adr" / "DRAFT-flight-envelope-tightening.md"

    # When: 读 agent 正文、两份文档第一个步骤之前的部分，以及新 ADR
    text = adr.read_text(encoding="utf-8")
    status = next((l for l in text.splitlines() if l.startswith("- Status:")), "")

    # Then: executor / fixer 正文含 worktree 与 heredoc，reviewer 含 heredoc；两份文档含 heredoc、主仓库、自己的 worktree；ADR 为 accepted 且 supersedes 旧 ADR
    for n in ("executor", "fixer"):
        assert "worktree" in body[n] and "heredoc" in body[n], n
    assert "heredoc" in body["reviewer"]
    missing = {name: [w for w in ("heredoc", "主仓库", "自己的 worktree") if w not in t] for name, t in docs.items()}
    assert missing == {COMMAND.name: [], SKILL.name: []}, missing
    assert "accepted" in status and "supersedes DRAFT-flight-capability-envelope" in status, status
