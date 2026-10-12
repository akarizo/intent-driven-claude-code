"""flight-retire-workflow-engine 的文档（scenario: flight-retire-docs#*）。S4 已解锁。"""
from conftest import ROOT

STALE = ("--engine=workflow", "opsx-apply.js", "integrator", "slice-executor", "session-decompose")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_apply_docs_plugin_only():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    docs = [read("template/.claude/commands/opsx-apply.md"), read("template/.claude/skills/openspec-apply-change/SKILL.md")]

    # When: 逐份找旧引擎字样与插件路径的关键说明
    stale = [[k for k in STALE if k in d] for d in docs]
    missing = [[k for k in ("停飞", "/reload-plugins", "flight@intent-driven", "--gate=per-task", "--takeover") if k not in d] for d in docs]

    # Then: 都不含旧引擎字样；都写明停飞、重载与安装指引，并保留 per-task 与 --takeover
    assert stale == [[], []], stale
    assert missing == [[], []], missing


def test_git_discipline_describes_plugin_worktrees():
    # Given: openspec-git-discipline/SKILL.md
    text = read("template/.claude/skills/openspec-git-discipline/SKILL.md")

    # When: 找插件的 worktree 与分支命名，以及旧引擎字样
    has_plugin = ".claude/worktrees/flight-" in text and "flight/<change>/" in text

    # Then: 写明插件的 worktree 与分支；不含 integrator 与 opsx-apply.js
    assert has_plugin
    assert "integrator" not in text and "opsx-apply.js" not in text


def test_evidence_log_means_outside_flight():
    # Given: pr-ship.md 与 code-reviewer.md
    docs = [read("template/plugins/flight/commands/pr-ship.md"), read("template/plugins/flight/agents/code-reviewer.md")]

    # When: 逐份找 evidence.log 的定位
    ok = [("evidence.log" in d and "飞行外" in d and "Workflow 回退" not in d) for d in docs]

    # Then: 都把 evidence.log 说成飞行外的留痕，不再称 Workflow 回退
    assert ok == [True, True]
