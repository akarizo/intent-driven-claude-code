#!/usr/bin/env python3
# phase-gate · 阶段纪律门禁（scenario: phase-discipline#*）
#
# 只有 hook 模式，无 CLI 子命令：
#   python3 .claude/hooks/phase-gate.py   < PreToolUse JSON
#
# 判定（design：探索就是探索，飞行计划属 propose 收口）：
#   1. 非 PreToolUse 事件                              → 静默放行
#   2. 转录里取不到最后一条人类命令消息的 /opsx-<x>    → 静默放行（判不出阶段不锁死能力）
#   3. 阶段 != explore                                 → 静默放行（本门禁只约束 explore）
#   4. explore 阶段越界 → permissionDecision=deny：
#        Write/Edit 写 openspec/changes/*/ 下的 slices.json · tasks.md · slices/*.md
#        Bash 命令同时含 slice-gate.py 与 baseline
#      其余（proposal.md · design.md · specs/**）一律放行
#   任何异常一律放行，与 intent-gate.py · takeoff-gate.py 同规矩。
#
# ⚠ 转录是异步写入的（官方文档：hook 触发时可能还没落盘当前这轮消息），
#   所以只读"更早的、已落盘的"人类命令消息判阶段，不指望本轮消息已入转录。
# 只读，不改任何文件。兼容 Python 3.8+，只用标准库。
import json
import os
import re
import sys

EDIT_TOOLS = ("Write", "Edit")
# 人类消息形状识别与 takeoff-gate.py 同源：这些形状出现在 type=="user" 里，但不是人打的字
NON_HUMAN_MARKERS = (
    "<local-command-stdout", "<task-notification", "[Request interrupted by user]",
    "<bash-input", "<bash-stdout", "This session is being continued",
)
OPSX_CMD_RE = re.compile(r"<command-name>\s*/?opsx-([A-Za-z0-9-]+)\s*</command-name>")
# 飞行计划工件：change 目录下的 slices.json · tasks.md · slices/*.md
FLIGHT_PLAN_RE = re.compile(
    r"openspec/changes/[^/]+/(?:slices\.json|tasks\.md|slices/[^/]+\.md)$")


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


def current_phase(path):
    """转录里最后一条人类命令消息的 opsx 阶段名（如 explore）；取不到返回 None。"""
    if not path or not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    phase = None
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
        match = OPSX_CMD_RE.search(text)
        if match:
            phase = match.group(1).lower()
    return phase


def violation(payload):
    """explore 阶段的越界动作 → 拒绝理由；不越界返回 None。"""
    tool = payload.get("tool_name")
    inp = payload.get("tool_input")
    if not isinstance(inp, dict):
        return None
    if tool in EDIT_TOOLS:
        path = inp.get("file_path")
        if isinstance(path, str) and FLIGHT_PLAN_RE.search(path.replace(os.sep, "/")):
            return ("写飞行计划工件 %s。slices.json · tasks.md · slices/*.md 属 propose 收口的产物。" % path)
        return None
    if tool == "Bash":
        command = inp.get("command")
        if isinstance(command, str) and "slice-gate.py" in command and "baseline" in command:
            return "跑 slice-gate.py baseline。baseline 属 propose 收口，explore 阶段不采基线。"
    return None


def emit_deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}, ensure_ascii=False))


def run_hook(raw):
    payload = json.loads(raw)
    if payload.get("hook_event_name") != "PreToolUse":
        return 0
    if current_phase(payload.get("transcript_path")) != "explore":
        return 0
    reason = violation(payload)
    if reason:
        emit_deny("🚫 阶段门禁：当前阶段是 explore（转录里最后一条人类命令是 /opsx-explore），不能%s\n"
                  "explore 只捕捉思考（proposal.md · design.md · specs/**）；要落飞行计划请由人类显式发出 "
                  "`/opsx-propose <change>`，不要在同一轮继续。" % reason)
    return 0


def main():
    try:
        return run_hook(sys.stdin.read())
    except Exception:
        return 0  # fail-open：门禁自身出问题绝不阻断动作


if __name__ == "__main__":
    sys.exit(main())
