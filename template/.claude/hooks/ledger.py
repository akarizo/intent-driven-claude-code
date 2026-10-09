#!/usr/bin/env python3
"""飞行审批账本只读判定器：读取并校验 refs/flight/<change>/ledger 提交链（design D2 / D3）。

只读：本文件不含任何写 git 对象或引用的命令；写入只在插件进程内。
CLI：ledger.py {show|approved|verify} --change-dir DIR
  LedgerInvalid → exit 4；其他异常（git 不可用等）→ exit 5。
"""
import argparse
import json
import os
import re
import subprocess
import sys

EVENTS = {"approve"}
FP_RE = re.compile(r"^[0-9a-f]{64}$")


class LedgerInvalid(Exception):
    def __init__(self, sha, reason):
        super().__init__("%s %s" % (sha[:8], reason))
        self.sha8 = sha[:8]
        self.reason = reason


def ref_for(change):
    return "refs/flight/%s/ledger" % change


def _git(change_dir, *args, check=True):
    p = subprocess.run(["git", "-C", change_dir, *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError("git %s 失败：%s" % (args[0], p.stderr.strip()))
    return p


def _check_event(sha, ev, change):
    if not isinstance(ev, dict):
        raise LedgerInvalid(sha, "event.json 不是 JSON 对象")
    if ev.get("v") != 1:
        raise LedgerInvalid(sha, "v 不是 1")
    if ev.get("ev") not in EVENTS:
        raise LedgerInvalid(sha, "ev 非法")
    if ev.get("change") != change:
        raise LedgerInvalid(sha, "change 与目录名不符")
    if not isinstance(ev.get("fp"), str) or not FP_RE.match(ev["fp"]):
        raise LedgerInvalid(sha, "fp 不是 64 位十六进制")
    if not isinstance(ev.get("at"), str):
        raise LedgerInvalid(sha, "at 不是字符串")
    by = ev.get("by")
    if not isinstance(by, dict) or "plugin" not in by:
        raise LedgerInvalid(sha, "by 缺 plugin")


def read_events(change_dir):
    """按写入顺序返回账本事件；无引用 → []。链上任一提交非法 → LedgerInvalid。"""
    change_dir = os.path.normpath(str(change_dir))
    change = os.path.basename(change_dir)
    ref = ref_for(change)
    if _git(change_dir, "rev-parse", "-q", "--verify", ref, check=False).returncode != 0:
        return []
    events = []
    for line in _git(change_dir, "rev-list", "--reverse", "--parents", ref).stdout.splitlines():
        shas = line.split()
        if not shas:
            continue
        sha = shas[0]
        if len(shas) - 1 > 1:
            raise LedgerInvalid(sha, "父提交数大于 1")
        entries = _git(change_dir, "ls-tree", "--full-tree", sha).stdout.splitlines()
        if len(entries) != 1:
            raise LedgerInvalid(sha, "树内应恰一项 event.json，实有 %d 项" % len(entries))
        meta, _, name = entries[0].partition("\t")
        parts = meta.split()
        if name != "event.json" or len(parts) != 3 or parts[1] != "blob":
            raise LedgerInvalid(sha, "树内唯一项不是 event.json blob")
        text = _git(change_dir, "cat-file", "-p", parts[2]).stdout
        try:
            ev = json.loads(text)
        except ValueError:
            raise LedgerInvalid(sha, "event.json 不是合法 JSON")
        _check_event(sha, ev, change)
        events.append(ev)
    return events


def latest_approval(change_dir):
    """返回 (最新 approve 事件 | None, 账本 tip sha | None)。"""
    events = read_events(change_dir)
    if not events:
        return None, None
    change = os.path.basename(os.path.normpath(str(change_dir)))
    tip = _git(str(change_dir), "rev-parse", "-q", "--verify", ref_for(change)).stdout.strip()
    approvals = [e for e in events if e["ev"] == "approve"]
    return (approvals[-1] if approvals else None), tip


def main(argv=None):
    ap = argparse.ArgumentParser(description="飞行审批账本只读判定器")
    ap.add_argument("cmd", choices=["show", "approved", "verify"])
    ap.add_argument("--change-dir", required=True)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "show":
            for ev in read_events(args.change_dir):
                print(json.dumps(ev, ensure_ascii=False))
        elif args.cmd == "approved":
            ev, _ = latest_approval(args.change_dir)
            if ev:
                print(ev["fp"])
        else:
            read_events(args.change_dir)
    except LedgerInvalid as e:
        print("账本损坏：%s %s" % (e.sha8, e.reason), file=sys.stderr)
        return 4
    except Exception as e:  # git 不可用、目录不在仓库内等
        print(str(e).replace("\n", " "), file=sys.stderr)
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main())
