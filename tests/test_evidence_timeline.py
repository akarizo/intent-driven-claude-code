"""test-evidence / timeline / 退役 hook（scenario: slice-gate#evidence-*, flight-apply#timeline-*, flight-retire-hooks#*）。
test-evidence 只记飞行外：切片 worktree（有 .openspec-slice 标记）一律不写，测试结果由控制面测量入账本。"""
import json

from conftest import HOOKS, git, run_hook, write


def marker_repo(git_repo):
    change = git_repo / "openspec" / "changes" / "c"
    write(change / "tasks.md", "- [ ] S1 x\n")
    write(change / "slices.json", json.dumps({"version": 1, "change": "c", "gate": {"test": "true"}, "slices": [
        {"id": "S1", "title": "S1", "scenarios": [], "owns": ["src/**"], "deps": [], "verify": "true"}], "scenario_tests": {}}))
    write(git_repo / ".openspec-slice", json.dumps({"slice": "S1", "change_dir": str(change), "base": "HEAD"}))
    return change


def branch_repo(git_repo, name="c"):
    """无标记、分支 worktree-<name> 的仓库（飞行外的 per-task 路径）。"""
    change = git_repo / "openspec" / "changes" / name
    write(change / "tasks.md", "- [ ] S1 x\n")
    git(git_repo, "checkout", "-q", "-b", "worktree-" + name)
    return change


def bash_event(cmd, stdout="", stderr="", event="PostToolUse", cwd="."):
    return json.dumps({"hook_event_name": event, "tool_name": "Bash", "cwd": str(cwd),
                       "tool_input": {"command": cmd}, "tool_response": {"stdout": stdout, "stderr": stderr, "interrupted": False}})


# ---------------------------------------------------------------- test-evidence

def test_evidence_log_records_test_runs(git_repo):
    # Given: 无标记、分支 worktree-c；一条 PostToolUse Bash 事件，命令是 pytest 且输出 "3 passed"
    change = branch_repo(git_repo)
    event = bash_event("python3 -m pytest -q tests", stdout="3 passed in 0.1s", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: evidence.log 追加一行，含切片列 -、PASS 与命令
    line = (change / "evidence.log").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\t-\t" in line
    assert "\tPASS\t" in line
    assert "pytest" in line


def test_evidence_log_records_failed_run(git_repo):
    # Given: 无标记、分支 worktree-c；一条 PostToolUseFailure Bash 事件，命令是 pytest
    change = branch_repo(git_repo)
    event = bash_event("python3 -m pytest -q tests", stdout="1 failed", event="PostToolUseFailure", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: evidence.log 最后一行标记为 FAIL
    line = (change / "evidence.log").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\tFAIL\t" in line


def test_evidence_ignores_non_test_commands(git_repo):
    # Given: 无标记、分支 worktree-c；一条 Bash 事件的命令是 git status（不是测试运行器）
    change = branch_repo(git_repo)
    event = bash_event("git status --short", stdout="", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: 不创建 evidence.log
    assert not (change / "evidence.log").exists()


# ---------------------------------------------------------------- timeline

def test_timeline_record_appends(tmp_path):
    # Given: 一个空的 change 目录
    change = tmp_path / "c"
    change.mkdir()

    # When: 运行 timeline.py record approve --note 起飞
    p = run_hook("timeline", "record", "approve", "--change-dir", str(change), "--note", "起飞")

    # Then: timeline.md 存在且最后一行含 approve 与备注
    assert p.returncode == 0, p.stderr
    line = (change / "timeline.md").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\tapprove\t起飞" in line


def test_timeline_report(tmp_path):
    # Given: timeline.md 里 approve 在 10:00:00、pr-open 在 10:30:00
    change = tmp_path / "c"
    write(change / "timeline.md", """
        <!-- timeline -->
        2026-09-10T10:00:00Z\tapprove\t
        2026-09-10T10:12:00Z\tgate\tS1 ok
        2026-09-10T10:30:00Z\tpr-open\thttps://x
    """)

    # When: 运行 timeline.py report
    p = run_hook("timeline", "report", "--change-dir", str(change))

    # Then: 输出含批准到 PR 打开的分钟数 30
    assert p.returncode == 0, p.stderr
    assert "30" in p.stdout and "approve" in p.stdout


# ---------------------------------------------------------------- flight-preflight-and-retry（scenario: evidence-change-resolution#*）
# 无标记时：分支名 → 唯一候选 → 不写；有标记一律不写。


def _changes(git_repo, names):
    for n in names:
        write(git_repo / "openspec" / "changes" / n / "tasks.md", "- [ ] S1 x\n")


def test_evidence_resolves_change_from_branch(git_repo):
    # Given: 无标记；分支 worktree-c；change a 与 c 的 tasks.md 都有未勾选项（a 按字母序在前）
    _changes(git_repo, ["a", "c"])
    git(git_repo, "checkout", "-q", "-b", "worktree-c")
    event = bash_event("python3 -m pytest -q tests", stdout="1 passed", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: 写进 c，切片列为 -；a 下没有 evidence.log
    line = (git_repo / "openspec" / "changes" / "c" / "evidence.log").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\t-\t" in line and "pytest" in line
    assert not (git_repo / "openspec" / "changes" / "a" / "evidence.log").exists()


def test_evidence_skips_ambiguous_change(git_repo):
    # Given: 无标记；分支 main；change a 与 b 都有未勾选项
    _changes(git_repo, ["a", "b"])
    event = bash_event("python3 -m pytest -q tests", stdout="1 passed", cwd=git_repo)

    # When: 运行 test-evidence.py
    p = run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: 两个目录都没有 evidence.log；退出 0
    assert not (git_repo / "openspec" / "changes" / "a" / "evidence.log").exists()
    assert not (git_repo / "openspec" / "changes" / "b" / "evidence.log").exists()
    assert p.returncode == 0


def test_evidence_single_candidate_fallback(git_repo):
    # Given: 无标记；分支 main；只有 change a 有未勾选项
    _changes(git_repo, ["a"])
    event = bash_event("python3 -m pytest -q tests", stdout="1 passed", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: 单候选时写进 a
    assert (git_repo / "openspec" / "changes" / "a" / "evidence.log").exists()


# ---------------------------------------------------------------- flight-measure


from conftest import ledger_append, make_change  # noqa: E402


def _ev(change, **fields):
    return dict({"v": 1, "change": change, "at": "2026-10-10T10:00:00Z", "by": {"plugin": "flight", "session": "test"}}, **fields)


def test_red_count_from_ledger(git_repo):
    # Given: timeline.md 没有 red 行；账本含 takeoff、2 条红 gate、1 条绿 gate、1 条红 final、3 条 measure（2 条有 FAILED）
    d = make_change(git_repo)
    write(d / "timeline.md", "2026-10-10T09:00:00Z\tapprove\tx\n2026-10-10T09:30:00Z\tgate\tS1 ok\n")
    gate = {"attempt": 1, "slice": "S1", "commit": "c" * 40}
    measure = {"ev": "measure", "attempt": 1, "slice": "S1", "agent": "a1", "base": "f" * 40, "commit": "e" * 40,
               "changed": [], "source": []}
    rows = [
        {"ev": "takeoff", "attempt": 1, "fp": "a" * 64, "branch": "worktree-demo", "waves": [["S1"]], "model": "opus"},
        dict(measure, outcomes=[["t", "XFAIL"]]),
        dict(measure, outcomes=[["t", "FAILED"]]),
        dict(measure, outcomes=[["t", "ERROR"], ["u", "PASSED"]]),
        dict(gate, ev="gate", ok=False, failed=["G1 verify"]),
        dict(gate, ev="gate", ok=False, failed=["G7 scenario"]),
        dict(gate, ev="gate", ok=True, failed=[]),
        {"ev": "final", "attempt": 1, "ok": False, "commit": "d" * 40, "failed": ["G1"]},
    ]
    for r in rows:
        ledger_append(git_repo, "demo", _ev("demo", **r))

    # When: 运行 timeline.py report
    out = run_hook("timeline", "report", "--change-dir", str(d)).stdout

    # Then: 门禁红次数 3（切片门禁 2、final 1）；测量 3 次、见红 2 次
    assert "门禁红次数：3" in out and "切片门禁 2" in out and "final 1" in out, out
    assert "测量：3 次（见红 2 次）" in out, out


def test_evidence_skips_ledger_marked_slice(git_repo):
    # Given: 仓库根的切片标记写明 evidence=ledger；一条 pytest 的 PostToolUse
    change = marker_repo(git_repo)
    marker = git_repo / ".openspec-slice"
    data = json.loads(marker.read_text(encoding="utf-8"))
    marker.write_text(json.dumps(dict(data, evidence="ledger")), encoding="utf-8")
    event = bash_event("python3 -m pytest -q tests", stdout="3 passed in 0.1s", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: 没有写 evidence.log
    assert not (change / "evidence.log").exists()


# ---------------------------------------------------------------- flight-retire-workflow-engine（scenario: flight-retire-hooks#*）


def test_stop_gate_is_noop(git_repo):
    # Given: 根目录有指向切片 S1 的 .openspec-slice 标记（无 red_count，本片门禁未绿）；SubagentStop 载荷 stop_hook_active=false
    marker_repo(git_repo)
    payload = json.dumps({"hook_event_name": "SubagentStop", "stop_hook_active": False, "cwd": str(git_repo)})

    # When: 以该载荷运行 stop-gate.py
    p = run_hook("stop-gate", stdin=payload, cwd=git_repo)

    # Then: 退出 0；stdout 为空（不 block）
    assert p.returncode == 0, p.stderr
    assert p.stdout.strip() == "", p.stdout


def test_test_evidence_skips_slice_worktrees(git_repo, tmp_path):
    # Given: 仓库甲有指向 change c 的 .openspec-slice 标记且 evidence="log"（c 的 tasks.md 有未勾选项）；
    #        仓库乙在 worktree-demo 分支、无标记、有 openspec/changes/demo；两边都是跑 pytest 输出 "1 passed" 的 Bash 载荷
    change_c = marker_repo(git_repo)
    marker = git_repo / ".openspec-slice"
    marker.write_text(json.dumps(dict(json.loads(marker.read_text(encoding="utf-8")), evidence="log")), encoding="utf-8")
    other = tmp_path / "other"
    other.mkdir()
    git(other, "init", "-q", "-b", "main")
    git(other, "config", "user.email", "t@example.com")
    git(other, "config", "user.name", "t")
    git(other, "commit", "-q", "--allow-empty", "-m", "init")
    demo = branch_repo(other, "demo")
    cmd = "python3 -m pytest -q tests"

    # When: 分别在两个仓库运行 test-evidence.py
    for repo in (git_repo, other):
        run_hook("test-evidence", stdin=bash_event(cmd, stdout="1 passed", cwd=repo), cwd=repo)

    # Then: 甲的 c 下没有 evidence.log；乙的 demo/evidence.log 恰好新增一行
    assert not (change_c / "evidence.log").exists()
    assert len((demo / "evidence.log").read_text(encoding="utf-8").strip().splitlines()) == 1


def test_retired_hooks_unregistered():
    # Given: 本 change 合入后的模板 template/.claude/hooks/
    hooks_json = HOOKS / "hooks.json"

    # When: 读取 hooks.json 里全部 hook 命令
    config = json.loads(hooks_json.read_text(encoding="utf-8"))
    commands = " ".join(h["command"] for groups in config["hooks"].values() for g in groups for h in g["hooks"])

    # Then: 不含 takeoff-gate.py、checkpoint、stop-gate.py；仍含 test-evidence.py；session-decompose.py 不存在
    assert "takeoff-gate.py" not in commands
    assert "checkpoint" not in commands
    assert "stop-gate.py" not in commands
    assert "test-evidence.py" in commands
    assert not (HOOKS / "session-decompose.py").exists()
