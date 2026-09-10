#!/usr/bin/env python3
# timeline · 飞行记录
#   record <event> --change-dir DIR [--note TEXT]   追加一行「ISO时间\t事件\t备注」到 <DIR>/timeline.md
#   report --change-dir DIR                         打印事件表与 approve → pr-open 用时（分钟）
# 事件约定：approve · slice-start · gate · review · fix · final · apply-done · pr-open · pause · baseline
# 兼容 Python 3.8+，只用标准库。
import argparse
import os
import sys
from datetime import datetime, timezone

TIMELINE = "timeline.md"
HEADER = "<!-- timeline: ISO时间\\t事件\\t备注（由 hooks 自动追加） -->\n"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record(change_dir, event, note=""):
    path = os.path.join(change_dir, TIMELINE)
    new = not os.path.isfile(path)
    os.makedirs(change_dir, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        if new:
            f.write(HEADER)
        f.write("%s\t%s\t%s\n" % (now_iso(), event, (note or "").replace("\n", " ")))


def parse_ts(s):
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load(change_dir):
    path = os.path.join(change_dir, TIMELINE)
    rows = []
    if not os.path.isfile(path):
        return rows
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("<!--"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            try:
                ts = parse_ts(parts[0])
            except ValueError:
                continue
            rows.append((ts, parts[1].strip(), parts[2].strip() if len(parts) > 2 else ""))
    return rows


def minutes(a, b):
    return round((b - a).total_seconds() / 60, 1)


def report(change_dir):
    rows = load(change_dir)
    if not rows:
        print("timeline.md 为空或不存在")
        return
    print("时间\t事件\t备注")
    for ts, ev, note in rows:
        print("%s\t%s\t%s" % (ts.strftime("%Y-%m-%dT%H:%M:%SZ"), ev, note))
    approve = next((ts for ts, ev, _ in rows if ev == "approve"), None)
    pr_open = next((ts for ts, ev, _ in reversed(rows) if ev == "pr-open"), None)
    apply_done = next((ts for ts, ev, _ in reversed(rows) if ev == "apply-done"), None)
    print("")
    print("批准 → apply 完成：%s min" % (minutes(approve, apply_done) if approve and apply_done else "n/a"))
    print("批准 → PR 打开：%s min" % (minutes(approve, pr_open) if approve and pr_open else "n/a"))
    starts = {}
    for ts, ev, note in rows:
        if ev == "slice-start":
            starts.setdefault(note.split()[0] if note else "?", ts)
        elif ev == "gate" and note.endswith(" ok"):
            sid = note.split()[0]
            if sid in starts:
                print("切片 %s：start → gate ok %s min" % (sid, minutes(starts[sid], ts)))
    reds = sum(1 for _, ev, note in rows if ev in ("gate", "final") and note.endswith("red"))
    print("门禁红次数：%d" % reds)


def main():
    ap = argparse.ArgumentParser(description="timeline：飞行记录")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("record")
    p.add_argument("event")
    p.add_argument("--change-dir", required=True)
    p.add_argument("--note", default="")
    p = sub.add_parser("report")
    p.add_argument("--change-dir", required=True)
    args = ap.parse_args()
    if args.cmd == "record":
        record(args.change_dir, args.event, args.note)
    else:
        report(args.change_dir)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
