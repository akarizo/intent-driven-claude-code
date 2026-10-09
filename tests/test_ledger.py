"""账本只读读取与结构校验（scenario: flight-ledger#*）。骨架：S2 实现 ledger.py 后逐条去掉 xfail 标记。"""
import json

from conftest import approve_event, commit_all, git, ledger_append, make_change, run_hook

F1, F2 = "a" * 64, "b" * 64


def ledger(cmd, change_dir):
    return run_hook("ledger", cmd, "--change-dir", str(change_dir))


def new_repo(path):
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "main")
    git(path, "config", "user.email", "t@example.com")
    git(path, "config", "user.name", "t")
    (path / "README.md").write_text("# t\n", encoding="utf-8")
    commit_all(path, "init")
    return path


def test_ledger_approved_returns_latest_fp(git_repo):
    # Given: 账本上依次有批准指纹 F1、F2 的两条事件
    d = make_change(git_repo)
    ledger_append(git_repo, "demo", approve_event("demo", F1))
    ledger_append(git_repo, "demo", approve_event("demo", F2, at="2026-10-09T09:00:00Z"))

    # When: 运行 approved
    p = ledger("approved", d)

    # Then: 以 0 退出且只打印 F2
    assert p.returncode == 0, p.stderr
    assert p.stdout.strip() == F2


def test_ledger_absent_means_unapproved(git_repo):
    # Given: 仓库里没有 refs/flight/demo/ledger
    d = make_change(git_repo)

    # When: 分别运行 approved 与 show
    a, s = ledger("approved", d), ledger("show", d)

    # Then: 都以 0 退出且 stdout 为空
    assert (a.returncode, a.stdout) == (0, ""), a.stderr
    assert (s.returncode, s.stdout) == (0, ""), s.stderr


def test_ledger_show_lists_events(git_repo):
    # Given: 账本上依次有两条事件
    d = make_change(git_repo)
    ledger_append(git_repo, "demo", approve_event("demo", F1))
    ledger_append(git_repo, "demo", approve_event("demo", F2, at="2026-10-09T09:00:00Z"))

    # When: 运行 show
    p = ledger("show", d)

    # Then: 恰两行，各是 JSON 对象，顺序与写入顺序一致
    assert p.returncode == 0, p.stderr
    rows = [json.loads(line) for line in p.stdout.splitlines()]
    assert [r["fp"] for r in rows] == [F1, F2]


def test_ledger_rejects_tampered_chain(tmp_path):
    # Given: 五个各只有一处违规的账本（多文件 / 非 JSON / change 不符 / 双父提交 / v 不是 1）
    good = approve_event("demo", F1)

    def extra_file(repo):
        return ledger_append(repo, "demo", files={"event.json": json.dumps(good), "x.txt": "x"})

    def not_json(repo):
        return ledger_append(repo, "demo", files={"event.json": "{not json"})

    def wrong_change(repo):
        return ledger_append(repo, "demo", approve_event("other", F1))

    def two_parents(repo):
        first = ledger_append(repo, "demo", good)
        side = ledger_append(repo, "demo", approve_event("demo", F2), ref="refs/flight/side/ledger", parents=[])
        return ledger_append(repo, "demo", good, parents=[first, side])

    def bad_version(repo):
        return ledger_append(repo, "demo", dict(good, v=2))

    cases = {"extra_file": extra_file, "not_json": not_json, "wrong_change": wrong_change,
             "two_parents": two_parents, "bad_version": bad_version}

    # When: 对每个账本运行 verify 与 approved
    results = {}
    for label, build in cases.items():
        repo = new_repo(tmp_path / label)
        d = make_change(repo)
        bad = build(repo)
        results[label] = (ledger("verify", d), ledger("approved", d), bad[:8])

    # Then: 都以 4 退出，stderr 含违规提交的前 8 位
    for label, (verify, approved, short) in results.items():
        assert verify.returncode == 4 and approved.returncode == 4, (label, verify.stderr, approved.stderr)
        assert short in verify.stderr and short in approved.stderr, (label, verify.stderr)


def test_ledger_shared_across_worktrees(git_repo):
    # Given: 主仓库账本有批准指纹 F1，并从主仓库建出一个也含 demo 的 worktree
    make_change(git_repo)
    commit_all(git_repo, "change")
    ledger_append(git_repo, "demo", approve_event("demo", F1))
    wt = git_repo.parent / "wt"
    git(git_repo, "worktree", "add", "-q", str(wt), "-b", "worktree-demo")

    # When: 以 worktree 里的 change 目录运行 approved
    p = ledger("approved", wt / "openspec" / "changes" / "demo")

    # Then: 输出 F1
    assert p.returncode == 0, p.stderr
    assert p.stdout.strip() == F1


def test_ledger_change_dir_outside_repo_exits_5(tmp_path):
    # Given: change 目录 tmp_path/outside/demo 存在但不在任何 git 仓库内（GIT_CEILING_DIRECTORIES 截断向上查找）
    d = tmp_path / "outside" / "demo"
    d.mkdir(parents=True)
    env = {"GIT_CEILING_DIRECTORIES": str(tmp_path)}

    # When: 运行 verify
    p = run_hook("ledger", "verify", "--change-dir", str(d), env=env)

    # Then: 以 5 退出（配置错误，不得当成无账本放行）
    assert p.returncode == 5, (p.stdout, p.stderr)
