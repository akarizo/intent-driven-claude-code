"""账本只读读取与结构校验（scenario: flight-ledger#*）。骨架：S2 实现 ledger.py 后逐条去掉 xfail 标记。"""
import importlib.util
import json
import subprocess

import pytest

from conftest import ROOT, approve_event, commit_all, git, ledger_append, make_change, run_hook

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


def test_ledger_verify_rejects_ref_to_non_commit(git_repo):
    # Given: demo 的账本引用 refs/flight/demo/ledger 指向一棵空树（不是提交）
    d = make_change(git_repo)
    tree = git(git_repo, "hash-object", "-w", "-t", "tree", "/dev/null")
    git(git_repo, "update-ref", "refs/flight/demo/ledger", tree)

    # When: 运行 verify
    p = ledger("verify", d)

    # Then: 以 4 退出（账本损坏），stderr 含「引用不指向提交」
    assert p.returncode == 4, (p.stdout, p.stderr)
    assert "引用不指向提交" in p.stderr


# ---------------------------------------------------------------- flight-integrity-fixes（scenario: approval-chain-hardening#ledger-*）
# 骨架：S4 实现后逐条去掉 xfail 标记。

def _raw_event_commit(repo, change, raw):
    """往账本追加一个 event.json 为原始字节 raw 的提交（造非 UTF-8 事件），返回提交 sha。"""
    def plumb(*args, data=None):
        return subprocess.run(["git", *args], cwd=repo, input=data, capture_output=True, check=True).stdout.decode().strip()

    blob = plumb("hash-object", "-w", "--stdin", data=raw)
    tree = plumb("mktree", data=("100644 blob %s\tevent.json\n" % blob).encode())
    commit = plumb("commit-tree", tree, "-m", "raw")
    plumb("update-ref", "refs/flight/%s/ledger" % change, commit)
    return commit


def _load_hooks_ledger():
    spec = importlib.util.spec_from_file_location("hooks_ledger_under_test", ROOT / "template" / ".claude" / "hooks" / "ledger.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_ledger_non_utf8_event_is_corrupt(git_repo):
    # Given: demo 的账本唯一提交里，event.json 的内容是非 UTF-8 字节
    d = make_change(git_repo)
    _raw_event_commit(git_repo, "demo", b"\xff\xfe{}")

    # When: 运行 ledger.py verify
    p = ledger("verify", d)

    # Then: 以 4 退出，stderr 含「账本损坏」
    assert p.returncode == 4, (p.returncode, p.stderr)
    assert "账本损坏" in p.stderr


def test_ledger_dangling_ref_is_corrupt(git_repo):
    # Given: demo 的账本 ref 指向一个仓库里不存在的对象（git update-ref 拒绝这样写，故直接写 ref 文件）
    d = make_change(git_repo)
    ref_file = git_repo / ".git" / "refs" / "flight" / "demo" / "ledger"
    ref_file.parent.mkdir(parents=True)
    ref_file.write_text("1" * 40 + "\n", encoding="utf-8")

    # When: 运行 ledger.py verify
    p = ledger("verify", d)

    # Then: 以 4 退出，stderr 含「账本损坏」
    assert p.returncode == 4, (p.returncode, p.stderr)
    assert "账本损坏" in p.stderr


def test_ledger_tip_matches_read_chain(git_repo, monkeypatch):
    # Given: demo 的账本链尾是批准 F1 的提交 T1；读取过程中（rev-list 之后）另一个写入方追加了批准 F2 的提交 T2
    d = make_change(git_repo)
    t1 = ledger_append(git_repo, "demo", approve_event("demo", F1))
    mod = _load_hooks_ledger()
    real = mod._git
    raced = []

    def racing(change_dir, *args, **kwargs):
        out = real(change_dir, *args, **kwargs)
        if args and args[0] == "rev-list" and not raced:
            raced.append(ledger_append(git_repo, "demo", approve_event("demo", F2)))
        return out

    monkeypatch.setattr(mod, "_git", racing)

    # When: 调用 latest_approval
    event, tip = mod.latest_approval(str(d))

    # Then: 确实发生了并发追加；返回的事件是 F1，返回的链尾是 T1
    assert raced and raced[0] != t1, raced
    assert event["fp"] == F1 and tip == t1, (event, tip, t1)


# ---------------------------------------------------------------- flight-orchestrator-core（scenario: flight-ledger-events#*）

def flight_events(change="demo", fp=F1):
    """flight-ledger-events 表中每类事件各一条（字段合法），按一次飞行的顺序排列。"""
    base = {"v": 1, "change": change, "at": "2026-10-09T10:00:00Z", "by": {"plugin": "flight", "session": "test"}}
    rows = [
        {"ev": "approve", "fp": fp},
        {"ev": "takeoff", "attempt": 1, "fp": fp, "branch": "worktree-demo", "waves": [["S1"]], "model": "opus"},
        {"ev": "dispatch", "attempt": 1, "slice": "S1", "role": "executor", "agent": "a1", "model": "opus",
         "worktree": "/repo/.claude/worktrees/flight-demo-S1"},
        {"ev": "gate", "attempt": 1, "slice": "S1", "ok": True, "commit": "c" * 40, "failed": []},
        {"ev": "ended", "attempt": 1, "agent": "a1", "reason": "answer", "model": "claude-opus-5-5"},
        {"ev": "merge", "attempt": 1, "slice": "S1", "ok": True, "commit": "d" * 40, "failed": []},
        {"ev": "review", "attempt": 1, "slice": "S1", "agent": "r1",
         "findings": [{"severity": "LOW", "file": "a.py", "line": 3, "summary": "s", "fix": "f"}]},
        {"ev": "blocked", "attempt": 1, "slice": "S2", "kind": "infra", "reason": "依赖已 blocked：S1"},
        {"ev": "final", "attempt": 1, "ok": True, "commit": "d" * 40, "failed": []},
        {"ev": "land", "attempt": 1, "verdict": "ready"},
    ]
    return [dict(base, **r) for r in rows]


def test_ledger_accepts_flight_events(git_repo):
    # Given: demo 的账本依次有 approve、takeoff、dispatch、gate、ended、merge、review、blocked、final、land 十条合法事件
    d = make_change(git_repo)
    events = flight_events()
    for ev in events:
        ledger_append(git_repo, "demo", ev)

    # When: 分别运行 verify 与 show
    v, s = ledger("verify", d), ledger("show", d)

    # Then: 都以 0 退出；show 恰打印十行，ev 的顺序与写入顺序一致
    assert v.returncode == 0, v.stderr
    assert s.returncode == 0, s.stderr
    assert [json.loads(line)["ev"] for line in s.stdout.splitlines()] == [e["ev"] for e in events]


def test_ledger_rejects_malformed_flight_event(tmp_path):
    # Given: 两个账本——一个链尾是 ok 为字符串 "yes" 的 gate 事件，一个链尾是 ev 为 "teleport" 的事件
    events = flight_events()
    bad_gate = dict(events[3], ok="yes")
    bad_ev = dict(events[1], ev="teleport")
    results = []
    for i, bad in enumerate([bad_gate, bad_ev]):
        repo = new_repo(tmp_path / ("r%d" % i))
        d = make_change(repo)
        ledger_append(repo, "demo", events[0])
        tip = ledger_append(repo, "demo", bad)

        # When: 运行 verify
        results.append((ledger("verify", d), tip))

    # 对照：链尾换成字段合法的 gate 事件
    repo = new_repo(tmp_path / "ok")
    d = make_change(repo)
    for ev in (events[0], events[3]):
        ledger_append(repo, "demo", ev)
    control = ledger("verify", d)

    # Then: 两个坏账本都以 4 退出，stderr 含「账本损坏」与链尾提交的前 8 位；对照以 0 退出
    for p, tip in results:
        assert p.returncode == 4, (p.returncode, p.stderr)
        assert "账本损坏" in p.stderr and tip[:8] in p.stderr, p.stderr
    assert control.returncode == 0, control.stderr


def test_approved_ignores_flight_events(git_repo):
    # Given: 账本上 approve（当前计划指纹 F）之后又有 takeoff、dispatch、gate 三条事件
    d = make_change(git_repo)
    p = run_hook("plan_fp", "--change-dir", str(d))
    assert p.returncode == 0, p.stderr
    fp = p.stdout.strip()
    for ev in flight_events(fp=fp)[:4]:
        ledger_append(git_repo, "demo", ev)

    # When: 运行 ledger.py approved 与 takeoff-gate.py --change-dir
    a = ledger("approved", d)
    t = run_hook("takeoff-gate", "--change-dir", str(d), env={"CLAUDE_CODE_SESSION_ID": ""})

    # Then: approved 只打印 F；takeoff-gate 以 0 退出
    assert (a.returncode, a.stdout.strip()) == (0, fp), a.stderr
    assert t.returncode == 0, t.stderr

# ---------------------------------------------------------------- flight-measure
# 骨架：S1 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S1：measure 事件与 events 子命令尚未实现")
def test_ledger_accepts_measure_events(git_repo):
    # Given: 账本 A（demo）含 approve、takeoff 与一条字段齐全的 measure；账本 B（other）同上但 measure 缺 outcomes
    measure = {"ev": "measure", "attempt": 1, "slice": "S1", "agent": "a1", "base": "f" * 40, "commit": "e" * 40,
               "outcomes": [["tests/test_a.py::test_s", "FAILED"]], "changed": ["tests/test_a.py"], "source": []}
    a = make_change(git_repo)
    for ev in flight_events()[:2] + [dict(flight_events()[0], **measure)]:
        ledger_append(git_repo, "demo", {k: v for k, v in ev.items() if not (ev.get("ev") == "measure" and k == "fp")})
    b = make_change(git_repo, name="other")
    bad = {k: v for k, v in measure.items() if k != "outcomes"}
    for ev in flight_events("other")[:2] + [dict(flight_events("other")[0], **bad)]:
        ledger_append(git_repo, "other", {k: v for k, v in ev.items() if not (ev.get("ev") == "measure" and k == "fp")})

    # When: A 运行 show，B 运行 verify，再运行 events
    show, verify = ledger("show", a), ledger("verify", b)
    events = run_hook("ledger", "events")

    # Then: A 打印三条、退出 0；B 退出 4 且 stderr 含「measure 的 outcomes」；events 列出 measure 与 gate
    assert show.returncode == 0, show.stderr
    assert [json.loads(line)["ev"] for line in show.stdout.splitlines()] == ["approve", "takeoff", "measure"]
    assert verify.returncode == 4 and "measure 的 outcomes" in verify.stderr, verify.stderr
    assert events.returncode == 0, events.stderr
    assert {"measure", "gate"} <= set(events.stdout.split())
