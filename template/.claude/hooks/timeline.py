#!/usr/bin/env python3
# timeline · 飞行记录（design D2）
#   render --change-dir DIR   从账本（同目录 ledger.py）与 <DIR>/gate-baseline.json 整份重写 <DIR>/timeline.md 与 <DIR>/gate-report.md；
#                             stdout 打印 {"timeline", "report", "events"}；账本读不出 → stderr 写原因、退出 1、不写文件；账本不变时输出逐字节相同
#   report --change-dir DIR   账本里有 takeoff → 账本模式：打印与 render 相同的事件行，再打印批准 → apply 完成（第一条 approve → 最后一条 land）、
#                             批准 → PR 打开（第一条 approve → 第一条 ship）、每片派发 → 门禁绿、门禁红次数、测量统计、诊断条数、
#                             自愈次数与逐条 <kind> <slice>、停飞诊断（最后一条 triage 的首行）；
#                             否则（含账本读不出）→ 兼容模式：按 <DIR>/timeline.md 的行统计（PR 打开取账本第一条 ship，否则最后一条 pr-open 行）
# 兼容 Python 3.8+，只用标准库。
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import ledger  # 同目录：脚本目录在 sys.path 上

TIMELINE = "timeline.md"
REPORT = "gate-report.md"
BASELINE = "gate-baseline.json"
TS_FMT = "%Y-%m-%dT%H:%M:%SZ"
RENDER_HEAD = "<!-- timeline：timeline.py render 从账本生成，勿手改 -->"
REPORT_HEAD = ["# Gate Report", ""]
GATE_COLS = ["| 时间 | 切片 | 结论 | commit | failed | warnings |", "|---|---|---|---|---|---|"]
CEILING_HEAD = "## 天花板"
CEILING_COLS = "| 时间 | 切片 | 位置 | 限制 | 升级路径 |"
CEILING_SEP = "|---|---|---|---|---|"
RED = ("FAILED", "ERROR")


def parse_ts(s):
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ts(e):
    """事件时间 → UTC datetime；解析不了 → None。"""
    try:
        return parse_ts(e.get("at") or "")
    except (TypeError, ValueError):
        return None


def _fmt_at(at):
    """统一成 TS_FMT；解析不了原样保留（只取首行）。"""
    try:
        return parse_ts(at).astimezone(timezone.utc).strftime(TS_FMT)
    except (TypeError, ValueError, AttributeError):
        return _flat(str(at))


def _flat(text):
    """备注取首行，\\t 换空格。"""
    lines = str(text).splitlines()
    return (lines[0] if lines else "").replace("\t", " ")


def _cell(text):
    return str(text).replace("|", "/").replace("\n", " ")


def _strs(x):
    return [str(i) for i in x] if isinstance(x, list) else []


def _red_count(outcomes):
    return sum(1 for o in outcomes or [] if isinstance(o, list) and len(o) > 1 and o[1] in RED)


def _note(e):
    ev, g = e.get("ev"), e.get
    if ev == "approve":
        return "fp %s" % str(g("fp") or "")[:8]
    if ev == "takeoff":
        return "attempt %s · 主模型 %s" % (g("attempt"), g("model"))
    if ev == "dispatch":
        return "%s %s %s" % (g("slice"), g("role"), str(g("agent") or "")[:8])
    if ev == "measure":
        outcomes = g("outcomes") or []
        return "%s 目标 %d 个 · 红 %d 个" % (g("slice"), len(outcomes), _red_count(outcomes))
    if ev in ("gate", "merge"):
        return "%s %s" % (g("slice"), "ok" if g("ok") else "red")
    if ev == "ended":
        return "%s %s %s" % (str(g("agent") or "")[:8], g("reason"), g("model") or "-")
    if ev == "review":
        findings = g("findings") or []
        high = sum(1 for f in findings if isinstance(f, dict) and f.get("severity") in ("CRITICAL", "HIGH"))
        return "%s %d 条（CRITICAL/HIGH %d）" % (g("slice"), len(findings), high)
    if ev == "blocked":
        return "%s %s：%s" % (g("slice"), g("kind"), g("reason"))
    if ev == "final":
        return "ok" if g("ok") else "red"
    if ev == "land":
        return str(g("verdict"))
    if ev == "halt":
        return str(g("reason"))
    if ev == "ship":
        return "%s %s" % (g("verdict"), g("pr"))
    if ev == "diag":
        return "%s %s：%s" % (g("where"), g("kind") or "-", g("error"))
    if ev == "heal":
        return "%s %s" % (g("kind"), g("slice"))
    if ev == "triage":
        return _flat(g("text") or "")
    return ""


def _baseline_line(change_dir):
    """gate-baseline.json 有 at → baseline 行；文件缺失 / 不是 JSON / 没有 at → None。"""
    try:
        with open(os.path.join(change_dir, BASELINE), "r", encoding="utf-8") as f:
            bl = json.load(f)
    except (OSError, ValueError):
        return None
    if not isinstance(bl, dict) or not bl.get("at"):
        return None
    test = bl.get("test") if isinstance(bl.get("test"), dict) else {}
    note = "exit %s, %ss %s" % (test.get("exit"), test.get("sec"), "ok" if bl.get("ok") else "red")
    return "%s\tbaseline\t%s" % (_fmt_at(bl["at"]), _flat(note))


def event_lines(change_dir, events):
    lines = []
    bl = _baseline_line(change_dir)
    if bl:
        lines.append(bl)
    for e in events:
        lines.append("%s\t%s\t%s" % (_fmt_at(e.get("at")), _flat(e.get("ev")), _flat(_note(e))))
    return lines


def ceiling_rows_from_json(raw):
    """gate 事件的 ceilings 字段 → (路径, 行号, 限制, 升级路径)；形状不对的整条丢掉，行号不可信降级为 0。绝不抛异常。"""
    if not isinstance(raw, (list, tuple)):
        return []
    out = []
    for r in raw:
        if not isinstance(r, (list, tuple)) or len(r) < 4:
            continue
        try:
            ln = int(str(r[1]).strip())
        except (TypeError, ValueError):
            ln = 0
        out.append((str(r[0]), ln, str(r[2]), str(r[3])))
    return out


def report_text(events):
    gate_rows, ceil_rows = [], []
    for e in events:
        if e.get("ev") not in ("gate", "final"):
            continue
        at = _fmt_at(e.get("at"))
        sid = "final" if e["ev"] == "final" else str(e.get("slice") or "")
        gate_rows.append("| %s | %s | %s | %s | %s | %s |" % (
            at, sid, "ok" if e.get("ok") else "red", str(e.get("commit") or "")[:10],
            _cell("; ".join(_strs(e.get("failed")))) or "-",
            _cell("; ".join(_strs(e.get("warnings")))) or "-"))
        if e["ev"] == "gate":
            ceil_rows += ["| %s | %s | %s:%d | %s | %s |" % (at, sid, rel, ln, _cell(limit), _cell(up))
                          for rel, ln, limit, up in ceiling_rows_from_json(e.get("ceilings"))]
    lines = REPORT_HEAD[:]
    if ceil_rows:  # 天花板表在门禁表之前，与原 record_ceilings 的版式一致
        lines += [CEILING_HEAD, "", CEILING_COLS, CEILING_SEP] + ceil_rows + [""]
    lines += GATE_COLS + gate_rows
    return "\n".join(lines) + "\n"


def render(change_dir):
    try:
        events = ledger.read_events(change_dir)
    except Exception as e:  # 账本损坏 / 不在仓库内 / git 不可用
        print("账本读不出：%s" % str(e).replace("\n", " "), file=sys.stderr)
        return 1
    # 先算好全部内容再写，避免写一半
    timeline = "\n".join([RENDER_HEAD] + event_lines(change_dir, events)) + "\n"
    report = report_text(events)
    tpath, rpath = os.path.join(change_dir, TIMELINE), os.path.join(change_dir, REPORT)
    for path, text in ((tpath, timeline), (rpath, report)):
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    print(json.dumps({"timeline": tpath, "report": rpath, "events": len(events)}, ensure_ascii=False))
    return 0


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


def _first_ship_at(events):
    """账本里第一条 ship 事件的时间（UTC）；没有、或时间解析不了 → None。"""
    for e in events or []:
        if e.get("ev") == "ship":
            return _ts(e)
    return None


def minutes(a, b):
    return round((b - a).total_seconds() / 60, 1)


def _span(a, b):
    return minutes(a, b) if a and b else "n/a"


def _red_lines(events):
    gate = sum(1 for e in events if e.get("ev") == "gate" and e.get("ok") is False)
    final = sum(1 for e in events if e.get("ev") == "final" and e.get("ok") is False)
    measures = [e for e in events if e.get("ev") == "measure"]
    seen_red = sum(1 for e in measures if _red_count(e.get("outcomes")) > 0)
    return ["门禁红次数：%d（账本：切片门禁 %d · final %d）" % (gate + final, gate, final),
            "测量：%d 次（见红 %d 次）" % (len(measures), seen_red)]


def report_ledger(change_dir, events):
    print("时间\t事件\t备注")
    for line in event_lines(change_dir, events):
        print(line)
    first = lambda ev: next((_ts(e) for e in events if e.get("ev") == ev), None)  # noqa: E731
    approve = first("approve")
    land = next((_ts(e) for e in reversed(events) if e.get("ev") == "land"), None)
    print("")
    print("批准 → apply 完成：%s min" % _span(approve, land))
    print("批准 → PR 打开：%s min" % _span(approve, first("ship")))
    order = []
    for i, e in enumerate(events):
        if e.get("ev") != "dispatch" or e.get("role") != "executor" or e.get("slice") in order:
            continue
        sid = e.get("slice")
        order.append(sid)
        ok = next((g for g in events[i + 1:] if g.get("ev") == "gate" and g.get("slice") == sid and g.get("ok") is True), None)
        if ok is not None:
            print("切片 %s：派发 → 门禁绿 %s min" % (sid, _span(_ts(e), _ts(ok))))
    for line in _red_lines(events):
        print(line)
    diags = sum(1 for e in events if e.get("ev") == "diag")
    if diags:
        print("诊断：%d 条" % diags)
    heals = [e for e in events if e.get("ev") == "heal"]
    if heals:
        print("自愈：%d 次" % len(heals))
        for e in heals:
            print("  %s %s（%s）" % (e.get("kind"), e.get("slice"), _flat(e.get("reason") or "")))
    triages = [e for e in events if e.get("ev") == "triage"]
    if triages:
        print("停飞诊断：%s" % _flat(triages[-1].get("text") or ""))


def report(change_dir):
    try:
        events = ledger.read_events(change_dir)
    except Exception:
        events = None
    if events and any(e.get("ev") == "takeoff" for e in events):
        report_ledger(change_dir, events)
        return
    rows = load(change_dir)
    if not rows:
        print("timeline.md 为空或不存在")
        return
    print("时间\t事件\t备注")
    for ts, ev, note in rows:
        print("%s\t%s\t%s" % (ts.strftime(TS_FMT), ev, note))
    approve = next((ts for ts, ev, _ in rows if ev == "approve"), None)
    pr_open = _first_ship_at(events)
    if pr_open is None:
        pr_open = next((ts for ts, ev, _ in reversed(rows) if ev == "pr-open"), None)
    apply_done = next((ts for ts, ev, _ in reversed(rows) if ev == "apply-done"), None)
    print("")
    print("批准 → apply 完成：%s min" % _span(approve, apply_done))
    print("批准 → PR 打开：%s min" % _span(approve, pr_open))
    starts = {}
    for ts, ev, note in rows:
        if ev == "slice-start":
            starts.setdefault(note.split()[0] if note else "?", ts)
        elif ev == "gate" and note.endswith(" ok"):
            sid = note.split()[0]
            if sid in starts:
                print("切片 %s：start → gate ok %s min" % (sid, minutes(starts[sid], ts)))
    reds = sum(1 for _, ev, note in rows if ev in ("gate", "final") and note.endswith("red"))
    print("门禁红次数：%d%s" % (reds, "（账本读取失败，按 timeline 统计）" if events is None else ""))


def main():
    ap = argparse.ArgumentParser(description="timeline：飞行记录")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("render", "report"):
        sub.add_parser(name).add_argument("--change-dir", required=True)
    args = ap.parse_args()
    if args.cmd == "render":
        return render(args.change_dir)
    report(args.change_dir)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)
