"""intent-gate.py：worktree 定根与切片所有权（scenario: slice-gate#intent-gate-*）。"""
import json

from conftest import run_hook, write


def payload(file_path, cwd):
    return json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(file_path)}, "cwd": str(cwd)})


def test_intent_gate_worktree_root(tmp_path):
    # Given: 主仓库根 root 有 openspec/ 但无活跃 change；.worktrees/x 内有活跃 change（tasks.md 仍有未勾选项）；CLAUDE_PROJECT_DIR 指向 root
    root = tmp_path / "root"
    (root / "openspec" / "changes").mkdir(parents=True)
    wt = root / ".worktrees" / "x"
    write(wt / "openspec" / "changes" / "add-export" / "tasks.md", "- [ ] 1.1 do it\n")
    target = wt / "src" / "export.py"

    # When: 对 .worktrees/x/src/export.py 发起 Write
    p = run_hook("intent-gate", stdin=payload(target, wt), env={"CLAUDE_PROJECT_DIR": str(root)})

    # Then: 门禁放行（stdout 不含 deny）
    assert '"deny"' not in p.stdout, p.stdout


def ownership_root(tmp_path):
    root = tmp_path / "root"
    change = root / "openspec" / "changes" / "c"
    write(change / "tasks.md", "- [ ] S1 x\n")
    write(change / "slices.json", json.dumps({
        "version": 1, "change": "c", "gate": {"test": "true"},
        "slices": [{"id": "S1", "title": "S1", "scenarios": [], "owns": ["src/a.py"], "deps": [], "verify": "true"}],
        "scenario_tests": {},
    }))
    write(root / ".openspec-slice", json.dumps({"slice": "S1", "change_dir": str(change), "base": "HEAD"}))
    return root


def test_intent_gate_ownership_deny(tmp_path):
    # Given: root 下存在 .openspec-slice 标记指向切片 S1，S1 的 owns 只有 src/a.py
    root = ownership_root(tmp_path)

    # When: 对 src/other.py 发起 Write
    p = run_hook("intent-gate", stdin=payload(root / "src" / "other.py", root), env={"CLAUDE_PROJECT_DIR": str(root)})

    # Then: 门禁返回 deny，理由点名切片 S1 与 src/other.py
    out = json.loads(p.stdout)
    assert out["hookSpecificOutput"]["permissionDecision"] == "deny"
    reason = out["hookSpecificOutput"]["permissionDecisionReason"]
    assert "S1" in reason and "src/other.py" in reason


def test_intent_gate_stale_marker_requires_apply_context(tmp_path):
    # Given: 存在指向 S1 的 .openspec-slice 标记，但 change 的 tasks.md 已全部勾选（apply 上下文不再成立，标记是陈旧的）
    root = ownership_root(tmp_path)
    write(root / "openspec" / "changes" / "c" / "tasks.md", "- [x] S1 x\n")

    # When: 对 owns 内的 src/a.py 发起 Write
    p = run_hook("intent-gate", stdin=payload(root / "src" / "a.py", root), env={"CLAUDE_PROJECT_DIR": str(root)})

    # Then: 门禁不放行（陈旧标记不能成为永久旁路）
    assert '"deny"' in p.stdout, p.stdout


def test_intent_gate_ownership_allows_owned_file(tmp_path):
    # Given: 同上的 .openspec-slice 标记，S1 的 owns 含 src/a.py
    root = ownership_root(tmp_path)

    # When: 对 src/a.py 发起 Write
    p = run_hook("intent-gate", stdin=payload(root / "src" / "a.py", root), env={"CLAUDE_PROJECT_DIR": str(root)})

    # Then: 门禁放行
    assert '"deny"' not in p.stdout, p.stdout
