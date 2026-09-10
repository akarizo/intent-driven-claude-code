#!/usr/bin/env python3
# intent-driven 分级门禁 · PreToolUse(Write|Edit)
#
# 作用：中级+ 任务必须先走 OpenSpec 工件工作流才能写源码；mini 任务需 /opsx-mini 留痕；
#       切片进行中（存在 .openspec-slice 标记）只允许写该切片 owns 内的文件。
# 定根：从目标文件所在目录向上找最近含 openspec/ 的目录（会话从主仓库根 cd 进 .worktrees/<change>/ 时，
#       change 只存在于 worktree 内，按 CLAUDE_PROJECT_DIR 定根会误拒）；找不到再回退 CLAUDE_PROJECT_DIR。
# 决策树（任一命中即放行；否则 DENY）：
#   1. 根目录无 openspec/            → ALLOW（非 intent-driven 项目，门禁 no-op）
#   2. 目标命中豁免名单            → ALLOW（*.md / openspec/** / .claude/** / docs/** / lockfile）
#   2.5 根目录有 .openspec-slice    → 目标不在该切片 owns 内 → DENY（所有权）；在 → ALLOW
#   3. 存在 live change 的 tasks.md → ALLOW（已进入 apply 上下文）
#   4. .mini-active 有效且覆盖目标  → ALLOW（已显式声明 mini）
#   5. 否则                        → DENY（回灌指引）
#
# 契约：从 stdin 读 Claude Code 的 PreToolUse JSON；DENY 时向 stdout 打 permissionDecision=deny。
# fail-open：本脚本任何异常一律放行（exit 0，无输出）——坏门禁绝不能锁死编辑能力。
import sys, os, json, re, fnmatch
from datetime import datetime, timezone, timedelta

EXEMPT_DIR_PREFIX = ("openspec/", ".claude/", "docs/")
# 仅豁免: 文档 + 生成式 lockfile/清单。通用 json/yaml/toml/ini 不再整类豁免——
# 它们可能承载中级+ 改动(CI / k8s / IaC / schema / app 配置)，应受门禁；确属 mini 走 /opsx-mini。
# (openspec/ 与 .claude/ 内的配置仍按目录前缀豁免。)
EXEMPT_BASENAME = {".gitignore", ".mini-active", ".openspec-slice", "LICENSE", "LICENSE.md", "LICENSE.txt",
                   "package-lock.json", "pnpm-lock.yaml", "go.sum"}
EXEMPT_EXT = {".md", ".mdx", ".markdown", ".txt", ".rst", ".lock"}
MINI_TTL = timedelta(hours=24)
SLICE_MARKER = ".openspec-slice"


def allow():
    sys.exit(0)


def _emit_deny(reason):
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


def deny(rel):
    reason = (
        "🚫 intent-driven 门禁：`{rel}` 是源码，但当前没有进行中的 OpenSpec change（apply 上下文），"
        "也没有覆盖它的 mini 声明。\n"
        "• 中级+（新 capability / 改公共契约·数据投影 / 跨模块 / 引入新抽象·依赖 / 架构决策）：\n"
        "  先 `/opsx-propose <name>` 生成工件，经 `/opsx-apply` 再写码。\n"
        "• 确属 mini（文档 / 依赖升级 / 配置值 / 单文件无行为变化的 hotfix）：\n"
        "  先 `/opsx-mini \"<理由>; 范围: {rel}\"` 留痕，门禁随后放行该文件。\n"
        "⚠ 原生 plan mode 的 markdown plan + ExitPlanMode 审批不满足中级+ 工作流要求。"
    ).format(rel=rel)
    _emit_deny(reason)


def deny_ownership(rel, slice_id, owns):
    reason = (
        "🚫 切片所有权：切片 `{s}` 进行中，`{rel}` 不在它的 owns 内（{owns}）。\n"
        "不要绕过：把该路径写进本切片门禁 JSON 的 failed（`G6 ownership: {rel}`）交回规划，"
        "或由规划器把它加入 owns 后重跑本切片。"
    ).format(s=slice_id, rel=rel, owns=", ".join(owns[:6]) + ("…" if len(owns) > 6 else ""))
    _emit_deny(reason)


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


def resolve_root(file_abs, project_dir):
    """从目标文件向上找最近含 openspec/ 的目录（不越过 project_dir）；找不到回退 project_dir。"""
    d = os.path.dirname(file_abs)
    while d.startswith(project_dir):
        if os.path.isdir(os.path.join(d, "openspec")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return project_dir


_UNCHECKED = re.compile(r"^\s*[-*+]\s+\[ \]", re.M)


def has_unchecked_task(text):
    # tasks.md 仍有未勾选 '- [ ]' → 实现进行中；全勾选(应归档)或无 checkbox 则不算 apply 上下文，
    # 避免「一个没归档的旧 change 永久放行后续所有源码写入」的强制力衰减。
    return bool(_UNCHECKED.search(text))


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
        tasks = os.path.join(changes, name, "tasks.md")
        if not os.path.isfile(tasks):
            continue
        try:
            with open(tasks, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            continue
        if has_unchecked_task(text):
            return True
    return False


def glob_match(path, pattern):
    if path == pattern or fnmatch.fnmatchcase(path, pattern):
        return True
    return pattern.endswith("/**") and path.startswith(pattern[:-3] + "/")


def slice_ownership(root, rel_posix):
    """返回 None（无切片进行中 / 读不到）或 (slice_id, owns, owned:bool)。"""
    marker = os.path.join(root, SLICE_MARKER)
    if not os.path.isfile(marker):
        return None
    try:
        with open(marker, "r", encoding="utf-8") as f:
            data = json.load(f)
        change_dir = data.get("change_dir") or ""
        if not os.path.isabs(change_dir):
            change_dir = os.path.join(root, change_dir)
        with open(os.path.join(change_dir, "slices.json"), "r", encoding="utf-8") as f:
            plan = json.load(f)
    except (OSError, ValueError):
        return None
    slice_id = data.get("slice")
    for s in plan.get("slices") or []:
        if s.get("id") == slice_id:
            owns = list(s.get("owns") or [])
            change_rel = to_posix(os.path.relpath(change_dir, root))
            owned = rel_posix.startswith(change_rel.rstrip("/") + "/") or any(glob_match(rel_posix, o) for o in owns)
            return slice_id, owns, owned
    return None


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

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    project_dir = os.path.realpath(project_dir)

    file_abs = file_path if os.path.isabs(file_path) else os.path.join(project_dir, file_path)
    file_abs = os.path.realpath(file_abs)

    root = resolve_root(file_abs, project_dir)
    if not os.path.isdir(os.path.join(root, "openspec")):
        allow()
        return

    rel = os.path.relpath(file_abs, root)
    rel_posix = to_posix(rel)
    if rel_posix.startswith("../") or rel_posix == "..":
        allow()  # 项目外的文件不归本门禁管
        return

    if is_exempt(rel_posix):
        allow()
        return
    ownership = slice_ownership(root, rel_posix)
    if ownership is not None:
        slice_id, owns, owned = ownership
        if owned:
            allow()
        deny_ownership(rel_posix, slice_id, owns)
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
