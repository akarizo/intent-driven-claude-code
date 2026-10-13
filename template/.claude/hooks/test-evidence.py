#!/usr/bin/env python3
# test-evidence · PostToolUse / PostToolUseFailure(Bash)：测试运行留痕，代替模型自述 RED / GREEN
#
# 命中测试运行器的 Bash 命令时，向 <change>/evidence.log 追加一行：
#   ISO时间\t-\t<PASS|FAIL>\t<命令前 120 字符>
# 只记飞行外的测试留痕（主会话修复、per-task 路径）；飞行 worktree 的测试由控制面测量入账本：
#   git toplevel 的当前分支（git symbolic-ref --short -q HEAD）以 flight/ 开头 → 一律不写；取不到分支按非飞行处理。
# change 目录来源（两级，不猜）：① 分支名 worktree-<name> 对应 openspec/changes/<name>；
#   ② tasks.md 仍有未勾选项的 change 恰好 1 个；否则不写。
# 结果判定：事件为 PostToolUseFailure → FAIL；否则 stdout/stderr 命中 failed|error|FAIL → FAIL；其余 PASS。
# fail-open：任何异常静默退出。兼容 Python 3.8+。
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

TEST_RE = re.compile(r"\b(pytest|npm (run )?test|pnpm (run )?test|yarn test|vitest|jest|go test|cargo test|make test|tox|unittest|mocha)\b")
FAIL_RE = re.compile(r"\b(failed|failures?|errors?|FAIL|FAILED)\b")
UNCHECKED = re.compile(r"^\s*[-*+]\s+\[ \]", re.M)
BRANCH_PREFIX = "worktree-"
FLIGHT_PREFIX = "flight/"
EVIDENCE = "evidence.log"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def toplevel(cwd):
    try:
        p = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True)
        if p.returncode == 0 and p.stdout.strip():
            return p.stdout.strip()
    except OSError:
        pass
    return cwd


def current_branch(root):
    """git symbolic-ref --short -q HEAD；失败或 detached HEAD 返回 None。"""
    try:
        p = subprocess.run(["git", "symbolic-ref", "--short", "-q", "HEAD"], cwd=root, capture_output=True, text=True)
        if p.returncode == 0 and p.stdout.strip():
            return p.stdout.strip()
    except OSError:
        pass
    return None


def find_change(root):
    """返回 (change_dir, slice_id)；找不到或多候选返回 (None, None)。"""
    branch = current_branch(root)
    # 飞行 worktree（切片 / 修复 / 解冲突都在 flight/<change>/… 下）：测试结果由控制面测量入账本，此处一律不写
    if branch and branch.startswith(FLIGHT_PREFIX):
        return None, None
    changes = os.path.join(root, "openspec", "changes")
    if not os.path.isdir(changes):
        return None, None
    # 1 分支名 worktree-<name>
    if branch and branch.startswith(BRANCH_PREFIX):
        cd = os.path.join(changes, branch[len(BRANCH_PREFIX):])
        if os.path.isdir(cd):
            return cd, "-"
    # 2 唯一候选
    candidates = []
    for name in sorted(os.listdir(changes)):
        if name == "archive":
            continue
        tasks = os.path.join(changes, name, "tasks.md")
        try:
            with open(tasks, "r", encoding="utf-8") as f:
                if UNCHECKED.search(f.read()):
                    candidates.append(os.path.join(changes, name))
        except OSError:
            continue
    if len(candidates) == 1:
        return candidates[0], "-"
    return None, None


def text_of(resp):
    if isinstance(resp, dict):
        return "%s\n%s" % (resp.get("stdout") or "", resp.get("stderr") or "")
    if isinstance(resp, list):
        return "\n".join(str(c.get("text", "")) if isinstance(c, dict) else str(c) for c in resp)
    return str(resp or "")


def main():
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
    if data.get("tool_name") != "Bash":
        return
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not TEST_RE.search(cmd):
        return
    root = toplevel(data.get("cwd") or os.getcwd())
    change_dir, slice_id = find_change(root)
    if not change_dir:
        return
    if data.get("hook_event_name") == "PostToolUseFailure":
        result = "FAIL"
    else:
        result = "FAIL" if FAIL_RE.search(text_of(data.get("tool_response"))) else "PASS"
    with open(os.path.join(change_dir, EVIDENCE), "a", encoding="utf-8") as f:
        f.write("%s\t%s\t%s\t%s\n" % (now_iso(), slice_id, result, cmd.replace("\n", " ")[:120]))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
