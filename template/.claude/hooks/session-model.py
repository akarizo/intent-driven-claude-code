#!/usr/bin/env python3
# session-model · 机械判定「当前会话主模型」（起飞路由与评审派发的 <main> 来源）
#
# 用法：session-model.py [--session PATH] [--json]
#   stdout  别名之一：opus | sonnet | haiku | fable（--json：{"alias","model","session","source"}）
#   exit 0  判定成功
#   exit 3  判定失败，stderr 一行点名原因（绝不给默认值）
#
# 定位顺序：--session > CLAUDE_CODE_SESSION_ID glob ~/.claude/projects/*/<sid>.jsonl（不按 cwd 推 slug）。
# 取值：从转录末尾向前找第一条 type=="assistant" 且 isSidechain 非真、message.model 非空且非 <synthetic> 的条目。
# 只读，不改任何文件。兼容 Python 3.8+，只用标准库。
import argparse
import glob
import json
import os
import sys

EXIT_UNRESOLVED = 3
SYNTHETIC = "<synthetic>"
ALIASES = ("opus", "sonnet", "haiku", "fable")


def alias_of(model_id):
    """模型 id → 别名；认不出返回 None（`[1m]` 等变体按子串自然归基座）。"""
    if not model_id:
        return None
    low = str(model_id).lower()
    for alias in ALIASES:
        if alias in low:
            return alias
    return None


def fail(msg):
    sys.stderr.write("session-model: %s\n" % msg)
    sys.exit(EXIT_UNRESOLVED)


def locate(session_arg):
    """返回 (转录路径, 判定来源)。定位不出即失败退出。"""
    if session_arg:
        if not os.path.isfile(session_arg):
            fail("转录文件不存在：%s" % session_arg)
        return session_arg, "--session"
    sid = (os.environ.get("CLAUDE_CODE_SESSION_ID") or "").strip()
    if not sid:
        fail("既无 --session 也无 CLAUDE_CODE_SESSION_ID，无法定位会话转录")
    pattern = os.path.expanduser("~/.claude/projects/*/%s.jsonl" % sid)
    hits = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    if not hits:
        fail("按 CLAUDE_CODE_SESSION_ID=%s 找不到转录：%s" % (sid, pattern))
    return hits[0], "env:CLAUDE_CODE_SESSION_ID"


def last_main_model(path):
    """从末尾向前找最后一条主循环 assistant 的 model；找不到返回 None。"""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError as exc:
        fail("转录读取失败：%s（%s）" % (path, exc))
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue  # 坏行跳过，不因单行崩溃
        if not isinstance(row, dict) or row.get("type") != "assistant":
            continue
        if row.get("isSidechain"):
            continue  # 子 agent 条目不算主循环
        message = row.get("message")
        model = message.get("model") if isinstance(message, dict) else None
        if not model or model == SYNTHETIC:
            continue
        return model
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description="判定当前会话主模型别名")
    parser.add_argument("--session", help="主会话转录 .jsonl 路径")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出 JSON 明细")
    args = parser.parse_args(argv)

    path, source = locate(args.session)
    model = last_main_model(path)
    if not model:
        fail("转录里没有可用的主循环 assistant 条目：%s" % path)
    alias = alias_of(model)
    if not alias:
        fail("无法映射的模型 id：%s（来自 %s）" % (model, path))

    if args.as_json:
        sys.stdout.write(json.dumps(
            {"alias": alias, "model": model, "session": path, "source": source},
            ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(alias + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
