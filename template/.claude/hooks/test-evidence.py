#!/usr/bin/env python3
# test-evidence · PostToolUse / PostToolUseFailure(Bash)：测试运行留痕，代替模型自述 RED / GREEN
#
# 命中测试运行器的 Bash 命令时，向 <change>/evidence.log 追加一行：
#   ISO时间\t<切片id 或 ->\t<PASS|FAIL>\t<命令前 120 字符>
# change 目录来源：git toplevel 下 .openspec-slice 标记的 change_dir；没有标记则找 openspec/changes/*/tasks.md 仍有未勾选项的 change。
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
MARKER = ".openspec-slice"
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


def find_change(root):
    """返回 (change_dir, slice_id)；找不到返回 (None, None)。"""
    marker = os.path.join(root, MARKER)
    if os.path.isfile(marker):
        try:
            with open(marker, "r", encoding="utf-8") as f:
                data = json.load(f)
            cd = data.get("change_dir") or ""
            if not os.path.isabs(cd):
                cd = os.path.join(root, cd)
            if os.path.isdir(cd):
                return cd, data.get("slice") or "-"
        except (OSError, ValueError):
            pass
    changes = os.path.join(root, "openspec", "changes")
    if os.path.isdir(changes):
        for name in sorted(os.listdir(changes)):
            if name == "archive":
                continue
            tasks = os.path.join(changes, name, "tasks.md")
            try:
                with open(tasks, "r", encoding="utf-8") as f:
                    if UNCHECKED.search(f.read()):
                        return os.path.join(changes, name), "-"
            except OSError:
                continue
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
