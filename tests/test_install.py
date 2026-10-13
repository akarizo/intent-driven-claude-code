"""install.sh 与模板 openspec/.gitignore：飞行起飞记录 .flight 不入库（scenario: flight-record-ignore#*）。"""
import os
import shutil
import subprocess

import pytest

from conftest import ROOT

GITIGNORE = ROOT / "template" / "openspec" / ".gitignore"
RULE = "changes/*/.flight"


def run_install(tmp_path, target, *flags):
    """用本仓库的 install.sh 安装 / 升级到 target；PATH 前置 openspec 与 claude 桩，并剔除真实 claude（免改本机插件记录）。"""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name in ("openspec", "claude"):
        stub = bin_dir / name
        stub.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        stub.chmod(0o755)
    env = {**os.environ, "PATH": path_without_real_claude(bin_dir)}
    return subprocess.run(["bash", str(ROOT / "install.sh"), *flags, str(target)],
                          env=env, capture_output=True, text=True, timeout=120)


def ignored(repo, rel):
    return subprocess.run(["git", "check-ignore", "-q", rel], cwd=repo).returncode == 0


def test_template_ignores_flight_marker(git_repo):
    # Given: 一个 git 仓库，openspec/.gitignore 是本模板的原文；某个 change 目录下有 .flight，openspec/ 下有 .mini-active
    (git_repo / "openspec" / "changes" / "x").mkdir(parents=True)
    shutil.copy(GITIGNORE, git_repo / "openspec" / ".gitignore")
    (git_repo / "openspec" / "changes" / "x" / ".flight").write_text("{}", encoding="utf-8")
    (git_repo / "openspec" / ".mini-active").write_text("{}", encoding="utf-8")

    # When: 用 git check-ignore 询问这两个文件
    flight, mini = ignored(git_repo, "openspec/changes/x/.flight"), ignored(git_repo, "openspec/.mini-active")

    # Then: 两者都被忽略
    assert flight, "openspec/changes/x/.flight 未被忽略"
    assert mini, "openspec/.mini-active 未被忽略"


def test_upgrade_appends_flight_ignore_once(tmp_path):
    # Given: 一个已安装的项目，其 openspec/.gitignore 是老版本（只有 .mini-active 一条规则）
    target = tmp_path / "proj"
    first = run_install(tmp_path, target)
    ignore = target / "openspec" / ".gitignore"
    ignore.write_text("# intent-driven mini-task marker（每机瞬态，不入库）\n.mini-active\n", encoding="utf-8")

    # When: 连续两次运行 install.sh --upgrade
    runs = [run_install(tmp_path, target, "--upgrade") for _ in range(2)]

    # Then: 安装与两次升级都以 0 退出；整行 changes/*/.flight 恰好出现一次，.mini-active 仍在
    assert first.returncode == 0 and all(r.returncode == 0 for r in runs), [first.stderr] + [r.stderr for r in runs]
    lines = [l.strip() for l in ignore.read_text(encoding="utf-8").splitlines()]
    assert lines.count(RULE) == 1, lines
    assert ".mini-active" in lines


# ---------------------------------------------------------------- 插件分发（scenario: plugin-distribution#*，S5 骨架）
# ⚠ S5 实现后 install.sh 会调用 PATH 上的 claude：上方 run_install 也必须改用下面的 claude 桩 / 过滤 PATH，
#   否则测试会真实改动开发者本机的用户级插件记录（design D9）。
import json  # noqa: E402

MARKET_ADD = "plugin marketplace add akarizo/intent-driven-claude-code --scope project"
PLUGIN_INSTALL = "plugin install flight@intent-driven -s project"


def path_without_real_claude(bin_dir):
    """PATH = 桩目录 + 原 PATH 中不含 claude 可执行文件的目录。"""
    keep = [p for p in os.environ.get("PATH", "").split(os.pathsep)
            if p and not os.path.exists(os.path.join(p, "claude"))]
    return os.pathsep.join([str(bin_dir)] + keep)


def run_install_stubbed(tmp_path, target, *flags, claude=True):
    """openspec 桩 + 可选的 claude 桩（逐行记录「工作目录|参数」），返回 (CompletedProcess, 调用记录)。"""
    bin_dir = tmp_path / "bin-stub"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "openspec").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    (bin_dir / "openspec").chmod(0o755)
    log = tmp_path / "claude-calls.log"
    shim = bin_dir / "claude"
    if claude:
        shim.write_text('#!/bin/sh\necho "$PWD|$*" >> "%s"\nexit 0\n' % log, encoding="utf-8")
        shim.chmod(0o755)
    elif shim.exists():
        shim.unlink()
    env = {**os.environ, "PATH": path_without_real_claude(bin_dir)}
    p = subprocess.run(["bash", str(ROOT / "install.sh"), *flags, str(target)],
                       env=env, capture_output=True, text=True, timeout=120)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return p, calls


def plugin_calls(calls):
    return [c.split("|", 1) for c in calls if "|plugin " in c]


def test_marketplace_lists_flight_plugin():
    # Given: 仓库根的 .claude-plugin/marketplace.json
    market = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8"))

    # When: 解析 flight 一项的 source
    item = next(p for p in market["plugins"] if p["name"] == "flight")
    source = (ROOT / item["source"]).resolve()

    # Then: marketplace 名为 intent-driven，source 下 plugin.json 的 name 为 flight
    assert market["name"] == "intent-driven"
    manifest = json.loads((source / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["name"] == "flight"


def test_install_registers_plugin_at_project_scope(tmp_path):
    # Given: PATH 上有记录参数与工作目录的 claude 桩
    target = tmp_path / "proj"

    # When: 对新目录运行 install.sh
    p, calls = run_install_stubbed(tmp_path, target)

    # Then: 在目标目录内先 marketplace add（project 作用域）再 install；安装以 0 退出
    assert p.returncode == 0, p.stderr
    got = plugin_calls(calls)
    assert [args for _cwd, args in got] == [MARKET_ADD, PLUGIN_INSTALL], calls
    assert all(os.path.realpath(cwd) == os.path.realpath(target) for cwd, _args in got), calls


def test_install_without_claude_prints_manual_steps(tmp_path):
    # Given: PATH 上没有 claude
    target = tmp_path / "proj"

    # When: 对新目录运行 install.sh
    p, _calls = run_install_stubbed(tmp_path, target, claude=False)

    # Then: 以 0 退出，输出原样含两条手动命令
    assert p.returncode == 0, p.stderr
    out = p.stdout + p.stderr
    assert "claude " + MARKET_ADD in out and "claude " + PLUGIN_INSTALL in out


def test_install_skips_enabled_plugin(tmp_path):
    # Given: 已安装的目标目录，其 .claude/settings.json 的 enabledPlugins 已含 flight@intent-driven
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    settings = target / ".claude" / "settings.json"
    data = json.loads(settings.read_text(encoding="utf-8")) if settings.exists() else {}
    data.setdefault("enabledPlugins", {})["flight@intent-driven"] = True
    settings.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # When: 带 claude 桩运行 install.sh --upgrade
    p, calls = run_install_stubbed(tmp_path, target, "--upgrade")

    # Then: 桩没有收到任何 plugin 子命令，输出含「flight@intent-driven 已启用」
    assert p.returncode == 0, p.stderr
    assert plugin_calls(calls) == [], calls
    assert "flight@intent-driven 已启用" in p.stdout + p.stderr


# ---------------------------------------------------------------- flight-integrity-fixes（scenario: install-plugin-robustness#*）
# S6 已实现：xfail 标记已去。

def run_install_claude_failing(tmp_path, target, failing, *flags):
    """claude 桩对 failing 里的 plugin 子命令（"marketplace" / "install"）返回 1，其余返回 0，逐行记录「工作目录|参数」。
    返回 (CompletedProcess, 调用记录)。"""
    bin_dir = tmp_path / "bin-stub"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "openspec").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    (bin_dir / "openspec").chmod(0o755)
    log = tmp_path / "claude-calls.log"
    lines = ["#!/bin/sh", 'echo "$PWD|$*" >> "%s"' % log]
    lines += ['[ "$2" = "%s" ] && exit 1' % word for word in failing]
    lines.append("exit 0")
    shim = bin_dir / "claude"
    shim.write_text("\n".join(lines) + "\n", encoding="utf-8")
    shim.chmod(0o755)
    env = {**os.environ, "PATH": path_without_real_claude(bin_dir)}
    p = subprocess.run(["bash", str(ROOT / "install.sh"), *flags, str(target)],
                       env=env, capture_output=True, text=True, timeout=120)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return p, calls


def test_plugin_install_continues_after_marketplace_failure(tmp_path):
    # Given: 目标仓库未启用 flight 插件；claude 桩对 plugin marketplace add 返回 1、对 plugin install 返回 0
    target = tmp_path / "proj"

    # When: 运行 install.sh
    p, calls = run_install_claude_failing(tmp_path, target, ["marketplace"])
    out = p.stdout + p.stderr

    # Then: 以 0 退出，plugin install flight@intent-driven -s project 仍被调用；输出里没有手动执行的指引
    assert p.returncode == 0, out
    assert any(PLUGIN_INSTALL in c for c in calls), calls
    assert "手动执行" not in out, out


def test_plugin_install_failure_keeps_exit_zero(tmp_path):
    # Given: 目标仓库未启用 flight 插件；claude 桩对 plugin marketplace add 与 plugin install 都返回 1
    target = tmp_path / "proj"

    # When: 运行 install.sh
    p, calls = run_install_claude_failing(tmp_path, target, ["marketplace", "install"])
    out = p.stdout + p.stderr

    # Then: 以 0 退出，两条命令都被调用；输出含两条完整的手动命令
    assert p.returncode == 0, out
    assert any(MARKET_ADD in c for c in calls) and any(PLUGIN_INSTALL in c for c in calls), calls
    assert "claude " + MARKET_ADD in out and "claude " + PLUGIN_INSTALL in out, out


def test_upgrade_adds_missing_template_settings_keys(tmp_path):
    # Given: 已安装的目标仓库，用户把 .claude/settings.json 改成 {"env": {"MY_KEY": "1"}, "custom": true}
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    settings = target / ".claude" / "settings.json"
    settings.write_text(json.dumps({"env": {"MY_KEY": "1"}, "custom": True}), encoding="utf-8")

    # When: 运行 install.sh --upgrade
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)
    data = json.loads(settings.read_text(encoding="utf-8"))

    # Then: env 仍恰为 {"MY_KEY": "1"}、custom 仍为 true；补上了模板的 worktree 键 {"baseRef": "head"}
    assert p.returncode == 0, p.stderr
    assert data["env"] == {"MY_KEY": "1"} and data["custom"] is True, data
    assert data.get("worktree") == {"baseRef": "head"}, data


# ---------------------------------------------------------------- install-from-tag（scenario: install-pinned-ref#*，S1 骨架）
# pipe 模式 = install.sh 文本从 stdin 喂给 bash -s（与 curl | bash 同形）；源用 file:// 目录模拟 GitHub 的 archive 路径，全程离线。
import pathlib  # noqa: E402
import re  # noqa: E402
import tarfile  # noqa: E402

INSTALLER = ROOT / "install.sh"

STUB_INSTALLER = """#!/usr/bin/env bash
# 归档里的桩 install.sh：记录收到的参数与同目录 template/VERSION，按 STUB_RC 退出
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
{ printf 'args=%s\\n' "$*"; printf 'version=%s\\n' "$(cat "$here/template/VERSION")"; } > "$STUB_LOG"
exit "${STUB_RC:-0}"
"""


def _skip_changes(info):
    """打归档时略去 template/openspec/changes 下的历史 change 工件（与安装无关，只会拖慢测试）；保留种子 changes/.gitkeep。"""
    marker = "/template/openspec/changes/"
    i = info.name.find(marker)
    if i < 0:
        return info
    return info if info.name[i + len(marker):] == ".gitkeep" else None


def make_source(tmp_path, ref, kind, files):
    """在 tmp_path/src 下按 GitHub 路径放一个归档 archive/refs/<kind>/<ref>.tar.gz（kind = heads / tags），
    顶层目录 idt-<ref>/；files = {归档内相对路径: 文本 或 本地 pathlib.Path（文件或目录）}。返回 file:// 源地址。"""
    src = tmp_path / "src"
    out = src / "archive" / "refs" / kind / (ref + ".tar.gz")
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = tmp_path / ("stage-%s-%s" % (kind, ref))
    top = "idt-" + ref
    with tarfile.open(out, "w:gz") as tar:
        for rel, val in files.items():
            if isinstance(val, pathlib.Path):
                tar.add(val, arcname="%s/%s" % (top, rel), filter=_skip_changes)
            else:
                p = stage / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(val, encoding="utf-8")
                tar.add(p, arcname="%s/%s" % (top, rel))
    return "file://" + str(src)


def run_pipe(tmp_path, source, *args, ref=None, extra_env=None):
    """把本仓库 install.sh 从 stdin 喂给 bash -s；PATH 前置 openspec 桩并剔除真实 claude；ref=None 表示不设 IDT_BRANCH。"""
    bin_dir = tmp_path / "bin-pipe"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "openspec").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    (bin_dir / "openspec").chmod(0o755)
    env = {**os.environ, "PATH": path_without_real_claude(bin_dir), "IDT_REPO_URL": source,
           "STUB_LOG": str(tmp_path / "stub.log")}
    env.pop("IDT_BRANCH", None)
    if ref is not None:
        env["IDT_BRANCH"] = ref
    env.update(extra_env or {})
    return subprocess.run(["bash", "-s", "--", *args], input=INSTALLER.read_text(encoding="utf-8"),
                          env=env, capture_output=True, text=True, timeout=180, cwd=tmp_path)


def stub_log(tmp_path):
    """桩 install.sh 留下的记录 {args, version}；桩没被执行则为空 dict。"""
    p = tmp_path / "stub.log"
    if not p.exists():
        return {}
    return dict(line.split("=", 1) for line in p.read_text(encoding="utf-8").splitlines() if "=" in line)


def test_pipe_installs_tag_only_ref(tmp_path):
    # Given: 源里只有 tag stable-v9.9 的归档（refs/tags 下），没有同名分支；归档里是桩 install.sh 与 template/VERSION=v9.9
    source = make_source(tmp_path, "stable-v9.9", "tags", {"install.sh": STUB_INSTALLER, "template/VERSION": "v9.9"})
    target = tmp_path / "proj"

    # When: 以 IDT_BRANCH=stable-v9.9 用管道运行 install.sh
    p = run_pipe(tmp_path, source, str(target), ref="stable-v9.9")

    # Then: 以 0 退出；归档里的 install.sh 被执行，读到的 VERSION 是 v9.9
    assert p.returncode == 0, p.stdout + p.stderr
    assert stub_log(tmp_path).get("version") == "v9.9", p.stdout + p.stderr


def test_pipe_default_ref_is_main_branch(tmp_path):
    # Given: 源里只有分支 main 的归档（refs/heads 下），归档里是桩 install.sh 与 template/VERSION=main
    source = make_source(tmp_path, "main", "heads", {"install.sh": STUB_INSTALLER, "template/VERSION": "main"})
    target = tmp_path / "proj"

    # When: 不设 IDT_BRANCH，用管道运行 install.sh
    p = run_pipe(tmp_path, source, str(target))

    # Then: 以 0 退出；归档里的 install.sh 被执行，读到的 VERSION 是 main
    assert p.returncode == 0, p.stdout + p.stderr
    assert stub_log(tmp_path).get("version") == "main", p.stdout + p.stderr


def test_pipe_missing_ref_lists_both_urls(tmp_path):
    # Given: 源里只有分支 main 的归档
    source = make_source(tmp_path, "main", "heads", {"install.sh": STUB_INSTALLER, "template/VERSION": "main"})
    target = tmp_path / "proj"

    # When: 以 IDT_BRANCH=nope 用管道运行 install.sh
    p = run_pipe(tmp_path, source, str(target), ref="nope")

    # Then: 以 4 退出；[err] 行里同时出现 refs/heads/nope 与 refs/tags/nope；目标目录没有被创建
    err = [line for line in p.stderr.splitlines() if line.startswith("[err]")]
    assert p.returncode == 4, p.stdout + p.stderr
    assert any("refs/heads/nope" in line for line in err) and any("refs/tags/nope" in line for line in err), p.stderr
    assert not target.exists()


def test_pipe_delegates_args_to_archived_installer(tmp_path):
    # Given: 源里有 tag stable-v9.9 的归档，其 install.sh 是记录参数的桩
    source = make_source(tmp_path, "stable-v9.9", "tags", {"install.sh": STUB_INSTALLER, "template/VERSION": "v9.9"})
    target = tmp_path / "proj"

    # When: 以 IDT_BRANCH=stable-v9.9 用管道运行 install.sh --upgrade <target>
    p = run_pipe(tmp_path, source, "--upgrade", str(target), ref="stable-v9.9")

    # Then: 以 0 退出，桩收到的参数恰为 "--upgrade <target>"；目标目录里没有 .claude/（引导器自身没有复制模板）
    assert p.returncode == 0, p.stdout + p.stderr
    assert stub_log(tmp_path).get("args") == "--upgrade " + str(target), p.stdout + p.stderr
    assert not (target / ".claude").exists()


def test_pipe_propagates_exit_and_cleans_temp(tmp_path):
    # Given: 源里有 tag stable-v9.9 的归档，其 install.sh 是以 3 退出的桩；TMPDIR 指向一个空目录
    source = make_source(tmp_path, "stable-v9.9", "tags", {"install.sh": STUB_INSTALLER, "template/VERSION": "v9.9"})
    target = tmp_path / "proj"
    tmpdir = tmp_path / "tmpdir"
    tmpdir.mkdir()

    # When: 以 IDT_BRANCH=stable-v9.9 用管道运行 install.sh
    p = run_pipe(tmp_path, source, str(target), ref="stable-v9.9", extra_env={"STUB_RC": "3", "TMPDIR": str(tmpdir)})

    # Then: 以 3 退出；TMPDIR 目录仍为空
    assert p.returncode == 3, p.stdout + p.stderr
    assert list(tmpdir.iterdir()) == []


def test_pipe_archive_without_template_exits_4(tmp_path):
    # Given: 源里有 tag stable-v9.9 的归档，里面只有记录调用的桩 install.sh，没有 template/
    #   （用桩而非真实 install.sh：修复前真实脚本会无界递归下载，测试不能触发它）
    source = make_source(tmp_path, "stable-v9.9", "tags", {"install.sh": STUB_INSTALLER})
    target = tmp_path / "proj"

    # When: 以 IDT_BRANCH=stable-v9.9 用管道运行 install.sh
    p = run_pipe(tmp_path, source, str(target), ref="stable-v9.9")

    # Then: 以 4 退出，[err] 行指出归档里没有 template/；桩没有被执行，目标目录没有被创建
    err = [line for line in p.stderr.splitlines() if line.startswith("[err]")]
    assert p.returncode == 4, p.stdout + p.stderr
    assert any("template/" in line for line in err), p.stderr
    assert stub_log(tmp_path) == {}, stub_log(tmp_path)
    assert not target.exists()


def test_pipe_real_installer_runs_local_mode(tmp_path):
    # Given: 源里分支 main 的归档由本仓库当前的 install.sh 与 template/ 打成；PATH 上有 openspec 桩，没有 claude
    source = make_source(tmp_path, "main", "heads", {"install.sh": INSTALLER, "template": ROOT / "template"})
    target = tmp_path / "proj"

    # When: 用管道运行 install.sh <target>
    p = run_pipe(tmp_path, source, str(target))
    out = p.stdout + p.stderr

    # Then: 以 0 退出，目标含 .claude/hooks/intent-gate.py，CLAUDE.md 含 intent-driven:begin 段；只下载一次，且交接后按本地模式运行
    assert p.returncode == 0, out
    assert (target / ".claude" / "hooks" / "intent-gate.py").is_file()
    assert "intent-driven:begin" in (target / "CLAUDE.md").read_text(encoding="utf-8")
    assert out.count("pipe 模式：下载") == 1, out
    assert "模式: local" in out, out


def test_readme_documents_pinned_install():
    # Given: README.md 与 install.sh --help 的输出
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    help_out = subprocess.run(["bash", str(INSTALLER), "--help"], capture_output=True, text=True, timeout=30).stdout

    # When: 取 README 中「### 安装指定版本」到下一个二级或三级标题之间的内容
    rest = readme[readme.index("### 安装指定版本") + 1:]
    m = re.search(r"\n#{2,3} ", rest)
    section = rest[: m.start()] if m else rest

    # Then: 这段含 main 的 install.sh 地址、IDT_BRANCH=stable-v2.0、--branch stable-v2.0 与「降级」；--help 输出含「分支或 tag」
    assert "raw.githubusercontent.com/akarizo/intent-driven-claude-code/main/install.sh" in section, section
    assert "IDT_BRANCH=stable-v2.0" in section, section
    assert "--branch stable-v2.0" in section, section
    assert "降级" in section, section
    assert "分支或 tag" in help_out, help_out

# ---------------------------------------------------------------- flight-retire-workflow-engine
# S3 已实现：xfail 标记已去。
RETIRED_HOOKS = [
    'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/takeoff-gate.py"',
    'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/slice-gate.py" checkpoint',
    'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-gate.py"',
]
USER_STOP_HOOK = 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-gate.py" --mine'


def _hook(cmd):
    return {"type": "command", "command": cmd}


def _all_commands(settings):
    return [h.get("command") for entries in settings.get("hooks", {}).values()
            for e in entries for h in e.get("hooks", [])]


def test_install_removes_retired_hooks(tmp_path):
    # Given: 已装旧版模板的目标：settings 注册三条退役 hook 与一条用户自写的 stop-gate.py --mine；.claude/workflows/opsx-apply.js 存在
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    settings = target / ".claude" / "settings.json"
    settings.write_text(json.dumps({"hooks": {
        "PreToolUse": [{"matcher": "Workflow|Agent|Task", "hooks": [_hook(RETIRED_HOOKS[0])]}],
        "PostToolUse": [{"matcher": "Write|Edit|Bash", "hooks": [_hook(RETIRED_HOOKS[1])]}],
        "Stop": [{"hooks": [_hook(RETIRED_HOOKS[2])]}, {"hooks": [_hook(USER_STOP_HOOK)]}],
    }}), encoding="utf-8")
    workflow = target / ".claude" / "workflows" / "opsx-apply.js"
    workflow.parent.mkdir(parents=True, exist_ok=True)
    workflow.write_text("// old engine\n", encoding="utf-8")

    # When: 以升级方式运行 install.sh
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)

    # Then: 三条退役注册不在、用户那条仍在；输出含「退役」与 .claude/workflows/opsx-apply.js，该文件仍存在
    assert p.returncode == 0, p.stderr
    commands = _all_commands(json.loads(settings.read_text(encoding="utf-8")))
    assert not [c for c in commands if c in RETIRED_HOOKS], commands
    assert USER_STOP_HOOK in commands, commands
    assert "退役" in p.stdout and ".claude/workflows/opsx-apply.js" in p.stdout, p.stdout
    assert workflow.is_file()

# ---------------------------------------------------------------- flight-interaction
# S5 已实现：xfail 标记已去。


def test_install_warns_retired_files_unprotected(tmp_path):
    # Given: 已装旧版模板、.claude/workflows/opsx-apply.js 仍在的目标项目
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    workflow = target / ".claude" / "workflows" / "opsx-apply.js"
    workflow.parent.mkdir(parents=True, exist_ok=True)
    workflow.write_text("// old engine\n", encoding="utf-8")

    # When: 以升级方式运行 install.sh
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)

    # Then: 输出列出 .claude/workflows/opsx-apply.js，并含「仍可被调用」与「不再受起飞批准」
    assert p.returncode == 0, p.stderr
    assert ".claude/workflows/opsx-apply.js" in p.stdout, p.stdout
    assert "仍可被调用" in p.stdout and "不再受起飞批准" in p.stdout, p.stdout

# ---------------------------------------------------------------- flight-entry-handoff
# 骨架：S5 实现后去掉 xfail 标记。


MOVED = (".claude/commands/pr-ship.md", ".claude/agents/code-reviewer.md")


def test_install_lists_files_moved_into_plugin(tmp_path):
    # Given: 已装旧版模板、.claude/commands/pr-ship.md 与 .claude/agents/code-reviewer.md 仍在的目标项目；另一个空目录
    target, fresh = tmp_path / "proj", tmp_path / "fresh"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    for rel in MOVED:
        (target / rel).parent.mkdir(parents=True, exist_ok=True)
        (target / rel).write_text("# old copy\n", encoding="utf-8")

    # When: 以升级方式运行 install.sh；另在空目录做一次全新安装
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)
    q, _ = run_install_stubbed(tmp_path, fresh, claude=False)

    # Then: 升级输出列出两个路径并含「已迁入 flight 插件」与 /flight:pr-ship，两个文件仍在；全新安装后没有这两个文件
    assert p.returncode == 0 and q.returncode == 0, (p.stderr, q.stderr)
    assert all(rel in p.stdout for rel in MOVED), p.stdout
    assert "已迁入 flight 插件" in p.stdout and "/flight:pr-ship" in p.stdout, p.stdout
    assert all((target / rel).exists() for rel in MOVED)
    assert not any((fresh / rel).exists() for rel in MOVED)

# ---------------------------------------------------------------- install-openspec-seeds
# 骨架：S1 实现后去掉 xfail 标记；test_upgrade_keeps_user_seed_edits 是护栏，base 上须通过。
TEMPLATE_OPENSPEC = ROOT / "template" / "openspec"
OPENSPEC_SEEDS = {".gitignore", "config.yaml", "changes/.gitkeep", "adr/.gitkeep", "superpower/.gitkeep"}
SUSPECT_HINT = "旧版安装器"


def _files_under(root):
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def _dev_artifact_names():
    """本仓自己的开发工件各取一个名字：template/openspec/changes 下的 change 目录、adr 下的 DRAFT ADR。"""
    change = sorted(p.name for p in (TEMPLATE_OPENSPEC / "changes").iterdir() if p.is_dir())[0]
    adr = sorted(p.name for p in (TEMPLATE_OPENSPEC / "adr").glob("DRAFT-*.md"))[0]
    return change, adr


def test_fresh_install_ships_only_seeds(tmp_path):
    # Given: 一个空目录
    target = tmp_path / "proj"

    # When: 运行 install.sh <目录>
    p, _ = run_install_stubbed(tmp_path, target, claude=False)

    # Then: 以 0 退出；openspec/ 里的文件恰为种子清单加上模板 openspec/schemas/ 下的全部文件
    assert p.returncode == 0, p.stderr
    schemas = {"schemas/" + rel for rel in _files_under(TEMPLATE_OPENSPEC / "schemas")}
    assert _files_under(target / "openspec") == OPENSPEC_SEEDS | schemas


def test_upgrade_adds_no_dev_artifacts(tmp_path):
    # Given: 用 install.sh 装好的项目；用户自己建了 change my-change（含 proposal.md）与 ADR 0001-mine.md
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    for f in (target / "openspec" / "changes" / "my-change" / "proposal.md", target / "openspec" / "adr" / "0001-mine.md"):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("# mine\n", encoding="utf-8")

    # When: 运行 install.sh --upgrade <项目>
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)

    # Then: 以 0 退出；changes/ 下只有 .gitkeep 与 my-change，adr/ 下只有 .gitkeep 与 0001-mine.md；输出不含「旧版安装器」
    assert p.returncode == 0, p.stderr
    assert {x.name for x in (target / "openspec" / "changes").iterdir()} == {".gitkeep", "my-change"}
    assert {x.name for x in (target / "openspec" / "adr").iterdir()} == {".gitkeep", "0001-mine.md"}
    assert SUSPECT_HINT not in p.stdout, p.stdout


def test_upgrade_keeps_user_seed_edits(tmp_path):
    # Given: 用 install.sh 装好的项目；用户改过 openspec/config.yaml，openspec/schemas/intent-driven/schema.yaml 被本地改坏
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    config = target / "openspec" / "config.yaml"
    schema = target / "openspec" / "schemas" / "intent-driven" / "schema.yaml"
    config.write_text("schema: intent-driven\n# mine\n", encoding="utf-8")
    schema.write_text("broken\n", encoding="utf-8")

    # When: 运行 install.sh --upgrade <项目>
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)

    # Then: 以 0 退出；config.yaml 仍是用户的内容；schema.yaml 恢复为模板原文
    assert p.returncode == 0, p.stderr
    assert config.read_text(encoding="utf-8") == "schema: intent-driven\n# mine\n"
    assert schema.read_bytes() == (TEMPLATE_OPENSPEC / "schemas" / "intent-driven" / "schema.yaml").read_bytes()


def test_upgrade_lists_suspected_dev_artifacts(tmp_path):
    # Given: 已装项目里有与模板 change 目录同名的目录、与模板 DRAFT ADR 同名的文件（模拟旧版安装器误拷），另有用户自己的 my-change
    change, adr = _dev_artifact_names()
    target = tmp_path / "proj"
    first, _ = run_install_stubbed(tmp_path, target, claude=False)
    assert first.returncode == 0, first.stderr
    planted = [target / "openspec" / "changes" / change / "proposal.md", target / "openspec" / "adr" / adr,
               target / "openspec" / "changes" / "my-change" / "proposal.md"]
    for f in planted:
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("# old copy\n", encoding="utf-8")

    # When: 运行 install.sh --upgrade <项目>
    p, _ = run_install_stubbed(tmp_path, target, "--upgrade", claude=False)

    # Then: 以 0 退出；输出含「旧版安装器」与「安装器不代删」；提示段列出那个 change 目录与那份 ADR，不列 my-change；三者都仍在
    assert p.returncode == 0, p.stderr
    assert SUSPECT_HINT in p.stdout and "安装器不代删" in p.stdout, p.stdout
    hint = p.stdout[p.stdout.index(SUSPECT_HINT):]
    assert "openspec/changes/%s" % change in hint and "openspec/adr/%s" % adr in hint, hint
    assert "my-change" not in hint, hint
    assert all(f.exists() for f in planted)
