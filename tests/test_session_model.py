"""会话主模型的机械判定（scenario: model-routing#session-model-*）。"""
import json

from conftest import run_hook


def assistant(model, ts="2026-09-10T09:00:00Z", sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain, "timestamp": ts,
            "message": {"model": model, "content": [{"type": "text", "text": "x"}]}}


def transcript(path, rows):
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return path


def test_session_model_resolves_alias(tmp_path):
    # Given: 一份转录，最后一条主循环 assistant 的 model 是 claude-opus-5[1m]
    path = transcript(tmp_path / "sess.jsonl", [
        assistant("claude-sonnet-5", "2026-09-10T08:00:00Z"),
        assistant("claude-opus-5[1m]", "2026-09-10T09:00:00Z"),
    ])

    # When: 以 --session 运行判定脚本，并再取一次 --json 输出
    p = run_hook("session-model", "--session", str(path))
    pj = run_hook("session-model", "--session", str(path), "--json")

    # Then: stdout 是别名 opus 且退出码 0；--json 含 alias / model / session / source，model 保留原始 id
    assert p.returncode == 0, p.stderr
    assert p.stdout.strip() == "opus"
    data = json.loads(pj.stdout)
    assert data["alias"] == "opus" and data["model"] == "claude-opus-5[1m]"
    assert "session" in data and "source" in data


def test_session_model_latest_wins(tmp_path):
    # Given: 2026-09-10 事故会话的形状——中途换过模型（k3 → fable → opus）
    path = transcript(tmp_path / "sess.jsonl", [
        assistant("k3", "2026-09-10T05:27:39Z"),
        assistant("claude-fable-5-1", "2026-09-10T07:38:14Z"),
        assistant("<synthetic>", "2026-09-10T08:18:00Z"),
        assistant("claude-opus-5", "2026-09-10T08:19:02Z"),
    ])

    # When: 运行判定脚本
    p = run_hook("session-model", "--session", str(path))

    # Then: 以最后一条主循环 assistant 为准 → opus；早先的 fable 不影响结果
    assert p.returncode == 0, p.stderr
    assert p.stdout.strip() == "opus"


def test_session_model_skips_sidechain(tmp_path):
    # Given: 转录末尾混有 isSidechain: true 的子 agent 条目（sonnet）
    path = transcript(tmp_path / "sess.jsonl", [
        assistant("claude-opus-5", "2026-09-10T09:00:00Z"),
        assistant("claude-sonnet-5", "2026-09-10T09:05:00Z", sidechain=True),
    ])

    # When: 运行判定脚本
    p = run_hook("session-model", "--session", str(path))

    # Then: 子 agent 条目被跳过，输出仍是最后一条主循环条目的别名
    assert p.returncode == 0, p.stderr
    assert p.stdout.strip() == "opus"


def test_session_model_fails_closed(tmp_path):
    # Given: 四种判定不出的输入——文件不存在 / 无 assistant 条目 / 第三方 id k3 / 既无 --session 也无环境变量
    missing = tmp_path / "nope.jsonl"
    empty = transcript(tmp_path / "empty.jsonl", [{"type": "user", "message": {"content": "hi"}}])
    third = transcript(tmp_path / "k3.jsonl", [assistant("k3")])

    # When: 逐个运行判定脚本
    runs = [run_hook("session-model", "--session", str(missing)),
            run_hook("session-model", "--session", str(empty)),
            run_hook("session-model", "--session", str(third)),
            run_hook("session-model", env={"CLAUDE_CODE_SESSION_ID": ""})]

    # Then: 一律非 0 退出、stdout 不给任何别名；无法映射时 stderr 点名原始 id
    for p in runs:
        assert p.returncode != 0, p.stdout
        assert p.stdout.strip() == ""
        assert p.stderr.strip()
    assert "k3" in runs[2].stderr
