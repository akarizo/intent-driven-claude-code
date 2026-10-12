"""flight-entry-handoff 的文档（scenario: flight-entry-docs#docs-reference-plugin-ship）。骨架：S5 实现后去掉 xfail 标记。"""
import re

from conftest import ROOT

LEGACY = "template/.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md"
DOCS = ("README.md", "docs/WORKFLOW_zh.md", LEGACY, "CLAUDE.md")
BARE = re.compile(r"(?<![\w:])/pr-ship")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_docs_reference_plugin_ship():
    # Given: README.md、docs/WORKFLOW_zh.md、legacy skill 与 CLAUDE.md
    docs = {rel: read(rel) for rel in DOCS}

    # When: 找不带 flight: 前缀的 /pr-ship
    bare = {rel: BARE.findall(d) for rel, d in docs.items()}

    # Then: 四份都没有、都含 /flight:pr-ship；README、WORKFLOW、legacy 含 flight:code-reviewer；README 与 WORKFLOW 不再指向 .claude/agents/code-reviewer.md
    assert all(not v for v in bare.values()), bare
    assert all("/flight:pr-ship" in d for d in docs.values())
    assert all("flight:code-reviewer" in docs[rel] for rel in ("README.md", "docs/WORKFLOW_zh.md", LEGACY))
    assert all(".claude/agents/code-reviewer.md" not in docs[rel] for rel in ("README.md", "docs/WORKFLOW_zh.md"))


def test_pr_ship_reviewer_prompts_pin_worktree():
    # Given: template/plugins/flight/commands/pr-ship.md（子 agent 的 shell 不一定在 --worktree 里）
    text = read("template/plugins/flight/commands/pr-ship.md")

    # When: 切出第 8 步与第 10 步
    step8 = text[text.index("8. **"):text.index("9. **")]
    step10 = text[text.index("10. **"):text.index("11. **")]

    # Then: 两步的 reviewer prompt 都带工作目录行；取 diff 用 git -C <worktree> 且 HEAD 已由主会话解析成 SHA；不再把裸 ..HEAD 交给子 agent
    for step in (step8, step10):
        assert "工作目录: <worktree>" in step and "<abs-change-dir>" in text
    assert "git -C <worktree> diff origin/<target>...<REVIEW_HEAD_1>" in step8
    assert "git -C <worktree> diff <REVIEW_HEAD_上一轮>..<REVIEW_HEAD_本轮>" in step10
    assert "git rev-parse HEAD" in step10
    assert "<REVIEW_HEAD_上一轮>..HEAD" not in step10
