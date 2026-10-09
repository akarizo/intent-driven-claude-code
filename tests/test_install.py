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
# 骨架：S6 实现后逐条去掉 xfail 标记。

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


@pytest.mark.xfail(strict=True, reason="S6 未实现：marketplace add 失败后仍执行 install")
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


@pytest.mark.xfail(strict=True, reason="S6 未实现：两步都失败时仍须都尝试")
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


@pytest.mark.xfail(strict=True, reason="S6 未实现：升级补缺失的 settings 顶层键")
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
