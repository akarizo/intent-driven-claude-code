"""flight-measure-followups 的文档（scenario: pr-ship-premerge#*, flight-takeover#docs-*）。"""
from conftest import ROOT


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def step4(text):
    start = text.index("4. **预合并冲突检查")
    return text[start:text.index("5. **", start)]


def test_premerge_uses_write_tree():
    # Given: pr-ship.md
    text = read("template/plugins/flight/commands/pr-ship.md")

    # When: 取第 4 步
    part = step4(text)

    # Then: 用 merge-tree --write-tree 的退出码判断；不再 grep 冲突标记
    assert "merge-tree --write-tree" in part and "退出" in part
    assert 'grep -c "^<<<<<<<"' not in part


def test_docs_state_takeover_and_fresh_worktrees():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    docs = [read("template/.claude/commands/opsx-apply.md"), read("template/.claude/skills/openspec-apply-change/SKILL.md")]

    # When: 逐份找 --takeover、另一个会话与另起
    missing = [[k for k in ("--takeover", "另一个会话", "另起") if k not in d] for d in docs]

    # Then: 两份都写明；并说明旧 worktree 保留、由人清理
    assert missing == [[], []], missing
    assert all("保留" in d and "清理" in d for d in docs)
