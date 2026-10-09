"""本仓库自身的测试基座：按路径加载 template/.claude/hooks/*.py，并提供临时 git 仓库。"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import textwrap

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOOKS = ROOT / "template" / ".claude" / "hooks"


def hook_path(name: str) -> pathlib.Path:
    return HOOKS / f"{name}.py"


def load_hook(name: str):
    """按文件路径导入 hook 模块（文件名含连字符，不能直接 import）。"""
    path = hook_path(name)
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_hook(name: str, *args: str, stdin: str = "", env=None, cwd=None):
    """以子进程方式运行 hook 脚本，返回 CompletedProcess。"""
    return subprocess.run(
        [sys.executable, str(hook_path(name)), *args],
        input=stdin, capture_output=True, text=True,
        env={**os.environ, **(env or {})}, cwd=cwd,
    )


def git(repo, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()


def write(path: pathlib.Path, text: str) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text).lstrip("\n"), encoding="utf-8")
    return path


def commit_all(repo, msg: str) -> str:
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def git_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@example.com")
    git(repo, "config", "user.name", "t")
    (repo / "README.md").write_text("# t\n", encoding="utf-8")
    commit_all(repo, "init")
    return repo


# ---------------------------------------------------------------- 飞行批准账本（flight-approval-ledger）
def make_change(root, name="demo", under=("openspec", "changes")) -> pathlib.Path:
    """在 root 下建一个计划工件齐全的最小 change 目录（tasks.md 留一个未勾选项），返回目录路径。"""
    d = pathlib.Path(root).joinpath(*under, name)
    write(d / "proposal.md", "## Why\n\n演示。\n")
    write(d / "design.md", "## Context\n\n演示。\n")
    write(d / "specs" / "cap" / "spec.md",
          "## ADDED Requirements\n\n### Requirement: R\n\n#### Scenario: s\n- **GIVEN** g\n- **WHEN** w\n- **THEN** t\n")
    plan = {"version": 1, "change": name,
            "gate": {"test": "true", "lint": None, "typecheck": None, "full_suite_sec": 9.6},
            "slices": [{"id": "S1", "title": "t", "owns": ["a.py"], "deps": [], "verify": "true",
                        "scenarios": ["cap#s"], "packet": "slices/S1.md"}],
            "scenario_tests": {"cap#s": "tests/test_a.py::test_s"}}
    (d / "slices.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write(d / "slices" / "S1.md", "# S1\n\n演示切片包。\n")
    write(d / "tasks.md", "- [ ] S1 t\n")
    write(d / "spec.html", "<html></html>\n")
    return d


def approve_event(change, fp, at="2026-10-09T08:00:00Z") -> dict:
    """账本 v1 的一条 approve 事件（design D2）。"""
    return {"v": 1, "ev": "approve", "change": change, "fp": fp, "at": at,
            "by": {"plugin": "flight", "surface": "terminal", "session": "test"}}


def ledger_append(repo, change, event=None, *, files=None, parents=None, ref=None) -> str:
    """用 git plumbing 往 refs/flight/<change>/ledger 追加一个提交，返回新提交 sha。
    event → 树里写一个 event.json；files={文件名: 文本} 直接指定树内容（造非法树）；
    parents=[sha, ...] 显式指定父提交（造 merge 提交）；ref 改写目标引用。"""
    ref = ref or "refs/flight/%s/ledger" % change
    if files is None:
        files = {"event.json": json.dumps(event, ensure_ascii=False)}

    def plumb(*args, stdin=None):
        return subprocess.run(["git", *args], cwd=repo, input=stdin, capture_output=True,
                              text=True, check=True).stdout.strip()

    entries = []
    for name, text in sorted(files.items()):
        entries.append("100644 blob %s\t%s" % (plumb("hash-object", "-w", "--stdin", stdin=text), name))
    tree = plumb("mktree", stdin="\n".join(entries) + "\n")
    old = subprocess.run(["git", "rev-parse", "-q", "--verify", ref], cwd=repo,
                         capture_output=True, text=True).stdout.strip()
    if parents is None:
        parents = [old] if old else []
    args = ["commit-tree", tree]
    for p in parents:
        args += ["-p", p]
    sha = plumb(*args, "-m", "flight: test")
    plumb("update-ref", ref, sha)
    return sha
