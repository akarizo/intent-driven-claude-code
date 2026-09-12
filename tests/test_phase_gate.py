"""阶段纪律与起飞模型确认门禁（scenario: phase-discipline#* · takeoff-model-confirm#*）。

骨架：S1 未实现前全部 xfail(strict=True)；S1 实现后去掉标记即解锁。
"""
import json

import pytest

from conftest import run_hook

pytestmark = pytest.mark.xfail(strict=True, reason="S1 未实现 phase-gate.py；实现后去掉本标记")


# ---------- 转录与 hook 载荷构造（形状同 tests/test_approval_gate.py） ----------

def human(text, ts="2026-09-12T07:00:00Z"):
    return {"type": "user", "isSidechain": False, "isMeta": False, "userType": "external",
            "timestamp": ts, "message": {"role": "user", "content": text}}


def assistant(model, ts="2026-09-12T07:01:00Z"):
    return {"type": "assistant", "isSidechain": False, "timestamp": ts,
            "message": {"role": "assistant", "model": model, "content": []}}


def transcript(path, rows):
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return path


def cmd_msg(name, args=""):
    return ("<command-message>%s</command-message> <command-name>/%s</command-name> "
            "<command-args>%s</command-args>" % (name, name, args))


def pre_tool(tool_name, tool_input, tpath, cwd):
    return json.dumps({"hook_event_name": "PreToolUse", "tool_name": tool_name,
                       "tool_input": tool_input, "transcript_path": str(tpath), "cwd": str(cwd)})


def prompt_payload(prompt, tpath, cwd):
    return json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt,
                       "transcript_path": str(tpath), "cwd": str(cwd)})


def change_dir(tmp_path, name="demo"):
    """最小 change 目录，带一份 3 片 / 2 wave 的 slices.json 供 stderr 打印规模。"""
    d = tmp_path / "openspec" / "changes" / name
    (d / "slices").mkdir(parents=True)
    (d / "slices.json").write_text(json.dumps({
        "version": 1, "change": name,
        "slices": [{"id": "S1", "deps": []}, {"id": "S2", "deps": ["S1"]}, {"id": "S3", "deps": ["S1"]}],
    }), encoding="utf-8")
    return d


def decision(stdout):
    """从 hook stdout 取 permissionDecision；无输出返回 None。"""
    if not stdout.strip():
        return None
    return json.loads(stdout)["hookSpecificOutput"]["permissionDecision"]


# ---------- phase-discipline ----------

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


# ---------- takeoff-model-confirm ----------

def test_blocks_apply_without_confirm(tmp_path):
    # Given: 转录末条主循环 assistant 是 fable；人敲的 /opsx-apply 不含确认 flag
    change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [human(cmd_msg("opsx-apply", "demo")), assistant("claude-fable-5-1")])

    # When: 走 UserPromptSubmit 判定
    p = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-apply", "demo"), t, tmp_path))

    # Then: 退出码 2 阻断，stderr 给出 change、当前模型别名、规模与可直接复制的补救命令
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "demo" in p.stderr and "fable" in p.stderr
    assert "--confirm-model=fable" in p.stderr
    assert "3" in p.stderr and "2" in p.stderr  # 切片数 3 · wave 数 2


def test_accepts_matching_confirm(tmp_path):
    # Given: 实测主模型别名 fable，prompt 带一致的确认 flag
    change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [assistant("claude-fable-5-1")])

    # When: 走判定
    p = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-apply", "demo --confirm-model=fable"), t, tmp_path))

    # Then: 静默放行，且不产生任何输出（证据在 prompt 里，不落盘）
    assert p.returncode == 0, (p.returncode, p.stderr)
    assert p.stdout.strip() == ""


def test_rejects_mismatched_confirm(tmp_path):
    # Given: 实测主模型是 fable，但 flag 声称 opus
    change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [assistant("claude-fable-5-1")])

    # When: 走判定
    p = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-apply", "demo --confirm-model=opus"), t, tmp_path))

    # Then: 阻断并同时点名 flag 声称的与实测的两个别名
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "opus" in p.stderr and "fable" in p.stderr


def test_confirm_required_every_takeoff(tmp_path):
    # Given: 转录里已有一次带 flag 的历史起飞，本次 prompt 不带 flag
    change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [
        human(cmd_msg("opsx-apply", "demo --confirm-model=fable"), "2026-09-12T06:00:00Z"),
        assistant("claude-fable-5-1", "2026-09-12T06:01:00Z"),
    ])

    # When: 再次起飞但不带 flag
    p = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-apply", "demo"), t, tmp_path))

    # Then: 仍然阻断，并照常给出本次的补救命令——确认是每次起飞的动作，不继承历史
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "--confirm-model=fable" in p.stderr


def test_unrelated_prompt_passes(tmp_path):
    # Given: 与起飞无关的两种 prompt
    change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [assistant("claude-fable-5-1")])

    # When: 分别是普通提问与 /opsx-propose
    p1 = run_hook("phase-gate", stdin=prompt_payload("帮我看看这段代码", t, tmp_path))
    p2 = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-propose", "demo"), t, tmp_path))

    # Then: 都放行——本门禁只在起飞命令上生效
    assert p1.returncode == 0, p1.stderr
    assert p2.returncode == 0, p2.stderr


def test_unresolvable_model_fails_open(tmp_path):
    # Given: 一份没有任何 assistant 条目的转录，和一份模型 id 认不出别名的转录
    change_dir(tmp_path)
    t_none = transcript(tmp_path / "none.jsonl", [human("hi")])
    t_k3 = transcript(tmp_path / "k3.jsonl", [assistant("k3")])

    # When: 两种情况下都敲不带 flag 的 /opsx-apply
    p_none = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-apply", "demo"), t_none, tmp_path))
    p_k3 = run_hook("phase-gate", stdin=prompt_payload(cmd_msg("opsx-apply", "demo"), t_k3, tmp_path))

    # Then: 读不出模型 → 放行（阻断会抹掉 prompt，不能把人锁在门外）；id 认不出 → 阻断并点名原始 id
    assert p_none.returncode == 0, (p_none.returncode, p_none.stderr)
    assert p_k3.returncode == 2, (p_k3.returncode, p_k3.stdout, p_k3.stderr)
    assert "k3" in p_k3.stderr
