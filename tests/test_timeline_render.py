"""落地记录从账本生成（scenario: flight-ledger-records#render-records-from-ledger、#report-reads-ledger）。"""
import json

import pytest

from conftest import git, ledger_append, make_change, run_hook, write

FP = "a" * 64


def new_repo(path):
    """一次 init 提交的空仓库。"""
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "main")
    git(path, "config", "user.email", "t@example.com")
    git(path, "config", "user.name", "t")
    (path / "README.md").write_text("# t\n", encoding="utf-8")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "init")
    return path


def _ev(ev, at, **fields):
    """账本事件外壳（change demo）+ 字段；approve 以外缺省 attempt 1。"""
    base = {"v": 1, "ev": ev, "change": "demo", "at": at, "by": {"plugin": "flight", "session": "s"}}
    if ev != "approve":
        base["attempt"] = 1
    return dict(base, **fields)


def _table_rows(text, header_prefix):
    """取以 header_prefix 开头的表头之下的数据行（跳过分隔行）。"""
    lines = text.splitlines()
    at = next(i for i, l in enumerate(lines) if l.startswith(header_prefix))
    rows = []
    for l in lines[at + 2:]:
        if not l.startswith("|"):
            break
        rows.append(l)
    return rows


def test_render_records_from_ledger(tmp_path):
    # Given: gate-baseline.json（at 09:50、exit 0、111.2s、ok）与一份含 approve 至 land 共 10 条事件的账本
    #        （measure 目标 2 个红 2 个；S1 gate 先红后绿，绿的那条带 warnings w1 与天花板 src/a.py:3；
    #        review 1 条 HIGH；final 绿带 warnings「G2 预存红」）；change 目录已有手写的 timeline.md（junk）
    repo = new_repo(tmp_path / "repo")
    d = make_change(repo)
    write(d / "gate-baseline.json", json.dumps({"at": "2026-10-13T09:50:00Z", "ok": True, "test": {"exit": 0, "sec": 111.2}}))
    write(d / "timeline.md", "junk line\n")
    high = {"severity": "HIGH", "file": "src/a.py", "line": 3, "summary": "s", "fix": "f"}
    events = [
        _ev("approve", "2026-10-13T10:00:00Z", fp=FP),
        _ev("takeoff", "2026-10-13T10:00:30Z", fp=FP, branch="worktree-demo", model="claude-opus-5-5", waves=[["S1"]]),
        _ev("dispatch", "2026-10-13T10:01:00Z", slice="S1", role="executor", agent="agent-0123456789", model="m", worktree="/w"),
        _ev("measure", "2026-10-13T10:02:00Z", slice="S1", agent="a1", base="f" * 40, commit="e" * 40,
            outcomes=[["t::a", "FAILED"], ["t::b", "FAILED"]], changed=[], source=[]),
        _ev("gate", "2026-10-13T10:05:00Z", slice="S1", ok=False, commit="c" * 40, failed=["G1 verify: exit 1"]),
        _ev("gate", "2026-10-13T10:07:00Z", slice="S1", ok=True, commit="d" * 40, failed=[], warnings=["w1"],
            ceilings=[["src/a.py", 3, "上限", "升级条件"]]),
        _ev("merge", "2026-10-13T10:08:00Z", slice="S1", ok=True, commit="d" * 40, failed=[]),
        _ev("review", "2026-10-13T10:09:00Z", slice="S1", agent="r1", findings=[high]),
        _ev("final", "2026-10-13T10:15:00Z", ok=True, commit="d" * 40, failed=[], warnings=["G2 预存红"]),
        _ev("land", "2026-10-13T10:20:00Z", verdict="ready"),
    ]
    for e in events:
        ledger_append(repo, "demo", e)

    # When: 连续运行两次 timeline.py render
    runs = []
    for _ in range(2):
        p = run_hook("timeline", "render", "--change-dir", str(d), cwd=repo)
        runs.append((p, (d / "timeline.md").read_bytes(), (d / "gate-report.md").read_bytes()))

    # Then: 两次退出 0、events 为 10；timeline.md 首行为生成说明注释、次行 baseline 备注 exit 0, 111.2s ok、
    #       其后 10 行事件且无 junk；门禁表依次 S1 red / S1 ok（w1）/ final ok（G2 预存红）；
    #       天花板表含 src/a.py:3；两次输出逐字节相同
    assert [r[0].returncode for r in runs] == [0, 0], runs[0][0].stderr + runs[1][0].stderr
    assert [json.loads(r[0].stdout)["events"] for r in runs] == [10, 10]
    lines = runs[0][1].decode("utf-8").splitlines()
    assert lines[0] == "<!-- timeline：timeline.py render 从账本生成，勿手改 -->", lines
    assert lines[1].split("\t")[1:] == ["baseline", "exit 0, 111.2s ok"], lines
    assert [l.split("\t")[1] for l in lines[2:]] == [e["ev"] for e in events] and "junk" not in runs[0][1].decode("utf-8"), lines
    report = runs[0][2].decode("utf-8")
    rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in _table_rows(report, "| 时间 | 切片 | 结论 |")]
    assert [(r[1], r[2], r[5]) for r in rows] == [("S1", "red", "-"), ("S1", "ok", "w1"), ("final", "ok", "G2 预存红")], report
    assert any("src/a.py:3" in r for r in _table_rows(report, "| 时间 | 切片 | 位置 |")), report
    assert runs[0][1:] == runs[1][1:]


def test_report_reads_ledger(tmp_path):
    # Given: 没有 timeline.md；账本有 approve 10:00、takeoff 10:00、S1 派发 10:01、S1 gate ok 10:07、
    #        final 红 10:10、一条 diag 10:12、final 绿 10:15、land 10:20、ship 10:30
    repo = new_repo(tmp_path / "repo")
    d = make_change(repo)
    for e in [
        _ev("approve", "2026-10-13T10:00:00Z", fp=FP),
        _ev("takeoff", "2026-10-13T10:00:00Z", fp=FP, branch="worktree-demo", model="claude-opus-5-5", waves=[["S1"]]),
        _ev("dispatch", "2026-10-13T10:01:00Z", slice="S1", role="executor", agent="a1", model="m", worktree="/w"),
        _ev("gate", "2026-10-13T10:07:00Z", slice="S1", ok=True, commit="d" * 40, failed=[]),
        _ev("final", "2026-10-13T10:10:00Z", ok=False, commit="d" * 40, failed=["G2 test: exit 1"]),
        _ev("diag", "2026-10-13T10:12:00Z", where="SubagentStop", error="boom", kind="throw"),
        _ev("final", "2026-10-13T10:15:00Z", ok=True, commit="d" * 40, failed=[]),
        _ev("land", "2026-10-13T10:20:00Z", verdict="ready"),
        _ev("ship", "2026-10-13T10:30:00Z", pr="https://x/pull/7", verdict="ready", commit="d" * 40),
    ]:
        ledger_append(repo, "demo", e)

    # When: 运行 timeline.py report，再运行 timeline.py record approve
    out = run_hook("timeline", "report", "--change-dir", str(d), cwd=repo).stdout
    rec = run_hook("timeline", "record", "approve", "--change-dir", str(d), cwd=repo)

    # Then: report 含批准 → apply 完成 20.0、PR 打开 30.0、S1 派发 → 门禁绿 6.0、门禁红次数 1、诊断 1 条；
    #       record 退出 2 且未生成 timeline.md
    assert "批准 → apply 完成：20.0 min" in out, out
    assert "批准 → PR 打开：30.0 min" in out, out
    assert "切片 S1：派发 → 门禁绿 6.0 min" in out, out
    assert "门禁红次数：1" in out, out
    assert "诊断：1 条" in out, out
    assert rec.returncode == 2 and not (d / "timeline.md").exists(), rec.stderr


# ---------------------------------------------------------------- flight-unattended S2（骨架：实现后去掉 xfail 标记）


def test_report_prints_heals_and_triage(tmp_path):
    # Given: 账本有 takeoff、heal merge-retry S1、heal integ integ、halt（kind final）、triage（首行「S2 的 owns 漏了守卫测试」）
    repo = new_repo(tmp_path / "repo")
    d = make_change(repo)
    for e in [
        _ev("approve", "2026-10-13T10:00:00Z", fp=FP),
        _ev("takeoff", "2026-10-13T10:00:00Z", fp=FP, branch="worktree-demo", model="claude-opus-5-5", waves=[["S1", "S2"]]),
        _ev("heal", "2026-10-13T10:05:00Z", kind="merge-retry", slice="S1", reason="合回失败：无变更"),
        _ev("heal", "2026-10-13T10:20:00Z", kind="integ", slice="integ", reason="final 红"),
        _ev("halt", "2026-10-13T10:40:00Z", reason="final 未通过：G2 test", kind="final"),
        _ev("triage", "2026-10-13T10:45:00Z", agent="d1", text="S2 的 owns 漏了守卫测试\n改计划\n草案：…"),
    ]:
        ledger_append(repo, "demo", e)

    # When: 运行 timeline.py report
    out = run_hook("timeline", "report", "--change-dir", str(d), cwd=repo).stdout

    # Then: 输出含「自愈：2 次」「merge-retry S1」「integ integ」与「停飞诊断：S2 的 owns 漏了守卫测试」
    assert "自愈：2 次" in out, out
    assert "merge-retry S1" in out and "integ integ" in out, out
    assert "停飞诊断：S2 的 owns 漏了守卫测试" in out, out
