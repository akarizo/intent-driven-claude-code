#!/usr/bin/env python3
# takeoff-gate · 起飞前的人类批准门禁（两种模式，同一判据）
#
# CLI 模式（命令 step 0 / 人手跑）：
#   takeoff-gate.py --change-dir DIR [--session PATH]
#     stdout  批准证据一行：<ISO 时间> · <人类原话摘要 ≤40 字>
#     exit 0  批准成立
#     exit 3  无批准 / 批准早于计划最后改动；stderr 给 spec.html 绝对路径与补救方式
#
# hook 模式（无 --change-dir，从 stdin 收 PreToolUse JSON）：
#   1. tool_name 非 Workflow/Agent/Task            → 静默放行
#   2. tool_input 里找不到 openspec/changes/<name> → 静默放行（fail-open，不碰无关派发）
#   3. 定位不到 / 读不了转录                        → 静默放行（坏门禁不锁死派发）
#   4. 判定不成立                                   → permissionDecision=deny，reason 含 spec.html 与 /opsx-apply
#   任何异常一律放行，与 intent-gate.py 同规矩。
#
# 判据（design D7 / D8）：
#   人类消息 = type=="user" 且 isMeta 非真、isSidechain 非真、userType=="external"、内容是文本而非 tool_result，
#              且不含 <local-command-stdout> / <task-notification> / [Request interrupted by user] /
#              <bash-input> / <bash-stdout> / compact 续写注入等非人类形状。
#   批准     = 含 <command-name>/opsx-apply（或 /opsx-bulk-apply）；或整条 ≤ 40 字且含批准词。
#   新鲜度   = 该消息时间 ≥ 计划工件最大 mtime（proposal/design/tasks/slices.json/specs/**/spec.md）。
#   多条候选取最新一条。
# 只读，不改任何文件。兼容 Python 3.8+，只用标准库。
import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

EXIT_NO_APPROVAL = 3
DISPATCH_TOOLS = ("Workflow", "Agent", "Task")
PLAN_FILES = ("proposal.md", "design.md", "tasks.md", "slices.json")
SUMMARY_LIMIT = 40
WORD_LIMIT = 40

# 这些形状出现在 type=="user" 条目里，但不是人打的字，认成批准就等于伪造证据
NON_HUMAN_MARKERS = (
    "<local-command-stdout", "<task-notification", "[Request interrupted by user]",
    "<bash-input", "<bash-stdout", "This session is being continued",
)
APPLY_CMD_RE = re.compile(r"<command-name>\s*/?(opsx-apply|opsx-bulk-apply)\b", re.IGNORECASE)
APPROVE_WORD_RE = re.compile(r"批准|起飞|授权|approve|go ahead", re.IGNORECASE)
# 只吃路径字符：prompt 里常写成 「切片包：`template/openspec/changes/<name>`」，
# 宽前缀会把反引号 / 全角冒号 / 中文一起吞进来，拼出的路径必不存在 → 静默 fail-open
CHANGE_PATH_RE = re.compile(r"/?(?:[A-Za-z0-9._~-]+/)*openspec/changes/[A-Za-z0-9._-]+")


def parse_ts(value):
    """转录时间戳 → aware datetime；解析不出返回 None。"""
    if not value:
        return None
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        trimmed = re.sub(r"\.\d+", "", text)  # py3.8 的 fromisoformat 只吃 3/6 位小数
        try:
            dt = datetime.fromisoformat(trimmed)
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def human_text(row):
    """人类文本消息 → 正文；不是人打的返回 None。"""
    if not isinstance(row, dict) or row.get("type") != "user":
        return None
    if row.get("isMeta") or row.get("isSidechain"):
        return None
    if row.get("userType") not in (None, "external"):
        return None
    message = row.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "text":
                return None  # tool_result 等非文本块：整条不算人类消息
            parts.append(block.get("text") or "")
        text = "\n".join(parts)
    else:
        return None
    text = text.strip()
    if not text:
        return None
    for marker in NON_HUMAN_MARKERS:
        if marker in text:
            return None
    return text


def approval_of(text):
    """批准种类：'命令' / '口头'；不构成批准返回 None。"""
    if APPLY_CMD_RE.search(text):
        return "命令"
    if len(text) <= WORD_LIMIT and APPROVE_WORD_RE.search(text):
        return "口头"
    return None


def summarize(text):
    flat = " ".join(text.split())
    match = re.search(r"<command-name>\s*(/?[\w-]+)\s*</command-name>", flat)
    if match:
        args = re.search(r"<command-args>\s*(.*?)\s*</command-args>", flat)
        flat = (match.group(1) + (" " + args.group(1) if args and args.group(1) else "")).strip()
    return flat if len(flat) <= SUMMARY_LIMIT else flat[:SUMMARY_LIMIT - 1] + "…"


def latest_approval(path):
    """转录里最新一条人类批准 → (datetime, 摘要, 种类)；没有返回 None。"""
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    best = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue  # 坏行跳过，不因单行崩溃
        text = human_text(row)
        if not text:
            continue
        kind = approval_of(text)
        if not kind:
            continue
        when = parse_ts(row.get("timestamp"))
        if not when:
            continue
        if best is None or when > best[0]:
            best = (when, summarize(text), kind)
    return best


def plan_mtime(change_dir):
    """计划工件的最大 mtime（aware datetime）；一个都不存在返回 None。"""
    paths = [os.path.join(change_dir, name) for name in PLAN_FILES]
    paths += glob.glob(os.path.join(change_dir, "specs", "**", "spec.md"), recursive=True)
    stamps = [os.path.getmtime(p) for p in paths if os.path.isfile(p)]
    return datetime.fromtimestamp(max(stamps), timezone.utc) if stamps else None


def verdict(change_dir, session):
    """→ (ok, 证据行, 说明)。ok=False 时说明是给人/模型看的拒绝理由。"""
    spec_html = os.path.join(change_dir, "spec.html")
    plan_at = plan_mtime(change_dir)
    hint = ("请人类打开飞行计划 %s 亲自确认，然后由人类显式发出 `/opsx-apply %s`（本门禁只认转录里的人类消息，"
            "模型不得自证；人直接回一句「批准」/「起飞」同样成立）。"
            % (spec_html, os.path.basename(os.path.normpath(change_dir))))

    approval = latest_approval(session)
    if not approval:
        return False, "", "未找到人类批准证据（转录 %s 里没有人类发出的 /opsx-apply，也没有批准词）。%s" % (session, hint)

    when, quote, kind = approval
    if plan_at and when < plan_at:
        return False, "", ("批准已过期：人类批准于 %s（%s：%s），而计划工件在 %s 之后又改过——"
                           "计划变了必须重新批准。%s" % (iso(when), kind, quote, iso(plan_at), hint))
    return True, "%s · %s" % (iso(when), quote), ""


def locate_cli(session_arg):
    if session_arg:
        return session_arg if os.path.isfile(session_arg) else None
    sid = (os.environ.get("CLAUDE_CODE_SESSION_ID") or "").strip()
    return locate_by_sid(sid)


def locate_by_sid(sid):
    if not sid:
        return None
    hits = sorted(glob.glob(os.path.expanduser("~/.claude/projects/*/%s.jsonl" % sid)),
                  key=os.path.getmtime, reverse=True)
    return hits[0] if hits else None


def run_cli(args):
    change_dir = os.path.abspath(args.change_dir)
    if not os.path.isdir(change_dir):
        sys.stderr.write("takeoff-gate: change 目录不存在：%s\n" % change_dir)
        return EXIT_NO_APPROVAL
    session = locate_cli(args.session)
    if not session:
        sys.stderr.write(
            "takeoff-gate: 定位不到会话转录（--session 未给或文件不存在，且无 CLAUDE_CODE_SESSION_ID）；"
            "无法核对批准，请人类打开 %s 确认后显式 `/opsx-apply`。\n" % os.path.join(change_dir, "spec.html"))
        return EXIT_NO_APPROVAL
    ok, evidence, reason = verdict(change_dir, session)
    if not ok:
        sys.stderr.write("takeoff-gate: %s\n" % reason)
        return EXIT_NO_APPROVAL
    sys.stdout.write(evidence + "\n")
    return 0


def emit_deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}, ensure_ascii=False))


def find_change_dir(payload):
    blob = json.dumps(payload.get("tool_input"), ensure_ascii=False)
    match = CHANGE_PATH_RE.search(blob)
    if not match:
        return None
    raw = match.group(0)
    cwd = payload.get("cwd") or os.getcwd()
    if os.path.isabs(raw):
        candidates = [raw]
    else:  # prompt 常多带仓库名/上级目录：逐段剥掉最前面的片段重试
        parts = raw.split("/")
        head = parts.index("openspec")
        candidates = ["/".join(parts[i:]) for i in range(head + 1)]
    for cand in candidates:
        path = os.path.abspath(cand if os.path.isabs(cand) else os.path.join(cwd, cand))
        if os.path.isdir(path):
            return path
    return None


def locate_hook(payload):
    """payload 给了 transcript_path 就只认它（给了却读不了 = 放行，不去猜别的会话）；
    没给才依次退让到 session_id / 环境变量的 glob。"""
    if "transcript_path" in payload:
        path = payload.get("transcript_path")
        return path if path and os.path.isfile(path) else None
    return locate_by_sid((payload.get("session_id") or os.environ.get("CLAUDE_CODE_SESSION_ID") or "").strip())


def run_hook(raw):
    payload = json.loads(raw)
    if payload.get("tool_name") not in DISPATCH_TOOLS:
        return 0
    change_dir = find_change_dir(payload)
    if not change_dir:
        return 0  # 与飞行无关的派发：fail-open
    session = locate_hook(payload)
    if not session or not os.path.isfile(session):
        return 0  # 拿不到转录就不判：坏门禁不锁死派发
    ok, _evidence, reason = verdict(change_dir, session)
    if not ok:
        emit_deny("🚫 起飞门禁：这次派发指向 %s，但没有有效的人类批准。\n%s" % (change_dir, reason))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--change-dir" in argv:
        parser = argparse.ArgumentParser(description="校验飞行计划的人类批准证据")
        parser.add_argument("--change-dir", required=True, help="openspec/changes/<name> 目录")
        parser.add_argument("--session", help="主会话转录 .jsonl 路径")
        return run_cli(parser.parse_args(argv))
    try:
        return run_hook(sys.stdin.read())
    except Exception:
        return 0  # fail-open：门禁自身出问题绝不阻断派发


if __name__ == "__main__":
    sys.exit(main())
