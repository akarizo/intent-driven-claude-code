#!/usr/bin/env python3
"""飞行审批账本只读判定器：读取并校验 refs/flight/<change>/ledger 提交链（design D2 / D3）。

只读：本文件不含任何写 git 对象或引用的命令；写入只在插件进程内。
CLI：ledger.py {show|approved|verify} --change-dir DIR；ledger.py events（按字母序列出事件类型）
  LedgerInvalid → exit 4；LedgerUnreadable（不在仓库内等）与其他异常（git 不可执行等）→ exit 5。
"""
import argparse
import json
import os
import re
import subprocess
import sys

FP_RE = re.compile(r"^[0-9a-f]{64}$")
SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")


def _int(x):  # Python 里 True 是 int，须排除
    return isinstance(x, int) and not isinstance(x, bool)


def _strs(x):
    return isinstance(x, list) and all(isinstance(i, str) for i in x)


def _finding(f):
    return (isinstance(f, dict) and f.get("severity") in SEVERITIES and isinstance(f.get("file"), str)
            and _int(f.get("line")) and isinstance(f.get("summary"), str) and isinstance(f.get("fix"), str))


def _one_of(*opts):
    return (lambda x: isinstance(x, str) and x in opts), "不在 %s 之内" % " / ".join(opts)


# 字段校验：(判定函数, 不合法时的描述)
FP = (lambda x: isinstance(x, str) and FP_RE.match(x) is not None, "不是 64 位十六进制")
ATTEMPT = (lambda x: _int(x) and x > 0, "不是正整数")
NONEMPTY = (lambda x: isinstance(x, str) and x != "", "不是非空字符串")
STR = (lambda x: isinstance(x, str), "不是字符串")
BOOL = (lambda x: isinstance(x, bool), "不是布尔")
STRS = (_strs, "不是字符串数组")
RESULT = {"attempt": ATTEMPT, "slice": NONEMPTY, "ok": BOOL, "commit": STR, "failed": STRS}
OUTCOMES = ("PASSED", "FAILED", "ERROR", "SKIPPED", "XFAIL", "XPASS", "MISSING")


def _outcome(o):
    return isinstance(o, list) and len(o) == 2 and _strs(o) and o[1] in OUTCOMES

# 每类事件除公共字段（v / ev / change / at / by.plugin）外的必需字段；允许表外额外字段（spec flight-ledger-events）
EVENTS = {
    "approve": {"fp": FP},
    "takeoff": {"attempt": ATTEMPT, "fp": FP, "branch": NONEMPTY, "model": NONEMPTY,
                "waves": (lambda x: isinstance(x, list) and all(_strs(w) for w in x), "不是字符串数组的数组")},
    "dispatch": {"attempt": ATTEMPT, "slice": NONEMPTY, "role": _one_of("executor", "reviewer", "fixer", "resolver"),
                 "agent": NONEMPTY, "model": NONEMPTY, "worktree": NONEMPTY},
    "gate": RESULT,
    "ended": {"attempt": ATTEMPT, "agent": NONEMPTY, "reason": STR,
              "model": (lambda x: x is None or isinstance(x, str), "不是字符串或 null")},
    "merge": RESULT,
    "review": {"attempt": ATTEMPT, "slice": NONEMPTY, "agent": NONEMPTY,
               "findings": (lambda x: isinstance(x, list) and all(_finding(f) for f in x), "不是合法的 findings 数组")},
    "blocked": {"attempt": ATTEMPT, "slice": NONEMPTY, "kind": _one_of("gate", "infra"), "reason": STR},
    "final": {"attempt": ATTEMPT, "ok": BOOL, "commit": STR, "failed": STRS},
    "land": {"attempt": ATTEMPT, "verdict": _one_of("ready", "draft")},
    "halt": {"attempt": ATTEMPT, "reason": STR},
    "measure": {"attempt": ATTEMPT, "slice": NONEMPTY, "agent": NONEMPTY, "base": NONEMPTY, "commit": STR,
                "outcomes": (lambda x: isinstance(x, list) and all(_outcome(o) for o in x),
                             "不是 [目标, 结果] 数组（结果在 %s 之内）" % " / ".join(OUTCOMES)),
                "changed": STRS, "source": STRS},
}


class LedgerInvalid(Exception):
    def __init__(self, sha, reason):
        super().__init__("%s %s" % (sha[:8], reason))
        self.sha8 = sha[:8]
        self.reason = reason


class LedgerUnreadable(Exception):
    """git 能执行但读不了账本（目录不在仓库内、仓库归属不安全等）：是判定结果，不是门禁故障。"""


def ref_for(change):
    return "refs/flight/%s/ledger" % change


def _git(change_dir, *args, check=True):
    # 按字节取输出：非 UTF-8 内容不得在 subprocess 内部抛 UnicodeDecodeError；调用方需要文本时显式 decode
    # git 不可执行时 subprocess 抛 FileNotFoundError，原样上抛，由调用方按门禁故障处理
    p = subprocess.run(["git", "-C", change_dir, *args], capture_output=True)
    if check and p.returncode != 0:
        raise LedgerUnreadable("git %s 失败：%s" % (args[0], _err(p)))
    return p


def _err(p):
    return p.stderr.decode("utf-8", "replace").strip()


def _out(p):
    return p.stdout.decode("utf-8", "replace")


def _check_event(sha, ev, change):
    if not isinstance(ev, dict):
        raise LedgerInvalid(sha, "event.json 不是 JSON 对象")
    if ev.get("v") != 1:
        raise LedgerInvalid(sha, "v 不是 1")
    if not isinstance(ev.get("ev"), str) or ev["ev"] not in EVENTS:  # 列表等不可哈希值不得抛 TypeError
        raise LedgerInvalid(sha, "ev 非法")
    if ev.get("change") != change:
        raise LedgerInvalid(sha, "change 与目录名不符")
    if not isinstance(ev.get("at"), str):
        raise LedgerInvalid(sha, "at 不是字符串")
    by = ev.get("by")
    if not isinstance(by, dict) or "plugin" not in by:
        raise LedgerInvalid(sha, "by 缺 plugin")
    for field, (ok, desc) in EVENTS[ev["ev"]].items():
        if not ok(ev.get(field)):
            raise LedgerInvalid(sha, "%s 的 %s %s" % (ev["ev"], field, desc))


def _read(change_dir):
    """返回 (按写入顺序的账本事件, 链尾 sha)；无引用 → ([], None)。链尾只解析一次，后续 git 调用都用它。"""
    change_dir = os.path.normpath(str(change_dir))
    change = os.path.basename(change_dir)
    ref = ref_for(change)
    p = _git(change_dir, "rev-parse", "-q", "--verify", ref, check=False)
    if p.returncode == 1:  # 引用不存在
        return [], None
    if p.returncode != 0:  # 128 等：目录不存在 / 不在仓库内，不得当成无账本
        raise LedgerUnreadable("git rev-parse 失败：%s" % _err(p))
    tip = _out(p).strip()
    # rev-list 遇到树 / blob 不报错、只是无输出，不先验类型会把它当成合法的空账本
    t = _git(change_dir, "cat-file", "-t", tip, check=False)
    if t.returncode != 0:
        raise LedgerInvalid(tip, "引用指向不存在的对象")
    if _out(t).strip() != "commit":
        raise LedgerInvalid(tip, "引用不指向提交")
    events = []
    for line in _out(_git(change_dir, "rev-list", "--reverse", "--parents", tip)).splitlines():
        shas = line.split()
        if not shas:
            continue
        sha = shas[0]
        if len(shas) - 1 > 1:
            raise LedgerInvalid(sha, "父提交数大于 1")
        entries = _out(_git(change_dir, "ls-tree", "--full-tree", sha)).splitlines()
        if len(entries) != 1:
            raise LedgerInvalid(sha, "树内应恰一项 event.json，实有 %d 项" % len(entries))
        meta, _, name = entries[0].partition("\t")
        parts = meta.split()
        if name != "event.json" or len(parts) != 3 or parts[1] != "blob":
            raise LedgerInvalid(sha, "树内唯一项不是 event.json blob")
        raw = _git(change_dir, "cat-file", "-p", parts[2]).stdout
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise LedgerInvalid(sha, "event.json 不是 UTF-8")
        try:
            ev = json.loads(text)
        except ValueError:
            raise LedgerInvalid(sha, "event.json 不是合法 JSON")
        _check_event(sha, ev, change)
        events.append(ev)
    return events, tip


def read_events(change_dir):
    """按写入顺序返回账本事件；无引用 → []。链上任一提交非法 → LedgerInvalid。"""
    return _read(change_dir)[0]


def latest_approval(change_dir):
    """返回 (最新 approve 事件 | None, 账本 tip sha | None)；tip 与读到的事件出自同一次解析。"""
    events, tip = _read(change_dir)
    if not events:
        return None, None
    approvals = [e for e in events if e["ev"] == "approve"]
    return (approvals[-1] if approvals else None), tip


def main(argv=None):
    ap = argparse.ArgumentParser(description="飞行审批账本只读判定器")
    ap.add_argument("cmd", choices=["show", "approved", "verify", "events"])
    ap.add_argument("--change-dir")
    args = ap.parse_args(argv)
    if args.cmd == "events":
        for name in sorted(EVENTS):
            print(name)
        return 0
    if not args.change_dir:
        ap.error("%s 需要 --change-dir" % args.cmd)
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
