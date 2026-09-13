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
#   1. 非起飞类派发（Workflow 带 args.changeDir / Agent·Task 派 slice-executor·integrator 之外）→ 静默放行
#   2. tool_input 里找不到 openspec/changes/<name> → 静默放行（fail-open，不碰无关派发）
#   3. 定位不到 / 读不了转录                        → 静默放行（坏门禁不锁死派发）
#   4. 判定不成立                                   → permissionDecision=deny，reason 含 spec.html 与 /opsx-apply
#   任何异常一律放行，与 intent-gate.py 同规矩。
#
# 判据（design D7 / D8 + 两段式握手）：
#   人类消息 = type=="user" 且 isMeta 非真、isSidechain 非真、userType=="external"、内容是文本而非 tool_result，
#              且不含 <local-command-stdout> / <task-notification> / [Request interrupted by user] /
#              <bash-input> / <bash-stdout> / compact 续写注入等非人类形状。
#   发起     = 含 <command-name>/opsx-apply（或 /opsx-bulk-apply）；或含 change 名；或含 openspec/changes/<name>
#              / .worktrees/<name> 路径片段。发起只是发起，不构成批准。
#   确认     = 整条 ≤ 40 字 · 含批准词 · 不含 change 名与路径片段 · 批准词邻近窗口（±6 字）无制止词
#              （先判发起再判确认；「先别起飞」这类制止句既非发起也非确认 → 停）。
#   批准成立 = 转录里最后一条人类消息是确认，且该确认晚于发起、晚于计划工件最大 mtime。
#   新鲜度   = 计划工件 = proposal/design/slices.json/specs/**/spec.md。
#              tasks.md 不算计划工件：收口勾选 `- [x]` 是执行记账，勾一下就让批准过期会把自家收口拦死。
#   停下时的输出（CLI stderr 与 hook reason 同源）：当前主模型别名（判不出也停，fail-closed）· 切片/wave 规模
#              · worktree 与 spec.html 绝对路径 · 补救指引（回一句「起飞」；换模型先 /model）。
# 只读，不改任何文件。兼容 Python 3.8+，只用标准库。
import argparse
import glob
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timezone

EXIT_NO_APPROVAL = 3
DISPATCH_TOOLS = ("Workflow", "Agent", "Task")
# 起飞类 subagent：评审 / 探索类派发即使 prompt 提到 change 目录也不判定，否则铁律 4 的独立评审会被自家门禁拦死
TAKEOFF_AGENTS = ("slice-executor", "integrator")
PLAN_FILES = ("proposal.md", "design.md", "slices.json")
SUMMARY_LIMIT = 40
WORD_LIMIT = 40

# 这些形状出现在 type=="user" 条目里，但不是人打的字，认成批准就等于伪造证据
NON_HUMAN_MARKERS = (
    "<local-command-stdout", "<task-notification", "[Request interrupted by user]",
    "<bash-input", "<bash-stdout", "This session is being continued",
)
APPLY_CMD_RE = re.compile(r"<command-name>\s*/?(opsx-apply|opsx-bulk-apply)\b", re.IGNORECASE)
APPROVE_WORD_RE = re.compile(r"批准|起飞|授权|approve|go ahead", re.IGNORECASE)
# 制止词：出现在批准词邻近窗口里 → 这条是「别飞」而不是「飞」，既非发起也非确认
NEGATION_RE = re.compile(r"别|不要|不能|暂缓|先等|还没|再等|等等|don't|do not|not yet|hold", re.IGNORECASE)
NEGATION_WINDOW = 6
# 只吃路径字符：prompt 里常写成 「切片包：`template/openspec/changes/<name>`」，
# 宽前缀会把反引号 / 全角冒号 / 中文一起吞进来，拼出的路径必不存在 → 静默 fail-open
CHANGE_PATH_RE = re.compile(r"/?(?:[A-Za-z0-9._~-]+/)*openspec/changes/[A-Za-z0-9._-]+")
# 起飞发起里常见的 worktree 路径片段：`去 '/abs/repo/.worktrees/<name>' apply <name>, 授权你git提交…`
WORKTREE_RE = re.compile(r"\.worktrees?/[A-Za-z0-9._-]+")


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


def vetoed(text):
    """批准词前后各 NEGATION_WINDOW 个字里出现制止词 → True。
    确认是唯一的批准通路，「先别起飞，等我看完」被读成批准就等于人说停、门禁放飞。"""
    for m in APPROVE_WORD_RE.finditer(text):
        window = text[max(0, m.start() - NEGATION_WINDOW):m.end() + NEGATION_WINDOW]
        if NEGATION_RE.search(window):
            return True
    return False


def classify(text, change_name):
    """一条人类消息 → '发起' / '确认' / None。
    先判发起：含 change 名或 worktree 路径的长指令即使带「授权」这类词也是发起，不是批准。"""
    if APPLY_CMD_RE.search(text):
        return "发起"
    if change_name and change_name.lower() in text.lower():
        return "发起"
    if CHANGE_PATH_RE.search(text) or WORKTREE_RE.search(text):
        return "发起"
    if len(text) <= WORD_LIMIT and APPROVE_WORD_RE.search(text):
        return None if vetoed(text) else "确认"
    return None


def summarize(text):
    flat = " ".join(text.split())
    match = re.search(r"<command-name>\s*(/?[\w-]+)\s*</command-name>", flat)
    if match:
        args = re.search(r"<command-args>\s*(.*?)\s*</command-args>", flat)
        flat = (match.group(1) + (" " + args.group(1) if args and args.group(1) else "")).strip()
    return flat if len(flat) <= SUMMARY_LIMIT else flat[:SUMMARY_LIMIT - 1] + "…"


def scan_human(path, change_name):
    """→ (最后一条人类消息 (datetime, 摘要, 类别)，最新一条发起的 datetime)；两者都可能是 None。"""
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    last = None       # (when, idx, 摘要, 类别)
    initiated = None
    for idx, line in enumerate(lines):
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
        when = parse_ts(row.get("timestamp"))
        if not when:
            continue
        kind = classify(text, change_name)
        if kind == "发起" and (initiated is None or when > initiated):
            initiated = when
        if last is None or (when, idx) > (last[0], last[1]):
            last = (when, idx, summarize(text), kind)
    return (None if last is None else (last[0], last[2], last[3])), initiated


def plan_mtime(change_dir):
    """计划工件的最大 mtime（aware datetime）；一个都不存在返回 None。"""
    paths = [os.path.join(change_dir, name) for name in PLAN_FILES]
    paths += glob.glob(os.path.join(change_dir, "specs", "**", "spec.md"), recursive=True)
    stamps = [os.path.getmtime(p) for p in paths if os.path.isfile(p)]
    return datetime.fromtimestamp(max(stamps), timezone.utc) if stamps else None


_SESSION_MODEL = []


def session_model_module():
    """按路径加载同目录的 session-model.py（文件名含连字符）；加载不了返回 None。"""
    if not _SESSION_MODEL:
        mod = None
        try:
            path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "session-model.py")
            spec = importlib.util.spec_from_file_location("takeoff_session_model", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        except Exception:
            mod = None
        _SESSION_MODEL.append(mod)
    return _SESSION_MODEL[0]


def model_line(session):
    """停下信息里的主模型一行；判不出也只是点名原因——停下本身不依赖它（fail-closed）。"""
    unresolved = "executor / reviewer 无法按主模型路由，判不出主模型就不许起飞。"
    mod = session_model_module()
    if mod is None:
        return "当前主模型：判不出——session-model.py 不可用。%s" % unresolved
    try:
        model = mod.last_main_model(session)
    except BaseException:  # last_main_model 读不了文件时会 sys.exit
        model = None
    if not model:
        return "当前主模型：判不出——转录 %s 里没有主循环 assistant 条目。%s" % (session, unresolved)
    alias = mod.alias_of(model)
    if not alias:
        return "当前主模型：判不出——模型 id %s 不在已知别名表内。%s" % (model, unresolved)
    return "当前主模型：%s（模型 id %s）——executor / reviewer 都会用它。" % (alias, model)


def scale_line(change_dir):
    """规模一行：切片数 · wave 数（按 slices.json 的 deps 拓扑分层）；读不出返回 None，不因此失败。"""
    try:
        with open(os.path.join(change_dir, "slices.json"), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        deps = {s["id"]: list(s.get("deps") or []) for s in data["slices"]}
    except Exception:
        return None
    if not deps:
        return None
    layer = dict.fromkeys(deps, 0)
    for _ in range(len(deps)):  # 迭代次数有界：即使 deps 有环也不会空转
        for sid, ups in deps.items():
            heights = [layer[d] for d in ups if d in layer]
            layer[sid] = max(heights) + 1 if heights else 0
    return "规模：%d 个切片 · %d 个 wave。" % (len(deps), max(layer.values()) + 1)


def worktree_of(change_dir):
    """change 目录向上找含 .git 的目录；找不到就退到 openspec 的上一级。"""
    cur = os.path.abspath(change_dir)
    fallback = cur
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        if os.path.basename(cur) == "openspec":
            fallback = os.path.dirname(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            return fallback
        cur = parent


def block_message(change_dir, session, head):
    """停下时一次给全人做判断所需的信息（CLI stderr 与 hook reason 同一段文本）。"""
    name = os.path.basename(os.path.normpath(change_dir))
    parts = [head, model_line(session)]
    scale = scale_line(change_dir)
    if scale:
        parts.append(scale)
    parts.append("worktree：%s · 飞行计划：%s" % (worktree_of(change_dir), os.path.join(change_dir, "spec.html")))
    parts.append("确认无误就回一句「起飞」（本门禁只认转录里的人类消息，模型不得自证）；要换模型先 /model 切换再回；"
                 "尚未发起过就由人类显式发出 `/opsx-apply %s`。" % name)
    return "\n".join(parts)


def verdict(change_dir, session):
    """→ (ok, 证据行, 说明)。ok=False 时说明是给人/模型看的停下理由。"""
    change_name = os.path.basename(os.path.normpath(change_dir))
    plan_at = plan_mtime(change_dir)
    last, initiated_at = scan_human(session, change_name)

    if last is None:
        return False, "", block_message(change_dir, session,
                                        "未找到人类消息：转录 %s 里没有可用的人类发言。" % session)
    when, quote, kind = last
    if kind == "发起":
        return False, "", block_message(change_dir, session,
                                        "最后一条人类消息是起飞发起（%s：%s）——发起不等于批准，"
                                        "起飞是两段式握手，还缺人类的一句短确认。" % (iso(when), quote))
    if kind != "确认":
        return False, "", block_message(change_dir, session,
                                        "未找到人类批准证据：最后一条人类消息（%s：%s）"
                                        "既不是起飞发起也不是批准确认。" % (iso(when), quote))
    if initiated_at is None or when < initiated_at:
        return False, "", block_message(change_dir, session,
                                        "这条确认（%s：%s）不是对本次发起的回应——确认不继承历史，"
                                        "请在发起之后重新确认。" % (iso(when), quote))
    if plan_at and when < plan_at:
        return False, "", block_message(change_dir, session,
                                        "批准已过期：人类确认于 %s（%s），而计划工件在 %s 之后又改过——"
                                        "计划变了必须重新批准。" % (iso(when), quote, iso(plan_at)))
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


def is_takeoff_dispatch(payload):
    """只有起飞类派发才判定：Workflow 带 args.changeDir，或 Agent/Task 派 slice-executor / integrator。
    强制点仍然完整——一次飞行的第一个动作必是这两者之一；评审 / 探索 / 通用派发一律放行。"""
    tool = payload.get("tool_name")
    if tool not in DISPATCH_TOOLS:
        return False
    inp = payload.get("tool_input") or {}
    if tool == "Workflow":
        args = inp.get("args")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        return bool(isinstance(args, dict) and args.get("changeDir"))
    return (inp.get("subagent_type") or "") in TAKEOFF_AGENTS


def run_hook(raw):
    payload = json.loads(raw)
    if not is_takeoff_dispatch(payload):
        return 0  # 非起飞类派发：fail-open
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
    if argv:  # 有参数一律走 CLI：等号写法也算，未知参数由 argparse 非 0 退出（fail-closed）
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
