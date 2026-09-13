"""起飞前的人类批准门禁（scenario: takeoff-approval#* · takeoff-model-confirm#*）。
S4 与 S1 已实现，骨架标记已去。"""
import json
import os
from datetime import datetime, timezone

import pytest
from conftest import ROOT, run_hook

CMD = ROOT / "template" / ".claude" / "commands"
SKILLS = ROOT / "template" / ".claude" / "skills"


def epoch(iso):
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def human(text, ts):
    return {"type": "user", "isSidechain": False, "isMeta": False, "userType": "external",
            "timestamp": ts, "message": {"role": "user", "content": text}}


def transcript(path, rows):
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return path


def change_dir(tmp_path, plan_iso="2026-09-10T08:00:00Z", under=""):
    """建一个最小 change 工件目录，并把计划工件的 mtime 钉在 plan_iso。"""
    d = tmp_path.joinpath(*([under] if under else []), "openspec", "changes", "demo")
    (d / "specs" / "cap").mkdir(parents=True)
    for rel in ("proposal.md", "design.md", "tasks.md", "slices.json", "spec.html", "specs/cap/spec.md"):
        (d / rel).write_text("x", encoding="utf-8")
    for rel in ("proposal.md", "design.md", "tasks.md", "slices.json", "specs/cap/spec.md"):
        os.utime(d / rel, (epoch(plan_iso), epoch(plan_iso)))
    return d


APPLY_CMD = ("<command-message>opsx-apply</command-message> "
             "<command-name>/opsx-apply</command-name> <command-args>demo</command-args>")
CONFIRM_AT = "2026-09-10T08:58:40Z"


def approved_rows(init_ts="2026-09-10T08:58:04Z", confirm_ts=CONFIRM_AT):
    """两段式握手的最小成立形态：一条发起（/opsx-apply）+ 其后一条人类短确认。"""
    return [human(APPLY_CMD, init_ts), human("起飞", confirm_ts)]


def test_approval_gate_accepts_human_command(tmp_path):
    # Given: 一份只有 /opsx-apply 发起的转录，与一份发起后人又补了短确认「起飞」的转录，两者都晚于计划工件 mtime
    d = change_dir(tmp_path)
    typed = transcript(tmp_path / "typed.jsonl", [human(APPLY_CMD, "2026-09-10T08:58:04Z")])
    confirmed = transcript(tmp_path / "confirmed.jsonl", approved_rows())

    # When: 分别以 --session 运行门禁
    p1 = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(typed))
    p2 = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(confirmed))

    # Then: 只发起不成立（非 0 退出、stdout 无批准结论）；补了确认才成立，且证据取确认那一刻的时间与原话
    assert p1.returncode != 0, p1.stdout
    assert "已批准" not in p1.stdout
    assert p2.returncode == 0, p2.stderr
    assert CONFIRM_AT in p2.stdout and "起飞" in p2.stdout


def test_approval_gate_rejects_self_start(tmp_path):
    # Given: 最近的人类消息只是继续规划类指令，既无 /opsx-apply 调用也无批准词
    d = change_dir(tmp_path)
    sess = transcript(tmp_path / "sess.jsonl", [
        human("<command-message>opsx-propose</command-message> <command-name>/opsx-propose</command-name> "
              "<command-args>修复这个问题</command-args>", "2026-09-10T07:38:07Z"),
        human("继续上述任务的规划", "2026-09-10T08:30:00Z"),
    ])

    # When: 运行门禁
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(sess))

    # Then: 非 0 退出，stdout 不给"已批准"结论，stderr 说明需人类显式批准并给出 spec.html 路径
    assert p.returncode != 0, p.stdout
    assert "批准" not in p.stdout
    assert "spec.html" in p.stderr and "/opsx-apply" in p.stderr


def test_approval_gate_requires_fresh_approval(tmp_path):
    # Given: 两段式握手在 08:58 完成（发起 + 确认），而计划工件在 09:30 又被改过
    d = change_dir(tmp_path, plan_iso="2026-09-10T09:30:00Z")
    sess = transcript(tmp_path / "sess.jsonl", approved_rows())

    # When: 运行门禁
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(sess))

    # Then: 非 0 退出，stderr 点名计划在批准之后改过、需重新批准
    assert p.returncode != 0, p.stdout
    assert "重新批准" in p.stderr


def test_takeoff_hook_denies_unapproved_dispatch(tmp_path):
    # Given: 一次指向该 change 的 Workflow 派发；转录里没有批准 / 有批准两种情况
    d = change_dir(tmp_path)
    none = transcript(tmp_path / "none.jsonl", [human("继续", "2026-09-10T08:30:00Z")])
    okay = transcript(tmp_path / "ok.jsonl", approved_rows())
    payload = {"tool_name": "Workflow", "cwd": str(tmp_path),
               "tool_input": {"name": "opsx-apply", "args": {"changeDir": str(d)}}}

    # When: 以 hook 模式（stdin 收 PreToolUse JSON）分别运行；再补一条线上真实形态——args 是 JSON 字符串、走 scriptPath
    p1 = run_hook("takeoff-gate", stdin=json.dumps({**payload, "transcript_path": str(none)}))
    p2 = run_hook("takeoff-gate", stdin=json.dumps({**payload, "transcript_path": str(okay)}))
    real = {"tool_name": "Workflow", "cwd": str(tmp_path), "transcript_path": str(none),
            "tool_input": {"scriptPath": "/x/template/.claude/workflows/opsx-apply.js",
                           "args": json.dumps({"change": "demo", "changeDir": str(d)})}}
    p3 = run_hook("takeoff-gate", stdin=json.dumps(real))

    # Then: 未批准时输出 permissionDecision=deny 且 reason 含 spec.html 与显式 /opsx-apply 指引；已批准时静默放行；
    #       args 为 JSON 字符串的真实形态同样 deny（这是主强制点唯一的线上形态，回归就会静默 fail-open）
    out = json.loads(p1.stdout)
    hook_out = out["hookSpecificOutput"]
    assert hook_out["permissionDecision"] == "deny"
    assert "spec.html" in hook_out["permissionDecisionReason"] and "/opsx-apply" in hook_out["permissionDecisionReason"]
    assert p2.returncode == 0 and p2.stdout.strip() == ""
    assert json.loads(p3.stdout)["hookSpecificOutput"]["permissionDecision"] == "deny", p3.stdout


def test_takeoff_hook_denies_prompt_path_wrapped_in_backticks(tmp_path):
    # Given: 未批准的转录，与两种真实 prompt 形状的派发——① 中文全角冒号紧邻 + 反引号包住的相对路径
    #        ② 前面多带一段仓库名的路径（cwd 下需剥掉最前面的片段才是真目录）
    d = change_dir(tmp_path)
    deep = change_dir(tmp_path, under="template")
    none = transcript(tmp_path / "none.jsonl", [human("继续", "2026-09-10T08:30:00Z")])
    quoted = {"tool_name": "Agent", "cwd": str(tmp_path), "transcript_path": str(none),
              "tool_input": {"subagent_type": "slice-executor",
                             "prompt": "切片包：`openspec/changes/demo/slices/S1.md`，按 TDD 执行"}}
    prefixed = {"tool_name": "Agent", "cwd": str(tmp_path), "transcript_path": str(none),
                "tool_input": {"subagent_type": "slice-executor",
                               "prompt": "读 idcc/template/openspec/changes/demo/slices/S1.md 再开工"}}

    # When: 以 hook 模式分别运行
    p1 = run_hook("takeoff-gate", stdin=json.dumps(quoted))
    p2 = run_hook("takeoff-gate", stdin=json.dumps(prefixed))

    # Then: 两种形状都识别出 change 目录并 deny，reason 点名各自的目录（不再静默 fail-open）
    r1 = json.loads(p1.stdout)["hookSpecificOutput"]
    r2 = json.loads(p2.stdout)["hookSpecificOutput"]
    assert r1["permissionDecision"] == "deny" and str(d) in r1["permissionDecisionReason"]
    assert r2["permissionDecision"] == "deny" and str(deep) in r2["permissionDecisionReason"]


def test_takeoff_cli_honors_equals_form_change_dir(tmp_path):
    # Given: 一份无批准的转录、一份有批准的转录，命令行用 --change-dir=DIR 等号写法且 stdin 为空
    d = change_dir(tmp_path)
    none = transcript(tmp_path / "none.jsonl", [human("继续", "2026-09-10T08:30:00Z")])
    okay = transcript(tmp_path / "ok.jsonl", approved_rows())

    # When: 以等号写法分别运行 CLI 模式
    p1 = run_hook("takeoff-gate", "--change-dir=" + str(d), "--session=" + str(none))
    p2 = run_hook("takeoff-gate", "--change-dir=" + str(d), "--session=" + str(okay))

    # Then: 无批准时非 0 退出且 stderr 给补救指引；有批准时 exit 0 并打印批准证据（等号写法不得退化成静默放行）
    assert p1.returncode != 0, p1.stdout
    assert "spec.html" in p1.stderr
    assert p2.returncode == 0 and CONFIRM_AT in p2.stdout


def test_takeoff_hook_ignores_unrelated_dispatch(tmp_path):
    # Given: 一次与飞行无关的派发，以及一次转录不可读的飞行派发
    d = change_dir(tmp_path)
    unrelated = {"tool_name": "Agent", "cwd": str(tmp_path),
                 "tool_input": {"subagent_type": "Explore", "prompt": "找一下登录逻辑在哪"}}
    broken = {"tool_name": "Workflow", "cwd": str(tmp_path), "transcript_path": str(tmp_path / "nope.jsonl"),
              "tool_input": {"name": "opsx-apply", "args": {"changeDir": str(d)}}}

    # When: 以 hook 模式运行两者
    p1 = run_hook("takeoff-gate", stdin=json.dumps(unrelated))
    p2 = run_hook("takeoff-gate", stdin=json.dumps(broken))

    # Then: 都静默放行（无输出、退出码 0）——坏门禁不锁死派发能力
    assert p1.returncode == 0 and p1.stdout.strip() == ""
    assert p2.returncode == 0 and p2.stdout.strip() == ""


def test_propose_ends_with_handoff():
    # Given: /opsx-propose 命令与 openspec-propose skill
    cmd = (CMD / "opsx-propose.md").read_text(encoding="utf-8")
    skill = (SKILLS / "openspec-propose" / "SKILL.md").read_text(encoding="utf-8")

    # When: 阅读两者的收尾步骤
    texts = [cmd, skill]

    # Then: 都要求打印 spec.html 绝对路径并声明本轮结束、起飞需人类显式 /opsx-apply；不再有"运行 /opsx-apply 即视为批准"
    for t in texts:
        assert "绝对路径" in t and "spec.html" in t
        assert "本命令到此结束" in t or "本 skill 到此结束" in t
        assert "/opsx-apply" in t and "takeoff-gate" in t
        assert "即视为批准" not in t


def test_takeoff_hook_allows_reviewer_dispatch(tmp_path):
    # Given: 转录里没有任何批准，一次 /pr-ship 的 code-reviewer 派发在 prompt 里提到了该 change 目录
    d = change_dir(tmp_path)
    none = transcript(tmp_path / "none.jsonl", [human("继续", "2026-09-10T08:30:00Z")])
    reviewer = {"tool_name": "Agent", "cwd": str(tmp_path), "transcript_path": str(none),
                "tool_input": {"subagent_type": "code-reviewer",
                               "prompt": "参考 openspec/changes/demo/gate-report.md 审这次 PR 的 diff"}}

    # When: 以 hook 模式运行
    p = run_hook("takeoff-gate", stdin=json.dumps(reviewer))

    # Then: 评审派发不是起飞派发，一律放行——否则铁律 4 的独立评审在装了 hook 的下游会被自家门禁拦死
    assert p.returncode == 0 and p.stdout.strip() == "", p.stdout


def test_tasks_tick_does_not_expire_approval(tmp_path):
    # Given: 批准成立后，收口把 tasks.md 的 `- [ ]` 勾成 `- [x]`（mtime 变成现在），随后仍有起飞类派发
    d = change_dir(tmp_path)
    okay = transcript(tmp_path / "ok.jsonl", approved_rows())
    os.utime(d / "tasks.md", None)
    dispatch = {"tool_name": "Agent", "cwd": str(tmp_path), "transcript_path": str(okay),
                "tool_input": {"subagent_type": "slice-executor",
                               "prompt": "切片包：`openspec/changes/demo/slices/S1.md`"}}

    # When: 先在勾选后派发一次，再把真正的计划工件 slices.json 改新后派发一次
    after_tick = run_hook("takeoff-gate", stdin=json.dumps(dispatch))
    os.utime(d / "slices.json", None)
    after_replan = run_hook("takeoff-gate", stdin=json.dumps(dispatch))

    # Then: 勾选是执行记账不算改计划（放行）；真改了计划才算批准过期（deny）——新鲜度规则本身不能松
    assert after_tick.returncode == 0 and after_tick.stdout.strip() == "", after_tick.stdout
    replan = json.loads(after_replan.stdout)["hookSpecificOutput"]
    assert replan["permissionDecision"] == "deny"
    assert "重新批准" in replan["permissionDecisionReason"]  # deny 必须来自「过期」而不是「没批准」


# ============================================================ S1：两段式握手（骨架标记已去）
# ⚠ 上方 test_approval_gate_accepts_human_command 原本断言「/opsx-apply 即批准」，已随本段一并改写为
#    「发起 → 停，补一条短确认才成立」；判据收紧是本 change 的刻意行为，不是回归。

INITIATION = ("去 '/abs/repo/.worktrees/demo' apply demo, 授权你git提交, "
              "完成后就pr-ship, 把pr url交付我review")


def assistant(model, ts="2026-09-12T08:00:00Z"):
    return {"type": "assistant", "isSidechain": False, "timestamp": ts,
            "message": {"role": "assistant", "model": model, "content": []}}


def test_initiation_is_not_approval(tmp_path):
    # Given: 两种发起形式——一行自然语言（含"授权"二字）与 /opsx-apply 命令，都晚于计划工件
    d = change_dir(tmp_path)
    t_line = transcript(tmp_path / "line.jsonl", [human(INITIATION, "2026-09-12T08:58:04Z")])
    t_cmd = transcript(tmp_path / "cmd.jsonl", [human(APPLY_CMD, "2026-09-12T08:58:04Z")])

    # When: 分别判定
    p_line = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t_line))
    p_cmd = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t_cmd))

    # Then: 都只算发起，不构成批准；两种形式判定一致
    assert p_line.returncode != 0, p_line.stdout
    assert p_cmd.returncode != 0, p_cmd.stdout
    assert "已批准" not in p_line.stdout and "已批准" not in p_cmd.stdout


def test_short_confirm_approves(tmp_path):
    """不变量：短确认构成批准。当前实现已成立，S1 收紧判据时不得改坏（故无 xfail 标记）。"""
    # Given: 发起之后人又发了一条短确认（≤40 字、含批准词、不含 change 名与路径）
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [
        human(INITIATION, "2026-09-12T08:58:04Z"),
        assistant("claude-opus-5", "2026-09-12T08:58:30Z"),
        human("起飞", "2026-09-12T08:59:10Z"),
    ])

    # When: 判定
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t))

    # Then: 批准成立，stdout 带确认时间戳与原话摘要
    assert p.returncode == 0, p.stderr
    assert "2026-09-12T08:59:10Z" in p.stdout and "起飞" in p.stdout


def test_block_message_shows_model_and_scale(tmp_path):
    # Given: 最后一条人类消息是发起，转录末条主循环 assistant 是 fable，slices.json 为 3 片 / 2 wave
    d = change_dir(tmp_path)
    (d / "slices.json").write_text(json.dumps({
        "version": 1, "change": "demo",
        "slices": [{"id": "S1", "deps": []}, {"id": "S2", "deps": ["S1"]}, {"id": "S3", "deps": ["S1"]}],
    }), encoding="utf-8")
    t = transcript(tmp_path / "s.jsonl", [
        human(INITIATION, "2026-09-12T08:58:04Z"),
        assistant("claude-fable-5-1", "2026-09-12T08:58:30Z"),
    ])

    # When: 判定
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t))

    # Then: 停下，并一次给全人做判断所需：主模型别名 · 规模 · 绝对路径 · 补救指引
    assert p.returncode != 0
    assert "fable" in p.stderr
    assert "3" in p.stderr and "2" in p.stderr          # 3 片 · 2 wave
    assert str(d) in p.stderr or str(tmp_path) in p.stderr  # worktree 绝对路径
    assert "spec.html" in p.stderr
    assert "起飞" in p.stderr and "/model" in p.stderr   # 确认与换模型两条出路


def test_confirm_must_follow_initiation(tmp_path):
    # Given: 短确认出现在发起之前（上一轮遗留），以及确认之后计划又被改动的两种转录
    d = change_dir(tmp_path)
    stale = transcript(tmp_path / "stale.jsonl", [
        human("起飞", "2026-09-12T08:00:00Z"),
        human(INITIATION, "2026-09-12T08:58:04Z"),
    ])
    fresh = transcript(tmp_path / "fresh.jsonl", [
        human(INITIATION, "2026-09-12T08:58:04Z"),
        human("起飞", "2026-09-12T08:59:10Z"),
    ])

    # When: 先判遗留确认；再把计划工件改新后判本来成立的那份
    p_stale = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(stale))
    os.utime(d / "slices.json", None)
    p_replan = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(fresh))

    # Then: 确认不继承历史；计划改后批准过期，理由点名需重新批准
    assert p_stale.returncode != 0, p_stale.stdout
    assert p_replan.returncode != 0, p_replan.stdout
    assert "重新批准" in p_replan.stderr


def test_unresolvable_model_still_blocks(tmp_path):
    # Given: 最后一条是发起，但模型 id 认不出别名；以及完全没有 assistant 条目的转录
    d = change_dir(tmp_path)
    # ⚠ 转录文件名刻意不含 "k3"：否则 stderr 里的 session 路径会让断言假阳性
    t_k3 = transcript(tmp_path / "third-party.jsonl", [human(INITIATION, "2026-09-12T08:58:04Z"),
                                                       assistant("k3", "2026-09-12T08:58:30Z")])
    t_none = transcript(tmp_path / "no-assistant.jsonl", [human(INITIATION, "2026-09-12T08:58:04Z")])

    # When: 分别判定
    p_k3 = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t_k3))
    p_none = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t_none))

    # Then: 都停下；认不出的原始 id 要被点名——判不出主模型不许起飞
    assert p_k3.returncode != 0 and "k3" in p_k3.stderr
    assert p_none.returncode != 0


def test_hook_denies_dispatch_without_confirm(tmp_path):
    # Given: 转录里只有发起、没有短确认，来一次起飞类派发
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "s.jsonl", [human(INITIATION, "2026-09-12T08:58:04Z"),
                                          assistant("claude-fable-5-1", "2026-09-12T08:58:30Z")])
    dispatch = {"tool_name": "Workflow", "cwd": str(tmp_path), "transcript_path": str(t),
                "tool_input": {"args": {"changeDir": str(d)}}}

    # When: 喂给 hook 模式
    p = run_hook("takeoff-gate", stdin=json.dumps(dispatch))

    # Then: deny，且 reason 与 CLI 停下信息同源（含主模型别名与补救指引）
    out = json.loads(p.stdout)["hookSpecificOutput"]
    assert out["permissionDecision"] == "deny"
    assert "fable" in out["permissionDecisionReason"]
    assert "起飞" in out["permissionDecisionReason"]


# ============================================================ fix：确认分支的否定守卫
@pytest.mark.parametrize("veto", [
    "先别起飞，等我看完", "还没看完，先不要批准", "don't approve yet",
    # PR #30 评审 H1 实测：这四条「推迟型」措辞含批准词但语义相反，邻近窗口挡不住
    "等我看完再起飞", "等会再起飞", "明天再批准", "not ready, approve later",
])
def test_negation_near_approve_word_is_not_confirm(tmp_path, veto):
    # Given: 发起之后人类回的是一句明确制止起飞的短消息（「先别起飞，等我看完」/「还没看完，先不要批准」/
    #        「don't approve yet」——都 ≤40 字且命中批准词 起飞 / 批准 / approve）
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "veto.jsonl", [
        human(INITIATION, "2026-09-12T08:58:04Z"),
        assistant("claude-opus-5", "2026-09-12T08:58:30Z"),
        human(veto, "2026-09-12T08:59:10Z"),
    ])

    # When: 运行 CLI 判定
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t))

    # Then: 非 0 退出，且 stdout 不吐出任何批准证据（人说「别飞」不得被读成批准）
    assert p.returncode != 0, p.stdout
    assert p.stdout.strip() == "", p.stdout


# ============================================================ fix：批准取「最新一条确认」，而非「最后一条人类消息」
def test_confirm_survives_later_human_chatter(tmp_path):
    # Given: 08:58:04 发起 + 08:59:10 短确认「起飞」握手已成立，人又在 09:05 插了一句与批准无关的「状态？」
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "chat.jsonl", [
        human(INITIATION, "2026-09-12T08:58:04Z"),
        human("起飞", "2026-09-12T08:59:10Z"),
        human("状态？", "2026-09-12T09:05:00Z"),
    ])
    dispatch = {"tool_name": "Agent", "cwd": str(tmp_path), "transcript_path": str(t),
                "tool_input": {"subagent_type": "slice-executor",
                               "prompt": "切片包：`openspec/changes/demo/slices/S2.md`"}}

    # When: 飞行途中再来一次 slice-executor 派发，以 hook 模式判定
    p = run_hook("takeoff-gate", stdin=json.dumps(dispatch))

    # Then: 静默放行（已成立的握手不被途中插话作废，在飞的 flight 不被自家门禁腰斩）
    assert p.returncode == 0 and p.stdout.strip() == "", p.stdout


def test_new_initiation_after_confirm_blocks(tmp_path):
    """不变量：确认之后又出现新的发起 → 旧确认不覆盖新发起，必须重新确认。"""
    # Given: 08:59:10 确认「起飞」之后，人在 09:10 又发了一次新的起飞发起，此后再无确认
    d = change_dir(tmp_path)
    t = transcript(tmp_path / "re.jsonl", [
        human(INITIATION, "2026-09-12T08:58:04Z"),
        human("起飞", "2026-09-12T08:59:10Z"),
        human(INITIATION, "2026-09-12T09:10:00Z"),
    ])

    # When: 运行 CLI 判定
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(t))

    # Then: 非 0 退出，且 stdout 不吐出批准证据
    assert p.returncode != 0, p.stdout
    assert p.stdout.strip() == "", p.stdout


# ============================================================ fix：propose 收尾不得把「发起」说成「批准」
def test_propose_calls_takeoff_line_initiation_not_approval():
    # Given: /opsx-propose 命令与 openspec-propose skill 两份文本（头部摘要 + 收尾硬交接四件事）
    cmd = (CMD / "opsx-propose.md").read_text(encoding="utf-8")
    skill = (SKILLS / "openspec-propose" / "SKILL.md").read_text(encoding="utf-8")

    # When: 检查两者对 /opsx-apply 与那一行起飞指令的定性
    texts = [cmd, skill]

    # Then: 都写明这只算发起、批准是随后一句 ≤40 字短确认、apply 会停在 step 0 要这句确认；
    #       不再出现把发起说成批准的旧措辞
    for t in texts:
        assert "只算发起" in t
        assert "短确认" in t and "40" in t
        assert "step 0" in t
        assert "核验这条人类批准" not in t and "机械校验这条批准" not in t


# ====================================================== PR #30 评审 H2：发起与确认必须绑定到本 change
def test_other_change_mention_keeps_confirm(tmp_path):
    # Given: 本 change（demo）握手已成立，随后人提到另一个 change 的路径与另一间 worktree
    d = change_dir(tmp_path)
    sess = transcript(tmp_path / "s.jsonl", approved_rows() + [
        human("看下 openspec/changes/other-change/tasks.md 进度", "2026-09-10T09:10:00Z"),
        human("那个 .worktrees/other 里的日志呢", "2026-09-10T09:11:00Z"),
    ])

    # When: 判定本 change
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(sess))

    # Then: 仍然放行——别的 change 的路径不构成对本 change 的新发起，在飞的 flight 不该被腰斩
    assert p.returncode == 0, (p.returncode, p.stderr)
    assert CONFIRM_AT in p.stdout


def test_confirm_for_other_change_does_not_approve_this(tmp_path):
    # Given: 转录里只有针对另一个 change 的一行式发起与其后的短确认，没有任何针对本 change 的发起
    d = change_dir(tmp_path)
    sess = transcript(tmp_path / "s.jsonl", [
        human("去 '/abs/repo/.worktrees/other-change' apply other-change, 授权你git提交",
              "2026-09-10T08:58:04Z"),
        human("起飞", "2026-09-10T08:59:00Z"),
    ])

    # When: 判定本 change
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(sess))

    # Then: 不成立——给 B 的确认不能替 A 放行，人从未针对 A 看过计划与模型
    assert p.returncode != 0, p.stdout


def test_short_change_name_chatter_is_not_initiation(tmp_path):
    # Given: change 名为 demo，握手已成立，随后人说一句恰好含 "demo" 子串的闲聊
    d = change_dir(tmp_path)
    sess = transcript(tmp_path / "s.jsonl", approved_rows() + [
        human("这个 demo-site 的截图发我", "2026-09-10T09:12:00Z"),
    ])

    # When: 判定
    p = run_hook("takeoff-gate", "--change-dir", str(d), "--session", str(sess))

    # Then: 仍放行——change 名要有词边界，短名不能把普通闲聊判成新发起
    assert p.returncode == 0, (p.returncode, p.stderr)
