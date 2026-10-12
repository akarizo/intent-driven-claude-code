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


def test_legacy_reviewer_spawn_carries_model():
    # Given: legacy 逐 task 守门 skill（插件守卫拒绝不带 model 的 flight:* 派发）
    text = read(LEGACY)

    # When: 切出 4b 守门、聚焦复核、整合审三处派 flight:code-reviewer 的段落
    gate = text[text.index("#### 4b."):text.index("#### 4c.")]
    focus = text[text.index("修完派一个 fresh `flight:code-reviewer`"):text.index("#### 4d.")]
    integ = text[text.index("选「暂不 ship」时"):text.index("## Guardrails")]

    # Then: 三处都显式带 model: "<main>"；4b 写明 session-model.py 判定与 exit 3 停下；常见错误表点名不带 model 会被拒
    assert all('model: "<main>"' in seg for seg in (gate, focus, integ))
    assert "python3 .claude/hooks/session-model.py" in gate and "exit 3" in gate
    mistakes = text[text.index("## Common Mistakes"):]
    assert "不带 model" in mistakes and "拒绝" in mistakes
