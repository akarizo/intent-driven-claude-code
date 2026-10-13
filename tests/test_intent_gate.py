"""intent-gate.py：worktree 定根、check 子命令、apply 上下文按分支收窄（scenario: flight-intent-guard#*）。"""
import json

from conftest import git, run_hook, write


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


def init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    git(path, "init", "-q", "-b", "main")
    git(path, "config", "user.email", "t@example.com")
    git(path, "config", "user.name", "t")
    return path


def check(cwd, *paths):
    p = run_hook("intent-gate", "check", "--cwd", str(cwd), *paths, cwd=str(cwd))
    return p.returncode, json.loads(p.stdout)


def test_intent_check_cli(tmp_path):
    # Given: 仓库 root 在分支 main，根下有 openspec/ 但没有任何 change；CLAUDE_PROJECT_DIR 指向 root
    root = init_repo(tmp_path / "root")
    (root / "openspec").mkdir()
    env = {"CLAUDE_PROJECT_DIR": str(root)}
    x_abs = str((root / "src" / "x.py").resolve())

    # When: check --cwd <root> src/x.py docs/a.md /tmp/elsewhere.py；classic 模式判 <root>/src/x.py；classic 模式喂非 JSON（scenario 规定的三次调用）
    cli = run_hook("intent-gate", "check", "--cwd", str(root), "src/x.py", "docs/a.md", "/tmp/elsewhere.py",
                   cwd=str(root), env=env)
    classic = run_hook("intent-gate", stdin=payload(root / "src" / "x.py", root), env=env)
    bad = run_hook("intent-gate", stdin="not json {", env=env)

    # Then: check 退出 0、allow 为 false、denied 恰为一项且 path 为 <root>/src/x.py；classic 输出 deny；非 JSON 退出 0 且无输出
    out = json.loads(cli.stdout)
    assert cli.returncode == 0, cli.stderr
    assert out["allow"] is False
    assert [d["path"] for d in out["denied"]] == [x_abs]
    assert json.loads(classic.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert bad.returncode == 0
    assert bad.stdout == ""


def test_apply_context_scoped_to_change(tmp_path):
    # Given: 仓库在 main，change a 的 tasks.md 有未勾项、change b 全勾；另建分支 worktree-b / flight/a/S1 / worktree-c 的 worktree；
    #        worktree-b 根下有遗留 .openspec-slice，指向 change a 与 owns src/**
    repo = init_repo(tmp_path / "repo")
    write(repo / "openspec" / "changes" / "a" / "tasks.md", "- [ ] 1 x\n")
    write(repo / "openspec" / "changes" / "a" / "slices.json", json.dumps({
        "version": 1, "change": "a", "gate": {"test": "true"},
        "slices": [{"id": "S1", "title": "S1", "scenarios": [], "owns": ["src/**"], "deps": [], "verify": "true"}],
        "scenario_tests": {}}))
    write(repo / "openspec" / "changes" / "b" / "tasks.md", "- [x] 1 x\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    wts = {}
    for branch, name in (("worktree-b", "wb"), ("flight/a/S1", "wa"), ("worktree-c", "wc")):
        wts[branch] = tmp_path / name
        git(repo, "worktree", "add", "-q", "-b", branch, str(wts[branch]))
    wts["main"] = repo
    write(wts["worktree-b"] / ".openspec-slice", json.dumps(
        {"slice": "S1", "change_dir": str(wts["worktree-b"] / "openspec" / "changes" / "a"), "base": "HEAD"}))

    # When: 在每个 worktree 里 check src/x.py
    res = {b: check(wt, "src/x.py") for b, wt in wts.items()}

    # Then: worktree-b 被拒且原因含「change b 没有未完成的任务」；flight/a/S1 放行；main 放行；worktree-c 被拒且原因含「change c」
    assert "change b 没有未完成的任务" in res["worktree-b"][1]["denied"][0]["reason"], res["worktree-b"]
    assert res["flight/a/S1"] == (0, {"allow": True, "denied": []})
    assert res["main"] == (0, {"allow": True, "denied": []})
    assert "change c" in res["worktree-c"][1]["denied"][0]["reason"], res["worktree-c"]
