#!/usr/bin/env python3
"""claudemd-lint —— CLAUDE.md 层级规范的机械门禁。

把 `.claude/claudemd-standard.md` 里能被判定的条款变成拦截，不靠人肉自觉：

  ERROR（exit 1）
    · 字节预算超线            standard §12
    · 单行 > 200 字节          standard §12
    · 反引号内路径不存在（悬空指针）  standard §8
    · 子项目 / 叶子文件用裸 `@` 急切导入 · 根文件裸 `@` 导入别的 CLAUDE.md   standard §12

  WARN（不失败）
    · 反引号内的 `@path` —— 官方 import 解析**跳过 code span**，故它是死记号，
      不会自动加载；却极易被读成「已自动加载」而误判成本。改成不带 @ 的普通指针。
    · `（YYYY-MM-DD）` 超 90 天未触碰 —— 腐烂候选
    · 缺头部三件套的 `>` scope 引用块   standard §3

层级由「祖先目录里有几份 CLAUDE.md」判定，与具体目录结构无关：
  0 个 → 仓库根 · 1 个 → 子项目 · ≥2 个 → 模块叶子

用法
  python3 .claude/hooks/claudemd-lint.py              # 扫全仓
  python3 .claude/hooks/claudemd-lint.py path/to/CLAUDE.md ...
  python3 .claude/hooks/claudemd-lint.py --warn-only  # 只报告不失败（接 pre-commit 首轮灰度）
"""

import datetime
import os
import re
import subprocess
import sys

# ── standard §12 硬闸门（字节）
BUDGET = {"root": 8 * 1024, "sub": 16 * 1024, "leaf": 6 * 1024}
TIER_CN = {"root": "仓库根", "sub": "子项目", "leaf": "模块叶子"}
MAX_LINE_BYTES = 200
STALE_DAYS = 90

SKIP_DIRS = {
    ".git", "node_modules", ".pixi", "dist", "build", "__pycache__",
    ".venv", "venv", ".ruff_cache", ".pytest_cache", ".mypy_cache",
    "worktrees", ".worktrees", "site-packages",
}

FENCE_RE = re.compile(r"^\s*```")
# 反引号里、带扩展名、可带 :行号 的路径
PATH_RE = re.compile(
    r"`([A-Za-z0-9_][A-Za-z0-9_./\-]*\.(?:py|md|ya?ml|json|sql|toml|sh|ts|tsx|js|jsx|vue|rs|go|java|cfg|ini|txt))(?::\d+)?`"
)
# 裸 @ = 真 import；反引号内 @ = 死记号（docs: "Import parsing skips Markdown code spans"）
BARE_IMPORT_RE = re.compile(r"(?<![\w`])@([./A-Za-z0-9_\-]+\.md)(?!`)")
SPAN_IMPORT_RE = re.compile(r"`@([./A-Za-z0-9_\-]+\.md)`")
DATE_RE = re.compile(r"（(\d{4})-(\d{2})-(\d{2})）")


def repo_root(start):
    try:
        out = subprocess.run(
            ["git", "-C", start, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return os.path.abspath(start)


def discover(root):
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".claude")]
        if "CLAUDE.md" in filenames:
            found.append(os.path.join(dirpath, "CLAUDE.md"))
    return sorted(found)


def tier_of(path, all_paths):
    """祖先目录里有几份 CLAUDE.md → 0 根 / 1 子项目 / ≥2 叶子。"""
    d = os.path.dirname(os.path.abspath(path))
    ancestors = 0
    for other in all_paths:
        od = os.path.dirname(os.path.abspath(other))
        if od != d and d.startswith(od + os.sep):
            ancestors += 1
    return "root" if ancestors == 0 else ("sub" if ancestors == 1 else "leaf")


def strip_fences(lines):
    """返回 [(1-based 行号, 原文)]，剔除 ``` 围栏内的行（示例路径不算悬空）。"""
    out, inside = [], False
    for i, ln in enumerate(lines, 1):
        if FENCE_RE.match(ln):
            inside = not inside
            continue
        if not inside:
            out.append((i, ln))
    return out


def resolve(ref, mdpath, root, index):
    base = os.path.dirname(os.path.abspath(mdpath))
    for cand in (os.path.join(base, ref), os.path.join(root, ref)):
        if os.path.exists(cand):
            return True
    # 允许「仓内任意位置同名文件」—— 指针写了相对路径但文件搬过家，算 WARN 级，不在此拦
    return os.path.basename(ref) in index


def build_index(root):
    idx = set()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            idx.add(f)
    return idx


def check(path, tier, root, index, today):
    errs, warns = [], []
    rel = os.path.relpath(path, root)
    raw = open(path, "rb").read()
    text = raw.decode("utf-8", "replace")
    lines = text.split("\n")

    # §12 字节预算
    limit = BUDGET[tier]
    if len(raw) > limit:
        errs.append(
            "预算超线（%s）：%s > %s（%.1f×）—— 减到线内或按 standard §7 ⑥ 当场指针化"
            % (TIER_CN[tier], fmt(len(raw)), fmt(limit), len(raw) / float(limit))
        )

    # §12 单行长度
    long_lines = [
        (i, len(ln.encode("utf-8")))
        for i, ln in enumerate(lines, 1)
        if len(ln.encode("utf-8")) > MAX_LINE_BYTES and not ln.lstrip().startswith("|")
    ]
    if long_lines:
        worst = max(long_lines, key=lambda x: x[1])
        errs.append(
            "单行超 %dB：%d 行超标，最长 %s:%d（%dB）—— 拆条或转表格"
            % (MAX_LINE_BYTES, len(long_lines), rel, worst[0], worst[1])
        )

    body = strip_fences(lines)

    # §12 `@` 导入语义
    for lineno, ln in body:
        for imp in BARE_IMPORT_RE.findall(ln):
            if tier != "root":
                errs.append("%s:%d 子项目/叶子禁用裸 `@%s` 急切导入 —— 触碰该子树时本就会自动加载" % (rel, lineno, imp))
            elif imp.rstrip("/").endswith("CLAUDE.md"):
                errs.append(
                    "%s:%d 根文件禁裸 `@%s` —— 它把子项目内容无条件展开进每次请求（launch 时），"
                    "抵消掉子目录的按需加载；改成不带 @ 的普通指针" % (rel, lineno, imp)
                )
        for imp in SPAN_IMPORT_RE.findall(ln):
            warns.append(
                "%s:%d `@%s` 在反引号内 —— 官方 import 解析跳过 code span，**它不会被加载**，"
                "是死记号；易被误读为『已自动加载』。去掉 @ 写成普通指针" % (rel, lineno, imp)
            )

    # §8 悬空指针
    dangling = []
    for lineno, ln in body:
        for ref in PATH_RE.findall(ln):
            if "*" in ref or "<" in ref or ref.startswith("http"):
                continue
            if not resolve(ref, path, root, index):
                dangling.append((lineno, ref))
    for lineno, ref in dangling:
        errs.append("%s:%d 悬空指针 `%s` —— 目标不存在，同步删/改（standard §8）" % (rel, lineno, ref))

    # §10 腐烂候选
    stale = set()
    for lineno, ln in body:
        for y, m, d in DATE_RE.findall(ln):
            try:
                age = (today - datetime.date(int(y), int(m), int(d))).days
            except ValueError:
                continue
            if age > STALE_DAYS:
                stale.add((lineno, "%s-%s-%s" % (y, m, d), age))
    for lineno, ds, age in sorted(stale):
        warns.append("%s:%d 标注 %s 已 %d 天未触碰 —— 复核是否仍成立" % (rel, lineno, ds, age))

    # §3 头部三件套
    head = "\n".join(lines[:6])
    if not re.search(r"^>", head, re.M):
        warns.append("%s 缺头部 `>` scope 引用块（standard §3；叶子也不豁免，至少写 ↑父指针）" % rel)

    return errs, warns


def fmt(n):
    return "%.1fKB" % (n / 1024.0) if n >= 1024 else "%dB" % n


def main():
    argv = [a for a in sys.argv[1:] if a != "--warn-only"]
    warn_only = "--warn-only" in sys.argv[1:]
    seed = argv[0] if argv else "."
    if os.path.isfile(seed):
        seed = os.path.dirname(os.path.abspath(seed)) or "."
    root = repo_root(seed)
    targets = [os.path.abspath(a) for a in argv] if argv else discover(root)
    if not targets:
        print("claudemd-lint: 未发现 CLAUDE.md")
        return 0

    all_paths = discover(root)
    index = build_index(root)
    today = datetime.date.today()

    n_err = n_warn = 0
    print("claudemd-lint · %d 份 · 预算 根%s/子%s/叶%s · 单行≤%dB\n"
          % (len(targets), fmt(BUDGET["root"]), fmt(BUDGET["sub"]), fmt(BUDGET["leaf"]), MAX_LINE_BYTES))

    for p in targets:
        tier = tier_of(p, all_paths)
        size = os.path.getsize(p)
        errs, warns = check(p, tier, root, index, today)
        mark = "FAIL" if errs else ("warn" if warns else " ok ")
        print("[%s] %-46s %-6s %7s / %s"
              % (mark, os.path.relpath(p, root), TIER_CN[tier], fmt(size), fmt(BUDGET[tier])))
        for e in errs:
            print("       ERROR  %s" % e)
        for w in warns:
            print("       warn   %s" % w)
        n_err += len(errs)
        n_warn += len(warns)

    print("\n合计：%d ERROR · %d warn" % (n_err, n_warn))
    if n_err and not warn_only:
        print("→ 违反 .claude/claudemd-standard.md，提交被拦。修完重跑。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
