"""起飞门禁：判据为「账本最新批准指纹 == 当前计划指纹」（scenario: ledger-takeoff-gate#*）。
转录只作反证（人类在转录里批准过也不再放行）。"""
import json

from conftest import approve_event, git, ledger_append, make_change, run_hook

NO_SID = {"CLAUDE_CODE_SESSION_ID": ""}  # 防止实现借环境变量读到当前会话转录


def human(text, ts):
    return {"type": "user", "isSidechain": False, "isMeta": False, "userType": "external",
            "timestamp": ts, "message": {"role": "user", "content": text}}


def transcript(path, rows):
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return path


APPLY_CMD = ("<command-message>opsx-apply</command-message> "
             "<command-name>/opsx-apply</command-name> <command-args>demo</command-args>")


def test_takeoff_hook_denies_prompt_path_wrapped_in_backticks(git_repo):
    # Given: demo 无账本；slice-executor 派发的 prompt 用中文全角冒号紧邻 + 反引号包住相对路径 `openspec/changes/demo/...`
    d = make_change(git_repo)
    quoted = {"tool_name": "Agent", "cwd": str(git_repo),
              "tool_input": {"subagent_type": "slice-executor",
                             "prompt": "切片包：`openspec/changes/demo/slices/S1.md`，按 TDD 执行"}}

    # When: 以 hook 模式运行
    p = run_hook("takeoff-gate", stdin=json.dumps(quoted, ensure_ascii=False), env=NO_SID)

    # Then: 识别出 change 目录并 deny，reason 点名该目录（不静默 fail-open）
    r = json.loads(p.stdout)["hookSpecificOutput"]
    assert r["permissionDecision"] == "deny" and str(d) in r["permissionDecisionReason"]


def test_takeoff_hook_denies_prompt_path_with_repo_prefix(git_repo):
    # Given: template/openspec/changes/demo 无账本；prompt 里的路径前面多带一段仓库名 idcc/（需剥掉才是 cwd 下的真目录）
    deep = make_change(git_repo, under=("template", "openspec", "changes"))
    prefixed = {"tool_name": "Agent", "cwd": str(git_repo),
                "tool_input": {"subagent_type": "slice-executor",
                               "prompt": "读 idcc/template/openspec/changes/demo/slices/S1.md 再开工"}}

    # When: 以 hook 模式运行
    p = run_hook("takeoff-gate", stdin=json.dumps(prefixed, ensure_ascii=False), env=NO_SID)

    # Then: 定位到 template/openspec/changes/demo 并 deny，reason 点名该目录
    r = json.loads(p.stdout)["hookSpecificOutput"]
    assert r["permissionDecision"] == "deny" and str(deep) in r["permissionDecisionReason"]


def test_takeoff_cli_honors_equals_form_change_dir(git_repo):
    # Given: demo 无账本，命令行用 --change-dir=DIR 等号写法且 stdin 为空
    d = make_change(git_repo)

    # When: 以等号写法运行 CLI 模式
    p = run_hook("takeoff-gate", "--change-dir=" + str(d), env=NO_SID)

    # Then: 以 3 退出，stderr 给出 spec.html 补救指引（等号写法不得退化成静默放行）
    assert p.returncode == 3, p.stdout
    assert "spec.html" in p.stderr


def test_takeoff_cli_equals_form_accepts_approval(git_repo):
    # Given: demo 账本最新批准指纹等于当前计划指纹，命令行用 --change-dir=DIR 等号写法
    d = approved_change(git_repo)

    # When: 以等号写法运行 CLI 模式
    p = run_hook("takeoff-gate", "--change-dir=" + str(d), env=NO_SID)

    # Then: 以 0 退出，stdout 含当前指纹前 8 位
    assert p.returncode == 0, p.stderr
    assert current_fp(d)[:8] in p.stdout


def test_takeoff_hook_ignores_unrelated_dispatch(tmp_path):
    # Given: 一次 Explore 派发，prompt 是「找一下登录逻辑在哪」，与飞行无关
    unrelated = {"tool_name": "Agent", "cwd": str(tmp_path),
                 "tool_input": {"subagent_type": "Explore", "prompt": "找一下登录逻辑在哪"}}

    # When: 以 hook 模式运行
    p = run_hook("takeoff-gate", stdin=json.dumps(unrelated, ensure_ascii=False), env=NO_SID)

    # Then: 静默放行（退出码 0、无输出）
    assert p.returncode == 0 and p.stdout.strip() == ""


def test_takeoff_hook_allows_reviewer_dispatch(git_repo):
    # Given: demo 无账本，一次 /pr-ship 的 code-reviewer 派发在 prompt 里提到了该 change 目录
    make_change(git_repo)
    reviewer = {"tool_name": "Agent", "cwd": str(git_repo),
                "tool_input": {"subagent_type": "code-reviewer",
                               "prompt": "参考 openspec/changes/demo/gate-report.md 审这次 PR 的 diff"}}

    # When: 以 hook 模式运行
    p = run_hook("takeoff-gate", stdin=json.dumps(reviewer, ensure_ascii=False), env=NO_SID)

    # Then: 评审派发不是起飞派发，一律放行——否则铁律 4 的独立评审会被自家门禁拦死
    assert p.returncode == 0 and p.stdout.strip() == "", p.stdout


# ---------------------------------------------------------------- 账本判据 scenario（ledger-takeoff-gate#*）

def current_fp(change_dir):
    p = run_hook("plan_fp", "--change-dir", str(change_dir))
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def approved_change(repo):
    d = make_change(repo)
    ledger_append(repo, "demo", approve_event("demo", current_fp(d)))
    return d


def bump_owns(change_dir):
    path = change_dir / "slices.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["slices"][0]["owns"].append("b.py")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def executor_dispatch(repo, transcript_path):
    return json.dumps({"tool_name": "Agent", "cwd": str(repo), "transcript_path": str(transcript_path),
                       "tool_input": {"subagent_type": "slice-executor",
                                      "prompt": "切片包：`openspec/changes/demo/slices/S1.md`"}}, ensure_ascii=False)


def test_takeoff_accepts_matching_approval(git_repo):
    # Given: 当前指纹 F 与账本最新批准指纹相等
    d = approved_change(git_repo)

    # When: 运行 CLI
    p = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 以 0 退出，stdout 含指纹前 8 位与批准时间
    assert p.returncode == 0, p.stderr
    assert current_fp(d)[:8] in p.stdout and "2026-10-09T08:00:00Z" in p.stdout


def test_takeoff_rejects_missing_approval(git_repo):
    # Given: demo 没有账本
    d = make_change(git_repo)

    # When: 运行 CLI
    p = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 以 3 退出，stderr 含 spec.html 绝对路径、批准带与插件安装命令
    assert p.returncode == 3
    assert str(d / "spec.html") in p.stderr and "批准带" in p.stderr and "claude plugin install" in p.stderr


def test_takeoff_rejects_stale_approval(git_repo):
    # Given: 账本批准指纹为 F，之后 slices.json 被改，当前指纹为 G
    d = approved_change(git_repo)
    old = current_fp(d)
    bump_owns(d)
    new = current_fp(d)

    # When: 运行 CLI
    p = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 以 3 退出，stderr 含「重新批准」与 F、G 的前 8 位
    assert p.returncode == 3
    assert "重新批准" in p.stderr and old[:8] in p.stderr and new[:8] in p.stderr


def test_takeoff_rejects_invalid_ledger(git_repo):
    # Given: 账本某个提交的 event.json 不是 JSON
    d = make_change(git_repo)
    ledger_append(git_repo, "demo", files={"event.json": "{not json"})

    # When: 运行 CLI
    p = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 以 3 退出，stderr 含「账本损坏」
    assert p.returncode == 3
    assert "账本损坏" in p.stderr


def test_takeoff_hook_denies_despite_transcript_approval(git_repo, tmp_path):
    # Given: 转录里人类发出过 /opsx-apply demo（时刻晚于一切），但 demo 没有账本
    make_change(git_repo)
    t = transcript(tmp_path / "t.jsonl", [human(APPLY_CMD, "2099-01-01T00:00:00Z")])

    # When: 以该转录构造派发 slice-executor 的载荷运行 hook
    p = run_hook("takeoff-gate", stdin=executor_dispatch(git_repo, t), env=NO_SID)

    # Then: 输出 deny
    out = json.loads(p.stdout)["hookSpecificOutput"]
    assert out["permissionDecision"] == "deny"


def test_takeoff_hook_allows_approved_dispatch(git_repo, tmp_path):
    # Given: 账本批准指纹等于当前指纹；转录里没有任何人类批准
    approved_change(git_repo)
    empty = transcript(tmp_path / "e.jsonl", [])

    # When: 以派发 slice-executor 的载荷运行 hook
    p = run_hook("takeoff-gate", stdin=executor_dispatch(git_repo, empty), env=NO_SID)

    # Then: 以 0 退出且 stdout 为空
    assert p.returncode == 0 and p.stdout.strip() == "", p.stdout


def test_takeoff_tasks_tick_keeps_approval(git_repo, tmp_path):
    # Given: 账本批准指纹等于当前指纹
    d = approved_change(git_repo)
    empty = transcript(tmp_path / "e.jsonl", [])

    # When: 先勾选 tasks.md 后派发一次，再改 slices.json 后派发一次
    (d / "tasks.md").write_text("- [x] S1 t\n", encoding="utf-8")
    after_tick = run_hook("takeoff-gate", stdin=executor_dispatch(git_repo, empty), env=NO_SID)
    bump_owns(d)
    after_replan = run_hook("takeoff-gate", stdin=executor_dispatch(git_repo, empty), env=NO_SID)

    # Then: 第一次放行；第二次 deny 且理由含「重新批准」
    assert after_tick.returncode == 0 and after_tick.stdout.strip() == "", after_tick.stdout
    replan = json.loads(after_replan.stdout)["hookSpecificOutput"]
    assert replan["permissionDecision"] == "deny" and "重新批准" in replan["permissionDecisionReason"]


def slice_dispatch(cwd, change_dir):
    return json.dumps({"tool_name": "Agent", "cwd": str(cwd),
                       "tool_input": {"subagent_type": "slice-executor",
                                      "prompt": "切片包：%s/slices/S1.md" % change_dir}}, ensure_ascii=False)


def test_takeoff_hook_denies_change_outside_git_repo(tmp_path):
    # Given: demo 位于不在任何 git 仓库内的目录（GIT_CEILING_DIRECTORIES 截断向上查找），slice-executor 派发指向它
    d = make_change(tmp_path / "outside")
    env = {**NO_SID, "GIT_CEILING_DIRECTORIES": str(tmp_path)}

    # When: 以 hook 模式运行
    p = run_hook("takeoff-gate", stdin=slice_dispatch(tmp_path, d), env=env)

    # Then: deny（账本不可读是判定结果，不是门禁故障），理由含「账本不可读」
    r = json.loads(p.stdout)["hookSpecificOutput"]
    assert r["permissionDecision"] == "deny" and "账本不可读" in r["permissionDecisionReason"]


def test_takeoff_hook_denies_ledger_ref_to_non_commit(git_repo):
    # Given: demo 的账本引用 refs/flight/demo/ledger 指向一棵空树（不是提交）
    d = make_change(git_repo)
    tree = git(git_repo, "hash-object", "-w", "-t", "tree", "/dev/null")
    git(git_repo, "update-ref", "refs/flight/demo/ledger", tree)

    # When: 以 hook 模式运行 slice-executor 派发
    p = run_hook("takeoff-gate", stdin=slice_dispatch(git_repo, d), env=NO_SID)

    # Then: deny，理由含「账本损坏」
    r = json.loads(p.stdout)["hookSpecificOutput"]
    assert r["permissionDecision"] == "deny" and "账本损坏" in r["permissionDecisionReason"]
