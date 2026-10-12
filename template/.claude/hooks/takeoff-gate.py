#!/usr/bin/env python3
# takeoff-gate · 起飞前的人类批准门禁
#
# CLI 模式（命令 step 0 / 插件起飞守卫 / 人手跑）：
#   takeoff-gate.py --change-dir DIR
#     stdout  批准证据一行：<批准时间> · fp <指纹前 8 位> · ledger <账本 tip 前 8 位>
#     exit 0  批准成立
#     exit 3  未批准 / 计划已变 / 账本损坏 / 账本不可读 / 门禁故障；stderr 给 spec.html 绝对路径、批准带与插件安装指引
#
# 不带参数：hook 模式已退役，空转兼容仍注册它的 settings（读掉 stdin，不输出，退出 0）。
#
# 判据（design D5）：账本 refs/flight/<change>/ledger 最新 approve 事件的 fp == plan_fp.plan_fingerprint(change_dir)。
#   tasks.md 勾选等执行记账不在指纹白名单内，不会让批准过期。
# 只读，不改任何文件。兼容 Python 3.8+，只用标准库。
import argparse
import os
import sys

import ledger
import plan_fp

EXIT_NO_APPROVAL = 3
INSTALL_HINT = ("未安装插件：claude plugin marketplace add akarizo/intent-driven-claude-code --scope project"
                " && claude plugin install flight@intent-driven -s project")


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


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv:  # 有参数一律走 CLI：等号写法也算，未知参数由 argparse 非 0 退出（fail-closed）
        parser = argparse.ArgumentParser(description="校验飞行计划的批准账本指纹")
        parser.add_argument("--change-dir", required=True, help="openspec/changes/<name> 目录")
        return run_cli(parser.parse_args(argv))
    try:  # hook 模式已退役，空转兼容仍注册它的 settings
        sys.stdin.read()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
