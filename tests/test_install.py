"""install.sh 与模板 openspec/.gitignore：飞行起飞记录 .flight 不入库（scenario: flight-record-ignore#*）。
骨架：xfail(strict) 直到 S4 实现；执行体去掉标记即解锁。"""
import os
import shutil
import subprocess

import pytest

from conftest import ROOT

GITIGNORE = ROOT / "template" / "openspec" / ".gitignore"
RULE = "changes/*/.flight"


def run_install(tmp_path, target, *flags):
    """用本仓库的 install.sh 安装 / 升级到 target；PATH 前置一个 openspec 桩（install.sh 只检查它是否存在）。"""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    stub = bin_dir / "openspec"
    stub.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    stub.chmod(0o755)
    env = {**os.environ, "PATH": "%s%s%s" % (bin_dir, os.pathsep, os.environ.get("PATH", ""))}
    return subprocess.run(["bash", str(ROOT / "install.sh"), *flags, str(target)],
                          env=env, capture_output=True, text=True, timeout=120)


def ignored(repo, rel):
    return subprocess.run(["git", "check-ignore", "-q", rel], cwd=repo).returncode == 0


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S4 未实现：模板 openspec/.gitignore 忽略 .flight")
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


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S4 未实现：install.sh 升级时幂等补 .flight 规则")
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
