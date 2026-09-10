#!/usr/bin/env python3
# stop-gate · Stop / SubagentStop：切片已 start 但门禁未绿时，拒绝收口
#
# 判定：cwd 的 git toplevel 下存在 .openspec-slice 标记 → 输出 {"decision":"block","reason":...}。
# 防死循环：stdin 的 stop_hook_active 为 true（本轮已因 stop hook 续跑过）时不再阻断。
# 没有标记（主会话在后台 workflow 运行期间、或普通会话）→ 静默。fail-open。兼容 Python 3.8+。
import json
import os
import subprocess
import sys

MARKER = ".openspec-slice"


def toplevel(cwd):
    try:
        p = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True)
        if p.returncode == 0 and p.stdout.strip():
            return p.stdout.strip()
    except OSError:
        pass
    return cwd


def main():
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
    if data.get("stop_hook_active"):
        return
    root = toplevel(data.get("cwd") or os.getcwd())
    marker = os.path.join(root, MARKER)
    if not os.path.isfile(marker):
        return
    with open(marker, "r", encoding="utf-8") as f:
        m = json.load(f)
    slice_id = m.get("slice") or "?"
    change_dir = m.get("change_dir") or "<change-dir>"
    reason = ("切片 %s 已 start 但门禁未绿，不能收口：先运行 "
              "`python3 .claude/hooks/slice-gate.py gate %s --change-dir %s`，绿后再结束；"
              "门禁红则修到绿，同一项连续 2 次红才停下报告。" % (slice_id, slice_id, change_dir))
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
