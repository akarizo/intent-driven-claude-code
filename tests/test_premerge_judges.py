"""账本认识预合并事件（scenario: flight-landing-premerge#ledger-knows-premerge）。
骨架：strict xfail，断言是真实的；切片 S1 实现后去掉标记即解锁。"""
import json

import pytest

from conftest import ledger_append, make_change, run_hook


def _event(change, ev, **x):
    return dict({"v": 1, "ev": ev, "change": change, "at": "2026-10-14T08:00:00Z",
                 "by": {"plugin": "flight", "session": "test"}}, **x)


PREMERGE = {"attempt": 1, "ok": False, "ref": "origin/main", "target": "a" * 40, "commit": "",
            "conflicts": ["a.py"], "reason": "冲突"}


@pytest.mark.xfail(strict=True, reason="S1 未实现：账本认识 premerge 事件与 halt kind premerge")
def test_ledger_knows_premerge(git_repo):
    # Given: demo 的账本依次有合法的 premerge（ok false、conflicts ["a.py"]）与 kind premerge 的 halt；
    #        other 的账本有一条 conflicts 为字符串 "a.py" 的 premerge
    demo = make_change(git_repo)
    ledger_append(git_repo, "demo", _event("demo", "premerge", **PREMERGE))
    ledger_append(git_repo, "demo", _event("demo", "halt", attempt=1, reason="预合并冲突", kind="premerge"))
    other = make_change(git_repo, name="other")
    ledger_append(git_repo, "other", _event("other", "premerge", **dict(PREMERGE, conflicts="a.py")))

    # When: 分别运行 ledger.py show，再运行 ledger.py events
    shown = run_hook("ledger", "show", "--change-dir", str(demo))
    bad = run_hook("ledger", "show", "--change-dir", str(other))
    events = run_hook("ledger", "events")

    # Then: demo 以 0 退出并打印这两条事件；other 以 4 退出且 stderr 含「premerge 的 conflicts」；events 含 premerge
    assert shown.returncode == 0, shown.stderr
    assert [json.loads(l)["ev"] for l in shown.stdout.splitlines()] == ["premerge", "halt"]
    assert bad.returncode == 4 and "premerge 的 conflicts" in bad.stderr, bad.stderr
    assert "premerge" in events.stdout.split(), events.stdout
