#!/usr/bin/env python3
# takeoff-gate · 起飞前的人类批准门禁（两种模式，同一判据）
#
# CLI 模式（命令 step 0 / 人手跑）：
#   takeoff-gate.py --change-dir DIR
#     stdout  批准证据一行：<批准时间> · fp <指纹前 8 位> · ledger <账本 tip 前 8 位>
#     exit 0  批准成立
#     exit 3  未批准 / 计划已变 / 账本损坏 / 账本不可读 / 门禁故障；stderr 给 spec.html 绝对路径、批准带与插件安装指引
#
# hook 模式（无参数，从 stdin 收 PreToolUse JSON）：
#   1. 非起飞类派发（Workflow 带 args.changeDir / Agent·Task 派 slice-executor·integrator 之外）→ 静默放行
#   2. tool_input 里找不到 openspec/changes/<name> → 静默放行（不碰无关派发）
#   3. 判定不成立（含无账本、非 git 仓库）          → permissionDecision=deny
#   4. 门禁故障（git 不可执行、脚本异常）           → 放行（坏门禁不锁死派发）
#   载荷里的 transcript_path 不读。
#
# 判据（design D5）：账本 refs/flight/<change>/ledger 最新 approve 事件的 fp == plan_fp.plan_fingerprint(change_dir)。
#   tasks.md 勾选等执行记账不在指纹白名单内，不会让批准过期。
# 只读，不改任何文件。兼容 Python 3.8+，只用标准库。
import argparse
import json
import os
import re
import sys

import ledger
import plan_fp

EXIT_NO_APPROVAL = 3
DISPATCH_TOOLS = ("Workflow", "Agent", "Task")
# 起飞类 subagent：评审 / 探索类派发即使 prompt 提到 change 目录也不判定，否则铁律 4 的独立评审会被自家门禁拦死
TAKEOFF_AGENTS = ("slice-executor", "integrator")
INSTALL_HINT = ("未安装插件：claude plugin marketplace add akarizo/intent-driven-claude-code --scope project"
                " && claude plugin install flight@intent-driven -s project")
# 只吃路径字符：prompt 里常写成 「切片包：`template/openspec/changes/<name>`」，
# 宽前缀会把反引号 / 全角冒号 / 中文一起吞进来，拼出的路径必不存在 → 静默 fail-open
CHANGE_PATH_RE = re.compile(r"/?(?:[A-Za-z0-9._~-]+/)*openspec/changes/[A-Za-z0-9._-]+")


def remedy(change_dir):
    return ("请人类打开飞行计划 %s 确认，在 Claude Code 输入框上方的批准带按『批准起飞』。%s"
            % (os.path.join(change_dir, "spec.html"), INSTALL_HINT))


def verdict(change_dir):
    """→ (ok, 证据行, 说明)。判定结果走返回值；git 不可执行等门禁故障以异常抛出，由调用方决定放行或报错。"""
    hint = remedy(change_dir)
    try:
        fp = plan_fp.plan_fingerprint(change_dir)
    except plan_fp.PlanError as e:
        return False, "", "无计划工件，无法计算计划指纹（%s）。%s" % (e, hint)
    try:
        event, tip = ledger.latest_approval(change_dir)
    except ledger.LedgerInvalid as e:
        return False, "", "账本损坏：%s %s。%s" % (e.sha8, e.reason, hint)
    except ledger.LedgerUnreadable as e:
        return False, "", "账本不可读：%s。%s" % (e, hint)
    if event is None:
        return False, "", "未批准：账本里没有这个 change 的批准记录。%s" % hint
    if event["fp"] != fp:
        return False, "", ("计划已变，需重新批准（批准的是 %s，当前是 %s）。%s"
                           % (event["fp"][:8], fp[:8], hint))
    return True, "%s · fp %s · ledger %s" % (event["at"], fp[:8], tip[:8]), ""


def run_cli(args):
    change_dir = os.path.abspath(args.change_dir)
    try:
        ok, evidence, reason = verdict(change_dir)
    except Exception as e:  # 门禁故障（git 不可执行等）：CLI 不放行，说明原因
        sys.stderr.write("takeoff-gate: 门禁故障，无法判定批准：%s。%s\n"
                         % (str(e).replace("\n", " "), remedy(change_dir)))
        return EXIT_NO_APPROVAL
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
    ok, _evidence, reason = verdict(change_dir)  # 门禁故障抛异常 → main 放行
    if not ok:
        emit_deny("🚫 起飞门禁：这次派发指向 %s，但没有有效的人类批准。\n%s" % (change_dir, reason))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:  # 有参数一律走 CLI：等号写法也算，未知参数由 argparse 非 0 退出（fail-closed）
        parser = argparse.ArgumentParser(description="校验飞行计划的批准账本指纹")
        parser.add_argument("--change-dir", required=True, help="openspec/changes/<name> 目录")
        return run_cli(parser.parse_args(argv))
    try:
        return run_hook(sys.stdin.read())
    except Exception:
        return 0  # fail-open：门禁自身出问题绝不阻断派发


if __name__ == "__main__":
    sys.exit(main())
