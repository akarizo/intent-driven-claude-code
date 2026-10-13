#!/usr/bin/env python3
# intent-driven 分级门禁 · 纯判定 judge(target_abs, cwd) -> (allow, reason)
#
# 作用：中级+ 任务必须先走 OpenSpec 工件工作流才能写源码；mini 任务需 /opsx-mini 留痕。
# 两种模式（同一个 judge）：
#   classic（无参数）：PreToolUse(Write|Edit) hook，从 stdin 读 Claude Code 的 JSON；拒绝时向 stdout 打
#            permissionDecision=deny，放行时无输出。任何异常一律放行（exit 0，无输出）——坏门禁绝不能锁死编辑能力。
#   check：  `intent-gate.py check --cwd <C> <PATH> [<PATH> …]`（flight 插件调用）。相对 PATH 相对 --cwd；
#            判完退出 0，stdout 恰为一行 {"allow": <全部放行>, "denied": [{"path": <绝对路径>, "reason": <原因>}]}；
#            判定中任何异常：stderr 写原因，退出 2。
# 定根：从目标文件所在目录向上找最近含 openspec/ 的目录（不越过 cwd；会话从主仓库根 cd 进 .worktrees/<change>/ 时，
#       change 只存在于 worktree 内，按 CLAUDE_PROJECT_DIR 定根会误拒）；找不到再回退 cwd（classic 为 CLAUDE_PROJECT_DIR）。
# 判定步骤（按序，任一命中即定）：
#   1. 根目录无 openspec/            → 放行（非 intent-driven 项目，门禁 no-op）
#   2. 目标在根外                    → 放行
#   3. 目标命中豁免名单              → 放行（*.md / openspec/** / .claude/** / docs/** / lockfile）
#   4. apply 上下文成立              → 放行
#   5. .mini-active 有效且覆盖目标    → 放行（已显式声明 mini）
#   6. 否则                          → 拒绝（回灌指引）
# apply 上下文收窄：取目标最近的已存在祖先目录，在其中求当前分支（git symbolic-ref --short -q HEAD，失败视为无分支）。
#   分支形如 worktree-<name> 或 flight/<name>/<…> → 只看 <root>/openspec/changes/<name>/tasks.md 有无未勾项；
#   其他分支（main、未按约定命名、detached、非 git）→ 任一 change 的 tasks.md 有未勾项即成立。
#   收窄只会多拒、不会多放。.openspec-slice 标记已退役，不参与判定。
import sys, os, json, re, fnmatch, subprocess
from datetime import datetime, timezone, timedelta

EXEMPT_DIR_PREFIX = ("openspec/", ".claude/", "docs/")
# 仅豁免: 文档 + 生成式 lockfile/清单。通用 json/yaml/toml/ini 不再整类豁免——
# 它们可能承载中级+ 改动(CI / k8s / IaC / schema / app 配置)，应受门禁；确属 mini 走 /opsx-mini。
# (openspec/ 与 .claude/ 内的配置仍按目录前缀豁免。)
EXEMPT_BASENAME = {".gitignore", ".mini-active", "LICENSE", "LICENSE.md", "LICENSE.txt",
                   "package-lock.json", "pnpm-lock.yaml", "go.sum"}
EXEMPT_EXT = {".md", ".mdx", ".markdown", ".txt", ".rst", ".lock"}
MINI_TTL = timedelta(hours=24)


def deny_reason(rel):
    return (
        "🚫 intent-driven 门禁：`{rel}` 是源码，但当前没有进行中的 OpenSpec change（apply 上下文），"
        "也没有覆盖它的 mini 声明。\n"
        "• 中级+（新 capability / 改公共契约·数据投影 / 跨模块 / 引入新抽象·依赖 / 架构决策）：\n"
        "  先 `/opsx-propose <name>` 生成工件，经 `/opsx-apply` 再写码。\n"
        "• 确属 mini（文档 / 依赖升级 / 配置值 / 单文件无行为变化的 hotfix）：\n"
        "  先 `/opsx-mini \"<理由>; 范围: {rel}\"` 留痕，门禁随后放行该文件。\n"
        "⚠ 原生 plan mode 的 markdown plan + ExitPlanMode 审批不满足中级+ 工作流要求。"
    ).format(rel=rel)


def scoped_deny_reason(rel, branch, name):
    return (
        "🚫 intent-driven 门禁：`{rel}` 是源码，所在分支 `{branch}` 只认 change {name}；"
        "change {name} 没有未完成的任务（tasks.md 不存在或已全部勾选）：先补工件；"
        "收口后的修改须经用户授权在 tasks.md 追加任务。"
    ).format(rel=rel, branch=branch, name=name)


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


def tasks_unchecked(tasks):
    if not os.path.isfile(tasks):
        return False
    try:
        with open(tasks, "r", encoding="utf-8") as f:
            return has_unchecked_task(f.read())
    except OSError:
        return False


def has_apply_context(root):
    changes = os.path.join(root, "openspec", "changes")
    if not os.path.isdir(changes):
        return False
    try:
        names = os.listdir(changes)
    except OSError:
        return False
    return any(tasks_unchecked(os.path.join(changes, n, "tasks.md")) for n in names if n != "archive")


def current_branch(file_abs):
    """目标最近的已存在祖先目录所在仓库的当前分支；非 git / detached / git 不可用 → None。"""
    d = os.path.dirname(file_abs)
    while not os.path.isdir(d):
        d = os.path.dirname(d)
    try:
        p = subprocess.run(["git", "-C", d, "symbolic-ref", "--short", "-q", "HEAD"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    return p.stdout.strip() or None


def change_of_branch(branch):
    """worktree-<name> / flight/<name>/<…> → name；其他 → None。"""
    if not branch:
        return None
    if branch.startswith("worktree-") and len(branch) > len("worktree-"):
        return branch[len("worktree-"):]
    parts = branch.split("/")
    if len(parts) >= 3 and parts[0] == "flight" and parts[1]:
        return parts[1]
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


def judge(target_abs, cwd):
    """纯判定：返回 (allow, reason)；放行时 reason 为空串。"""
    project_dir = os.path.realpath(cwd)
    file_abs = os.path.realpath(target_abs if os.path.isabs(target_abs) else os.path.join(project_dir, target_abs))

    root = resolve_root(file_abs, project_dir)
    if not os.path.isdir(os.path.join(root, "openspec")):
        return True, ""
    rel_posix = to_posix(os.path.relpath(file_abs, root))
    if rel_posix.startswith("../") or rel_posix == "..":
        return True, ""  # 项目外的文件不归本门禁管
    if is_exempt(rel_posix):
        return True, ""

    branch = current_branch(file_abs)
    name = change_of_branch(branch)
    if name is None:
        if has_apply_context(root):
            return True, ""
    elif tasks_unchecked(os.path.join(root, "openspec", "changes", name, "tasks.md")):
        return True, ""
    if mini_allows(root, rel_posix):
        return True, ""
    if name is None:
        return False, deny_reason(rel_posix)
    return False, scoped_deny_reason(rel_posix, branch, name)


def classic():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (ValueError, OSError):
        return
    if not isinstance(data, dict):
        return
    tool_input = data.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not file_path:
        return
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    ok, reason = judge(os.path.join(os.path.realpath(project_dir), file_path), project_dir)
    if ok:
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))


def check(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="intent-gate.py check")
    ap.add_argument("--cwd", required=True)
    ap.add_argument("paths", nargs="+")
    a = ap.parse_args(argv)
    cwd = os.path.realpath(a.cwd)
    denied = []
    for p in a.paths:
        target = os.path.realpath(os.path.join(cwd, p))
        ok, reason = judge(target, cwd)
        if not ok:
            denied.append({"path": target, "reason": reason})
    print(json.dumps({"allow": not denied, "denied": denied}, ensure_ascii=False))


if __name__ == "__main__":
    if sys.argv[1:2] == ["check"]:
        try:
            check(sys.argv[2:])
        except Exception as e:
            print("intent-gate check 判定失败：{}: {}".format(type(e).__name__, e), file=sys.stderr)
            sys.exit(2)
        sys.exit(0)
    try:
        classic()
    except Exception:
        # 任何未预期异常 → fail-open
        pass
    sys.exit(0)
