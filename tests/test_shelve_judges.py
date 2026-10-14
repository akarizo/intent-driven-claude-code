"""搁置撤销批准：判定器侧（scenario: flight-band-shelve#shelve-revokes-approval / later-approve-after-shelve-passes）。
骨架：每个 scenario 一个 strict xfail，断言是真实的；切片 S1 实现后去掉标记即解锁。"""
from conftest import approve_event, ledger_append, make_change, run_hook, write

NO_SID = {"CLAUDE_CODE_SESSION_ID": ""}  # 防止实现借环境变量读到当前会话转录


def shelve_event(change, fp, at="2026-10-14T08:00:00Z"):
    """账本 v1 的一条 shelve 事件：字段同 approve，ev 为 shelve。"""
    return dict(approve_event(change, fp, at), ev="shelve")


def current_fp(change_dir):
    p = run_hook("plan_fp", "--change-dir", str(change_dir))
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def test_shelve_revokes_approval(git_repo):
    # Given: demo 的账本依次有 approve（当前计划指纹 F）与 shelve（指纹 F）
    d = make_change(git_repo)
    fp = current_fp(d)
    ledger_append(git_repo, "demo", approve_event("demo", fp))
    ledger_append(git_repo, "demo", shelve_event("demo", fp))

    # When: 运行 takeoff-gate.py 与 ledger.py approved
    gate = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)
    approved = run_hook("ledger", "approved", "--change-dir", str(d))

    # Then: takeoff-gate 以 3 退出，stderr 含「已搁置」与 F 的前 8 位、不含「未批准」与「计划已变」；approved 以 0 退出、stdout 为空
    assert gate.returncode == 3, gate.stdout + gate.stderr
    assert "已搁置" in gate.stderr and fp[:8] in gate.stderr, gate.stderr
    assert "未批准" not in gate.stderr and "计划已变" not in gate.stderr, gate.stderr
    assert approved.returncode == 0, approved.stderr
    assert approved.stdout.strip() == "", approved.stdout


def test_later_approve_after_shelve_passes(git_repo):
    # Given: demo 的账本依次有 approve（指纹 F）、shelve（指纹 F）；之后计划改动、当前指纹为 G，账本再追加 approve（指纹 G）
    d = make_change(git_repo)
    old = current_fp(d)
    ledger_append(git_repo, "demo", approve_event("demo", old))
    ledger_append(git_repo, "demo", shelve_event("demo", old))
    write(d / "proposal.md", "## Why\n\n演示：计划已改。\n")
    new = current_fp(d)
    assert new != old
    ledger_append(git_repo, "demo", approve_event("demo", new, at="2026-10-14T09:00:00Z"))

    # When: 运行 takeoff-gate.py
    gate = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 以 0 退出，stdout 含 G 的前 8 位
    assert gate.returncode == 0, gate.stdout + gate.stderr
    assert new[:8] in gate.stdout, gate.stdout
