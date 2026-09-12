"""阶段纪律门禁（scenario: phase-discipline#*）。

骨架：S2 未实现前全部 xfail(strict=True)；S2 实现后去掉标记即解锁。
"""
import json

import pytest

from conftest import run_hook

pytestmark = pytest.mark.xfail(strict=True, reason="S2 未实现 phase-gate.py；实现后去掉本标记")


def human(text, ts="2026-09-12T07:00:00Z"):
    return {"type": "user", "isSidechain": False, "isMeta": False, "userType": "external",
            "timestamp": ts, "message": {"role": "user", "content": text}}


def transcript(path, rows):
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return path


def cmd_msg(name, args=""):
    return ("<command-message>%s</command-message> <command-name>/%s</command-name> "
            "<command-args>%s</command-args>" % (name, name, args))


def pre_tool(tool_name, tool_input, tpath, cwd):
    return json.dumps({"hook_event_name": "PreToolUse", "tool_name": tool_name,
                       "tool_input": tool_input, "transcript_path": str(tpath), "cwd": str(cwd)})


def change_dir(tmp_path, name="demo"):
    d = tmp_path / "openspec" / "changes" / name
    (d / "slices").mkdir(parents=True)
    (d / "slices.json").write_text(json.dumps({"version": 1, "change": name, "slices": []}), encoding="utf-8")
    return d


def decision(stdout):
    """从 hook stdout 取 permissionDecision；无输出返回 None。"""
    if not stdout.strip():
        return None
    return json.loads(stdout)["hookSpecificOutput"]["permissionDecision"]


def test_explore_denies_flight_plan_write(tmp_path):
    # Given: 最后一条人类命令消息是 /opsx-explore
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [human(cmd_msg("opsx-explore", "查询 temp queue"))])

    # When: 在该阶段分别写三类飞行计划工件
    outs = [run_hook("phase-gate", stdin=pre_tool("Write", {"file_path": str(d / rel)}, t, tmp_path))
            for rel in ("slices.json", "tasks.md", "slices/S1.md")]

    # Then: 三次都被 deny，理由点名 explore 阶段并要求显式 /opsx-propose
    for p in outs:
        assert decision(p.stdout) == "deny", p.stdout
        reason = json.loads(p.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
        assert "explore" in reason and "/opsx-propose" in reason


def test_explore_allows_thinking_artifacts(tmp_path):
    # Given: 同一份 explore 转录
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [human(cmd_msg("opsx-explore"))])

    # When: 写 proposal / design / specs 三类"捕捉思考"工件
    outs = [run_hook("phase-gate", stdin=pre_tool("Write", {"file_path": str(d / rel)}, t, tmp_path))
            for rel in ("proposal.md", "design.md", "specs/cap/spec.md")]

    # Then: 一律静默放行——explore 仍可捕捉思考
    for p in outs:
        assert p.returncode == 0 and decision(p.stdout) is None, p.stdout


def test_explore_denies_baseline(tmp_path):
    # Given: 同一份 explore 转录
    change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [human(cmd_msg("opsx-explore"))])
    base = "python3 .claude/hooks/slice-gate.py baseline --change-dir openspec/changes/demo"
    lint = "python3 .claude/hooks/slice-gate.py lint --change-dir openspec/changes/demo"

    # When: 分别跑 baseline 与 lint
    p_base = run_hook("phase-gate", stdin=pre_tool("Bash", {"command": base}, t, tmp_path))
    p_lint = run_hook("phase-gate", stdin=pre_tool("Bash", {"command": lint}, t, tmp_path))

    # Then: baseline 被 deny（理由说明它属 propose 收口），lint 放行
    assert decision(p_base.stdout) == "deny", p_base.stdout
    assert "baseline" in json.loads(p_base.stdout)["hookSpecificOutput"]["permissionDecisionReason"]
    assert decision(p_lint.stdout) is None, p_lint.stdout


def test_non_explore_phase_passes(tmp_path):
    # Given: 一份 propose 阶段的转录，与一份完全没有命令消息的转录
    d = change_dir(tmp_path)
    t_propose = transcript(tmp_path / "p.jsonl", [human(cmd_msg("opsx-propose", "demo"))])
    t_bare = transcript(tmp_path / "b.jsonl", [human("随便聊两句")])

    # When: 两种转录下都写 slices.json
    payload = {"file_path": str(d / "slices.json")}
    p1 = run_hook("phase-gate", stdin=pre_tool("Write", payload, t_propose, tmp_path))
    p2 = run_hook("phase-gate", stdin=pre_tool("Write", payload, t_bare, tmp_path))

    # Then: 都放行——本门禁只约束 explore 阶段，判不出阶段不锁死能力
    assert p1.returncode == 0 and decision(p1.stdout) is None, p1.stdout
    assert p2.returncode == 0 and decision(p2.stdout) is None, p2.stdout


def test_phase_gate_fails_open_on_error(tmp_path):
    # Given: 转录路径不存在，以及内容不是合法 JSONL 的转录
    d = change_dir(tmp_path)
    missing = tmp_path / "nope.jsonl"
    broken = tmp_path / "broken.jsonl"
    broken.write_text("{ 这不是 json\n", encoding="utf-8")

    # When: 两种坏转录下都写 slices.json
    payload = {"file_path": str(d / "slices.json")}
    p1 = run_hook("phase-gate", stdin=pre_tool("Write", payload, missing, tmp_path))
    p2 = run_hook("phase-gate", stdin=pre_tool("Write", payload, broken, tmp_path))

    # Then: 一律放行——坏门禁不绑架用户
    assert p1.returncode == 0 and decision(p1.stdout) is None, p1.stdout
    assert p2.returncode == 0 and decision(p2.stdout) is None, p2.stdout
