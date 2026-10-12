"""起飞门禁：判据为「账本最新批准指纹 == 当前计划指纹」（scenario: ledger-takeoff-gate#*, flight-retire-hooks#takeoff-gate-hook-mode-retired）。
只剩 CLI 模式（--change-dir，插件起飞守卫在用）；hook 模式已退役，不带参数时空转。"""
import json

from conftest import approve_event, git, ledger_append, make_change, run_hook

NO_SID = {"CLAUDE_CODE_SESSION_ID": ""}  # 防止实现借环境变量读到当前会话转录


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


def test_takeoff_tasks_tick_keeps_approval(git_repo):
    # Given: 账本批准指纹等于当前指纹
    d = approved_change(git_repo)

    # When: 先勾选 tasks.md 后运行一次 CLI，再改 slices.json 后运行一次 CLI
    (d / "tasks.md").write_text("- [x] S1 t\n", encoding="utf-8")
    after_tick = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)
    bump_owns(d)
    after_replan = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 第一次以 0 退出；第二次以 3 退出且 stderr 含「重新批准」
    assert after_tick.returncode == 0, after_tick.stderr
    assert after_replan.returncode == 3 and "重新批准" in after_replan.stderr, after_replan.stderr


def test_takeoff_rejects_change_outside_git_repo(tmp_path):
    # Given: demo 位于不在任何 git 仓库内的目录（GIT_CEILING_DIRECTORIES 截断向上查找）
    d = make_change(tmp_path / "outside")
    env = {**NO_SID, "GIT_CEILING_DIRECTORIES": str(tmp_path)}

    # When: 运行 CLI
    p = run_hook("takeoff-gate", "--change-dir", str(d), env=env)

    # Then: 以 3 退出（账本不可读是判定结果，不是门禁故障），stderr 含「账本不可读」
    assert p.returncode == 3
    assert "账本不可读" in p.stderr, p.stderr


def test_takeoff_rejects_ledger_ref_to_non_commit(git_repo):
    # Given: demo 的账本引用 refs/flight/demo/ledger 指向一棵空树（不是提交）
    d = make_change(git_repo)
    tree = git(git_repo, "hash-object", "-w", "-t", "tree", "/dev/null")
    git(git_repo, "update-ref", "refs/flight/demo/ledger", tree)

    # When: 运行 CLI
    p = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 以 3 退出，stderr 含「账本损坏」
    assert p.returncode == 3
    assert "账本损坏" in p.stderr, p.stderr


# ---------------------------------------------------------------- flight-retire-workflow-engine（scenario: flight-retire-hooks#takeoff-gate-hook-mode-retired）


def test_takeoff_gate_hook_mode_retired(git_repo):
    # Given: change demo 没有账本（未批准）；载荷是 tool_name=Workflow、args.changeDir 指向 demo 的派发
    d = make_change(git_repo)
    payload = json.dumps({"tool_name": "Workflow", "cwd": str(git_repo),
                          "tool_input": {"args": json.dumps({"change": "demo", "changeDir": str(d)})}}, ensure_ascii=False)

    # When: 不带参数运行 takeoff-gate.py 并把载荷送进 stdin，再以 --change-dir <demo> 运行一次
    hook = run_hook("takeoff-gate", stdin=payload, env=NO_SID)
    cli = run_hook("takeoff-gate", "--change-dir", str(d), env=NO_SID)

    # Then: 前者退出 0、stdout 为空；后者以 3 退出、stderr 含「未批准」
    assert hook.returncode == 0 and hook.stdout.strip() == "", hook.stdout
    assert cli.returncode == 3 and "未批准" in cli.stderr, cli.stderr
