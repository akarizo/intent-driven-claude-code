#!/usr/bin/env python3
# intent-driven 分级门禁 · PreToolUse(Write|Edit)
#
# 作用：中级+ 任务必须先走 OpenSpec 5 工件工作流才能写源码；mini 任务需 /opsx-mini 留痕。
# 决策树（任一命中即放行；否则 DENY）：
#   1. 项目无 openspec/            → ALLOW（非 intent-driven 项目，门禁 no-op）
#   2. 目标命中豁免名单            → ALLOW（*.md / openspec/** / .claude/** / docs/** / 配置）
#   3. 存在 live change 的 tasks.md → ALLOW（已进入 apply 上下文）
#   4. .mini-active 有效且覆盖目标  → ALLOW（已显式声明 mini）
#   5. 否则                        → DENY（回灌指引）
#
# 契约：从 stdin 读 Claude Code 的 PreToolUse JSON；DENY 时向 stdout 打 permissionDecision=deny。
# fail-open：本脚本任何异常一律放行（exit 0，无输出）——坏门禁绝不能锁死编辑能力。
import sys, os, json, fnmatch
from datetime import datetime, timezone, timedelta

EXEMPT_DIR_PREFIX = ("openspec/", ".claude/", "docs/")
EXEMPT_BASENAME = {".gitignore", ".mini-active", "LICENSE", "LICENSE.md", "LICENSE.txt"}
EXEMPT_EXT = {".md", ".mdx", ".markdown", ".txt", ".rst",
              ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".lock"}
MINI_TTL = timedelta(hours=24)


def allow():
    sys.exit(0)


def deny(rel):
    reason = (
        "🚫 intent-driven 门禁：`{rel}` 是源码，但当前没有进行中的 OpenSpec change（apply 上下文），"
        "也没有覆盖它的 mini 声明。\n"
        "• 中级+（新 capability / 改公共契约·数据投影 / 跨模块 / 引入新抽象·依赖 / 架构决策）：\n"
        "  先 `/opsx-propose <name>` 生成 proposal→specs→design→adr→tasks 五工件，经 `/opsx-apply` 再写码。\n"
        "• 确属 mini（文档 / 依赖升级 / 配置值 / 单文件无行为变化的 hotfix）：\n"
        "  先 `/opsx-mini \"<理由>; 范围: {rel}\"` 留痕，门禁随后放行该文件。\n"
        "⚠ 原生 plan mode 的 markdown plan + ExitPlanMode 审批不满足中级+ 工作流要求。"
    ).format(rel=rel)
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


def to_posix(rel):
    return rel.replace(os.sep, "/")


def is_exempt(rel_posix):
    if rel_posix.startswith(EXEMPT_DIR_PREFIX):
        return True
    base = rel_posix.rsplit("/", 1)[-1]
    if base in EXEMPT_BASENAME:
        return True
    _, ext = os.path.splitext(base)
    return ext.lower() in EXEMPT_EXT


def has_apply_context(root):
    changes = os.path.join(root, "openspec", "changes")
    if not os.path.isdir(changes):
        return False
    try:
        names = os.listdir(changes)
    except OSError:
        return False
    for name in names:
        if name == "archive":
            continue
        d = os.path.join(changes, name)
        if os.path.isdir(d) and os.path.isfile(os.path.join(d, "tasks.md")):
            return True
    return False


def parse_marker(text):
    reason = created = None
    scope = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("- "):
            scope.append(s[2:].strip().strip("\"'"))
            continue
        low = s.lower()
        if low.startswith("reason:"):
            reason = s.split(":", 1)[1].strip()
        elif low.startswith("created:"):
            created = s.split(":", 1)[1].strip()
        elif low.startswith("scope:"):
            rest = s.split(":", 1)[1].strip()
            if rest.startswith("[") and rest.endswith("]"):
                scope += [x.strip().strip("\"'") for x in rest[1:-1].split(",") if x.strip()]
    return {"reason": reason, "created": created, "scope": scope}


def marker_expired(created):
    # 解析失败或缺失 → 视为过期（不授予旁路）
    if not created:
        return True
    s = created.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return True
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt) > MINI_TTL


def mini_allows(root, rel_posix):
    marker = os.path.join(root, "openspec", ".mini-active")
    if not os.path.isfile(marker):
        return False
    try:
        with open(marker, "r", encoding="utf-8") as f:
            data = parse_marker(f.read())
    except OSError:
        return False
    if marker_expired(data.get("created")):
        return False
    for g in data.get("scope", []):
        if not g:
            continue
        if rel_posix == g or fnmatch.fnmatch(rel_posix, g):
            return True
        if rel_posix.startswith(g.rstrip("/") + "/"):
            return True
    return False


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (ValueError, OSError):
        allow()
        return

    tool_input = data.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not file_path:
        allow()
        return

    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    root = os.path.realpath(root)

    if not os.path.isdir(os.path.join(root, "openspec")):
        allow()
        return

    file_abs = file_path if os.path.isabs(file_path) else os.path.join(root, file_path)
    file_abs = os.path.realpath(file_abs)

    rel = os.path.relpath(file_abs, root)
    rel_posix = to_posix(rel)
    if rel_posix.startswith("../") or rel_posix == "..":
        allow()  # 项目外的文件不归本门禁管
        return

    if is_exempt(rel_posix):
        allow()
        return
    if has_apply_context(root):
        allow()
        return
    if mini_allows(root, rel_posix):
        allow()
        return

    deny(rel_posix)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # 任何未预期异常 → fail-open
        sys.exit(0)
