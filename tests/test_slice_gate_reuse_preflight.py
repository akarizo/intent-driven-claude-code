"""slice-gate final --reuse-fix、baseline 运行标记、preflight 识别、gate.test 必填
（scenario: final-gate-fastpath#final-reuse* / final-reuses-*，propose-parallel-baseline#lint-* / baseline-* / preflight-*）。
骨架：每个 scenario 一个 strict xfail，断言是真实的；切片 S2 实现后去掉标记即解锁。"""
import json
import os
import shlex
import subprocess
import sys

import pytest

from conftest import commit_all, git, ledger_append, run_hook, write
from test_slice_gate import plan, slice_, write_plan

PASSING = "def test_adds():\n    assert 1 + 1 == 2\n"
CHECK_RUNNING = (
    "import json, sys\n"
    "d = json.load(open('openspec/changes/c/gate-baseline.json', encoding='utf-8'))\n"
    "sys.exit(0 if d.get('running') is True else 1)\n"
)


def _repo(git_repo, gate_test="touch ran-g2"):
    """单片计划 + 源码 + 通过的 scenario 测试，提交一次；返回 change 目录。"""
    change = git_repo / "openspec" / "changes" / "c"
    data = plan(
        [slice_("S1", ["src/**", "tests/**"], scenarios=["cap#adds"])],
        gate={"test": gate_test, "lint": None, "typecheck": None, "full_suite_sec": None},
        scenario_tests={"cap#adds": "tests/test_cap.py::test_adds"},
    )
    write_plan(change, data)
    write(git_repo / "src" / "mod.py", "x = 1\n")
    write(git_repo / "tests" / "test_cap.py", PASSING)
    commit_all(git_repo, "artifacts + fix")
    return change


def _fix_gate(git_repo, commit, ok=True):
    """账本追加一条修复体收口门禁事件（slice fix）。"""
    ledger_append(git_repo, "c", {
        "v": 1, "ev": "gate", "change": "c", "at": "2026-10-10T00:00:00Z",
        "by": {"plugin": "flight", "session": "test"},
        "attempt": 1, "agent": "F", "slice": "fix", "ok": ok, "commit": commit,
        "failed": [] if ok else ["G2 test: exit 1"],
    })


def _bookkeeping(git_repo, change):
    write(change / "timeline.md", "x\n")
    return commit_all(git_repo, "chore(flight): 记录")


def _final_reuse(git_repo, change):
    return run_hook("slice-gate", "final", "--change-dir", str(change), "--reuse-fix", cwd=git_repo)


def test_final_reuses_fresh_fix_gate(git_repo):
    # Given: 账本最后一条 fix gate ok、commit 为 X；X 之后只有改 timeline.md 的提交；scenario 测试通过；gate.test 运行时写 ran-g2
    change = _repo(git_repo)
    x = git(git_repo, "rev-parse", "HEAD")
    _fix_gate(git_repo, x)
    head = _bookkeeping(git_repo, change)

    # When: 运行 slice-gate.py final --reuse-fix
    out = json.loads(_final_reuse(git_repo, change).stdout)

    # Then: ok 为 true、ran-g2 不存在；warnings 含 X 的前 10 位；gate-report.md 新增 final ok 行，commit 为 HEAD 前 10 位
    assert out["ok"] is True, out
    assert not (git_repo / "ran-g2").exists()
    assert any(x[:10] in w for w in out["warnings"]), out["warnings"]
    report = (change / "gate-report.md").read_text(encoding="utf-8")
    assert "| final | ok | %s |" % head[:10] in report, report


def test_final_reuse_refused_after_code_change(git_repo):
    # Given: 同上，但 X 之后还有一个改 src/mod.py 的提交
    change = _repo(git_repo)
    _fix_gate(git_repo, git(git_repo, "rev-parse", "HEAD"))
    write(git_repo / "src" / "mod.py", "x = 2\n")
    commit_all(git_repo, "code after fix gate")
    _bookkeeping(git_repo, change)

    # When: 运行 slice-gate.py final --reuse-fix
    p = _final_reuse(git_repo, change)

    # Then: ran-g2 存在；warnings 不含「复用」
    assert (git_repo / "ran-g2").exists()
    out = json.loads(p.stdout)
    assert not any("复用" in w for w in out["warnings"]), out["warnings"]


def test_final_reuse_needs_green_fix_gate(git_repo):
    # Given: 账本最后一条 fix gate 的 ok 为 false，之后只有记账提交
    change = _repo(git_repo)
    _fix_gate(git_repo, git(git_repo, "rev-parse", "HEAD"), ok=False)
    _bookkeeping(git_repo, change)

    # When: 运行 slice-gate.py final --reuse-fix
    p = _final_reuse(git_repo, change)

    # Then: ran-g2 存在；warnings 不含「复用」
    assert (git_repo / "ran-g2").exists()
    out = json.loads(p.stdout)
    assert not any("复用" in w for w in out["warnings"]), out["warnings"]


def test_lint_requires_gate_test(tmp_path):
    # Given: slices.json 合法，但 gate 里没有 test
    data = plan([slice_("S1", ["a/**"])], gate={"test": None, "lint": None, "typecheck": None, "full_suite_sec": None})
    change = write_plan(tmp_path / "c", data)

    # When: 运行 slice-gate.py lint
    p = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 退出码非 0，stderr 含 gate.test
    assert p.returncode != 0
    assert "gate.test" in p.stderr, p.stderr


def test_baseline_marks_running(git_repo):
    # Given: gate.test 是一个读取 gate-baseline.json、running 为 true 才退出 0 的脚本
    write(git_repo / "check_running.py", CHECK_RUNNING)
    change = _repo(git_repo, gate_test="%s check_running.py" % shlex.quote(sys.executable))

    # When: 运行 slice-gate.py baseline
    p = run_hook("slice-gate", "baseline", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0；结束后 gate-baseline.json 的 ok 为 true，且没有 running 字段
    assert p.returncode == 0, p.stdout + p.stderr
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    assert bl["ok"] is True and "running" not in bl, bl


def test_preflight_reports_running_baseline(git_repo):
    # Given: gate-baseline.json 为 running 标记，pid 是当前仍存活的进程
    change = _repo(git_repo)
    write(change / "gate-baseline.json", json.dumps({"running": True, "pid": os.getpid(), "started": "2026-10-10T00:00:00Z"}))

    # When: 运行 slice-gate.py preflight
    p = run_hook("slice-gate", "preflight", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出码非 0，stderr 含「仍在跑」
    assert p.returncode != 0
    assert "仍在跑" in p.stderr, p.stderr


def test_preflight_reports_interrupted_baseline(git_repo):
    # Given: gate-baseline.json 为 running 标记，pid 是一个已经退出的进程
    change = _repo(git_repo)
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    write(change / "gate-baseline.json", json.dumps({"running": True, "pid": gone.pid, "started": "2026-10-10T00:00:00Z"}))

    # When: 运行 slice-gate.py preflight
    p = run_hook("slice-gate", "preflight", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出码非 0，stderr 含「中断」与 baseline
    assert p.returncode != 0
    assert "中断" in p.stderr and "baseline" in p.stderr, p.stderr
