"""test-evidence / timeline / stop-gate / session-decompose（scenario: slice-gate#evidence-*, stop-hook-*, flight-apply#timeline-*, session-decompose-*）。"""
import json

from conftest import run_hook, write


def marker_repo(git_repo):
    change = git_repo / "openspec" / "changes" / "c"
    write(change / "tasks.md", "- [ ] S1 x\n")
    write(change / "slices.json", json.dumps({"version": 1, "change": "c", "gate": {"test": "true"}, "slices": [
        {"id": "S1", "title": "S1", "scenarios": [], "owns": ["src/**"], "deps": [], "verify": "true"}], "scenario_tests": {}}))
    write(git_repo / ".openspec-slice", json.dumps({"slice": "S1", "change_dir": str(change), "base": "HEAD"}))
    return change


def bash_event(cmd, stdout="", stderr="", event="PostToolUse", cwd="."):
    return json.dumps({"hook_event_name": event, "tool_name": "Bash", "cwd": str(cwd),
                       "tool_input": {"command": cmd}, "tool_response": {"stdout": stdout, "stderr": stderr, "interrupted": False}})


# ---------------------------------------------------------------- test-evidence

def test_evidence_log_records_test_runs(git_repo):
    # Given: 根目录有指向切片 S1 的 .openspec-slice 标记；一条 PostToolUse Bash 事件，命令是 pytest 且输出 "3 passed"
    change = marker_repo(git_repo)
    event = bash_event("python3 -m pytest -q tests", stdout="3 passed in 0.1s", cwd=git_repo)

    # When: 运行 test-evidence.py
    p = run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: evidence.log 追加一行，含切片 S1、PASS 与命令
    line = (change / "evidence.log").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\tS1\t" in line
    assert "\tPASS\t" in line
    assert "pytest" in line


def test_evidence_log_records_failed_run(git_repo):
    # Given: 同上标记；一条 PostToolUseFailure Bash 事件，命令是 pytest
    change = marker_repo(git_repo)
    event = bash_event("python3 -m pytest -q tests", stdout="1 failed", event="PostToolUseFailure", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: evidence.log 最后一行标记为 FAIL
    line = (change / "evidence.log").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\tFAIL\t" in line


def test_evidence_ignores_non_test_commands(git_repo):
    # Given: 同上标记；一条 Bash 事件的命令是 git status（不是测试运行器）
    change = marker_repo(git_repo)
    event = bash_event("git status --short", stdout="", cwd=git_repo)

    # When: 运行 test-evidence.py
    run_hook("test-evidence", stdin=event, cwd=git_repo)

    # Then: 不创建 evidence.log
    assert not (change / "evidence.log").exists()


# ---------------------------------------------------------------- stop-gate

def stop_event(cwd, active=False, event="Stop"):
    return json.dumps({"hook_event_name": event, "stop_hook_active": active, "cwd": str(cwd)})


def test_stop_hook_blocks_red_flight(git_repo):
    # Given: 根目录存在指向切片 S1 的 .openspec-slice 标记，stop_hook_active 为 false
    marker_repo(git_repo)

    # When: Stop 事件触发 stop-gate.py
    p = run_hook("stop-gate", stdin=stop_event(git_repo), cwd=git_repo)

    # Then: 输出 decision 为 block，reason 点名 S1
    out = json.loads(p.stdout)
    assert out["decision"] == "block"
    assert "S1" in out["reason"]


def test_stop_hook_respects_stop_hook_active(git_repo):
    # Given: 同上标记，但 stop_hook_active 为 true（本轮已经因 stop hook 续跑过）
    marker_repo(git_repo)

    # When: Stop 事件再次触发 stop-gate.py
    p = run_hook("stop-gate", stdin=stop_event(git_repo, active=True), cwd=git_repo)

    # Then: 不输出 block
    assert "block" not in p.stdout


def test_stop_hook_silent_without_marker(git_repo):
    # Given: 根目录没有 .openspec-slice 标记
    # When: SubagentStop 事件触发 stop-gate.py
    p = run_hook("stop-gate", stdin=stop_event(git_repo, event="SubagentStop"), cwd=git_repo)

    # Then: 无输出
    assert p.stdout.strip() == ""


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


# ---------------------------------------------------------------- session-decompose

FIXTURE = [
    {"type": "user", "timestamp": "2026-09-10T10:00:00Z", "message": {"role": "user", "content": "实现 X"}},
    {"type": "assistant", "timestamp": "2026-09-10T10:00:10Z", "requestId": "r1",
     "message": {"model": "claude-opus-5", "usage": {"input_tokens": 1, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 0, "output_tokens": 50},
                 "content": [{"type": "tool_use", "id": "t1", "name": "Agent", "input": {"description": "impl S1", "prompt": "..."}}]}},
    {"type": "user", "timestamp": "2026-09-10T10:00:11Z", "toolUseResult": {"status": "async_launched", "agentId": "a1", "description": "impl S1", "resolvedModel": "claude-sonnet-5"},
     "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "launched"}]}},
    {"type": "user", "timestamp": "2026-09-10T10:05:11Z", "message": {"role": "user", "content": "<task-notification><task-id>a1</task-id><status>completed</status><result>done</result></task-notification>"}},
    {"type": "assistant", "timestamp": "2026-09-10T10:05:20Z", "requestId": "r2",
     "message": {"model": "claude-opus-5", "usage": {"input_tokens": 1, "cache_read_input_tokens": 2000, "cache_creation_input_tokens": 0, "output_tokens": 20},
                 "content": [{"type": "text", "text": "完成"}]}},
    {"type": "system", "subtype": "turn_duration", "timestamp": "2026-09-10T10:05:20Z"},
]


def test_session_decompose_prints_workflow_models(tmp_path):
    # Given: 一个 workflow journal 目录，含一个 agent 转录（assistant 消息 model 为 claude-sonnet-5）与其 meta.json（description "S4"）
    wf = tmp_path / "wf"
    wf.mkdir()
    (wf / "agent-a1.jsonl").write_text("\n".join(json.dumps(r) for r in [
        {"type": "assistant", "timestamp": "2026-09-10T10:00:00Z", "requestId": "r1", "message": {"model": "claude-sonnet-5", "usage": {}, "content": [{"type": "text", "text": "x"}]}},
        {"type": "assistant", "timestamp": "2026-09-10T10:03:00Z", "requestId": "r2", "message": {"model": "claude-sonnet-5", "usage": {}, "content": [{"type": "text", "text": "y"}]}},
    ]) + "\n", encoding="utf-8")
    (wf / "agent-a1.meta.json").write_text(json.dumps({"description": "S4", "workflowPhase": "Implement"}), encoding="utf-8")
    sess = tmp_path / "sess.jsonl"
    sess.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in FIXTURE) + "\n", encoding="utf-8")

    # When: 运行 session-decompose.py --session --workflow <dir>
    p = run_hook("session-decompose", "--session", str(sess), "--workflow", str(wf))

    # Then: 输出的工作流 agent 表含标签 S4 与实际模型 claude-sonnet-5
    assert p.returncode == 0, p.stderr
    assert "S4" in p.stdout and "claude-sonnet-5" in p.stdout


def test_session_decompose_runs(tmp_path):
    # Given: 一个含人类消息、Agent 派发、异步结果、task-notification、收尾 assistant 的最小转录 fixture
    path = tmp_path / "sess.jsonl"
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in FIXTURE) + "\n", encoding="utf-8")

    # When: 运行 session-decompose.py --session
    p = run_hook("session-decompose", "--session", str(path))

    # Then: 退出码 0，输出含「等子 agent」「模型生成」两类归因与派发数 1
    assert p.returncode == 0, p.stderr
    assert "等子 agent" in p.stdout and "模型生成" in p.stdout
    assert "派发 1" in p.stdout
