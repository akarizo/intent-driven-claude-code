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
    """打归档时略去 template/openspec/changes（历史 change 工件，与安装无关，只会拖慢测试）。"""
    return None if "/template/openspec/changes" in info.name else info


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
