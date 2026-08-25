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
  python3 .claude/hooks/claudemd-lint.py                    # 扫全仓
  python3 .claude/hooks/claudemd-lint.py path/to/CLAUDE.md  # 只查指定文件
  python3 .claude/hooks/claudemd-lint.py --warn-only        # 只报告不失败（首轮灰度）
  python3 .claude/hooks/claudemd-lint.py --hook             # PostToolUse：从 stdin 读 JSON，写完当场回灌
  python3 .claude/hooks/claudemd-lint.py --diff-gate [--base REF] [--msg-file F]
                                                            # 净增量闸（pre-commit / CI）
"""

import datetime
import io
import json
import os
import re
import subprocess
import sys

# ── standard §12 硬闸门（字节）
BUDGET = {"root": 8 * 1024, "sub": 16 * 1024, "leaf": 10 * 1024}
TIER_CN = {"root": "仓库根", "sub": "子项目", "leaf": "模块叶子"}
MAX_LINE_BYTES = 200      # 超此长度提醒
HARD_LINE_BYTES = 400     # 超此长度拦截（真正伤 diff 局部化的那种）
STALE_DAYS = 90
# install.sh 注入段自身的预算（由模板负责，非项目作者）
SNIPPET_BUDGET = 4608
# 净增量闸：默认加一减一；确需扩预算，在 commit message 里显式申报一行
#   claudemd-budget: +512 <理由>
BUDGET_TOKEN = re.compile(r"^\s*claudemd-budget:\s*\+(\d+)\b(.*)$", re.M)
# 跨层重复：只比「够长、够具体」的行，短行/样板行不算
DUPE_MIN_BYTES = 48

# ── 启发式信号（WARN 级，会有假阳性；机器只能提示，判断权在人）
# §11 祈使句判据：只能读作「当时发生了什么」的句子属 ADR，不属本文件
HISTORY_RE = re.compile(r"此前|后来改成|曾[被经取因]|那次回退|已成为历史|旧表述|一度改回|反复了几轮")
# §7 Q4：已被测试/guard 拦住的约束，完整解释该搬进 assert message，本文件留一行防线索引
GUARD_RE = re.compile(r"测试钉死|钉死|AST guard|pre-commit 拦|guard 守|回归 guard")

MARK_BEGIN = "<!-- intent-driven:begin -->"
MARK_END = "<!-- intent-driven:end -->"

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

    # §12 字节预算 —— 只判项目自有内容，注入段单独计
    limit = BUDGET[tier]
    snippet_bytes = 0
    if MARK_BEGIN in text and MARK_END in text:
        a = text.index(MARK_BEGIN)
        b = text.index(MARK_END) + len(MARK_END)
        snippet_bytes = len(text[a:b].encode("utf-8"))
    own = len(raw) - snippet_bytes
    if own > limit:
        errs.append(
            "预算超线（%s）：自有内容 %s > %s（%.1f×）—— 减到线内或按 standard §7 ⑥ 当场分流/指针化"
            % (TIER_CN[tier], fmt(own), fmt(limit), own / float(limit))
        )
    if snippet_bytes > SNIPPET_BUDGET:
        warns.append(
            "install.sh 注入段 %s > %s —— 该段由模板负责，跑 install.sh --upgrade 取新版；"
            "仍超线则是模板欠债，不该由本仓承担" % (fmt(snippet_bytes), fmt(SNIPPET_BUDGET))
        )

    # §12 单行长度
    long_lines = [
        (i, len(ln.encode("utf-8")))
        for i, ln in enumerate(lines, 1)
        if len(ln.encode("utf-8")) > MAX_LINE_BYTES and not ln.lstrip().startswith("|")
    ]
    hard = [x for x in long_lines if x[1] > HARD_LINE_BYTES]
    if hard:
        worst = max(hard, key=lambda x: x[1])
        errs.append(
            "单行超 %dB：%d 行超标，最长 %s:%d（%dB）—— 拆条或转表格（伤 diff 局部化）"
            % (HARD_LINE_BYTES, len(hard), rel, worst[0], worst[1])
        )
    soft = [x for x in long_lines if x[1] <= HARD_LINE_BYTES]
    if soft:
        worst = max(soft, key=lambda x: x[1])
        warns.append(
            "单行超 %dB（提醒）：%d 行，最长 %s:%d（%dB）—— 密度可再压"
            % (MAX_LINE_BYTES, len(soft), rel, worst[0], worst[1])
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

    # §11 变更史叙述（启发式）
    hist = [i for i, ln in body if HISTORY_RE.search(ln)]
    if hist:
        warns.append(
            "疑似变更史叙述 %d 处（首处 %s:%d）—— §11 祈使句判据：写不成祈使句的句子属 ADR/git，"
            "不属本文件；只留「现在 MUST 怎么做」" % (len(hist), rel, hist[0])
        )

    # §7 Q4：已被机械防线拦住、却还写了长解释
    guarded = [i for i, ln in body
               if GUARD_RE.search(ln) and len(ln.encode("utf-8")) > MAX_LINE_BYTES]
    if guarded:
        warns.append(
            "%d 处已被测试/guard 拦住却仍写长解释（首处 %s:%d）—— §7 Q4：解释搬进 assert message，"
            "本文件收敛成一行「防线索引」" % (len(guarded), rel, guarded[0])
        )

    # §3 头部三件套
    head = "\n".join(lines[:6])
    if not re.search(r"^>", head, re.M):
        warns.append("%s 缺头部 `>` scope 引用块（standard §3；叶子也不豁免，至少写 ↑父指针）" % rel)

    return errs, warns, own


def fmt(n):
    return "%.1fKB" % (n / 1024.0) if n >= 1024 else "%dB" % n


def norm_line(ln):
    """归一化：剥 bullet / 缩进 / 强调符，供跨层比对。"""
    t = re.sub(r"^\s*(?:[-*+] |> |\d+\. )?", "", ln).strip()
    t = t.replace("**", "").replace("⚠", "").strip()
    return t


def cross_level_dupes(all_paths, root):
    """同一条事实出现在祖先与后代两层 = 违反 §0 不变量 1（单一真相）。"""
    seen = {}
    for p in all_paths:
        try:
            lines = io.open(p, encoding="utf-8").read().split("\n")
        except OSError:
            continue
        inside = False
        for ln in lines:
            if FENCE_RE.match(ln):
                inside = not inside
                continue
            if inside or ln.lstrip().startswith("|"):
                continue
            t = norm_line(ln)
            if len(t.encode("utf-8")) < DUPE_MIN_BYTES:
                continue
            seen.setdefault(t, set()).add(p)

    hits = []
    for text, files in seen.items():
        if len(files) < 2:
            continue
        fl = sorted(files)
        for i, a in enumerate(fl):
            da = os.path.dirname(os.path.abspath(a))
            for b in fl[i + 1:]:
                db = os.path.dirname(os.path.abspath(b))
                if db.startswith(da + os.sep) or da.startswith(db + os.sep):
                    hits.append((os.path.relpath(a, root), os.path.relpath(b, root), text))
                    break
    return hits


def git_show_size(ref, rel, root):
    r = subprocess.run(["git", "-C", root, "show", "%s:%s" % (ref, rel)],
                       capture_output=True)
    return len(r.stdout) if r.returncode == 0 else 0


def cmd_diff_gate(argv, root):
    """净增量闸：本次改动对全部 CLAUDE.md 的字节净变化 MUST <= 0，
    否则 commit message 必须带 `claudemd-budget: +N <理由>` 且 N >= 实际净增。"""
    base = "HEAD"
    msg_file = None
    for i, a in enumerate(argv):
        if a == "--base" and i + 1 < len(argv):
            base = argv[i + 1]
        if a == "--msg-file" and i + 1 < len(argv):
            msg_file = argv[i + 1]

    r = subprocess.run(["git", "-C", root, "diff", "--name-only", base, "--", "*CLAUDE.md"],
                       capture_output=True, text=True)
    rels = [x for x in r.stdout.split("\n") if x.strip()]
    if not rels:
        print("claudemd-lint --diff-gate: 本次未触碰任何 CLAUDE.md，放行")
        return 0

    rows, net = [], 0
    for rel in rels:
        before = git_show_size(base, rel, root)
        ap = os.path.join(root, rel)
        after = os.path.getsize(ap) if os.path.exists(ap) else 0
        rows.append((rel, before, after, after - before))
        net += after - before

    print("claudemd-lint --diff-gate（预算中性：加一必须减一）  base=%s\n" % base)
    print("  %-46s %9s %9s %9s" % ("file", "before", "after", "delta"))
    for rel, b, a, d in rows:
        print("  %-46s %8dB %8dB %+8dB" % (rel, b, a, d))
    print("  %-46s %9s %9s %+8dB" % ("净变化", "", "", net))

    if net <= 0:
        print("\n✓ 净增 <= 0，放行。")
        return 0

    allowance, reason = 0, ""
    if msg_file and os.path.exists(msg_file):
        m = BUDGET_TOKEN.search(io.open(msg_file, encoding="utf-8").read())
        if m:
            allowance, reason = int(m.group(1)), m.group(2).strip()

    if allowance >= net:
        print("\n✓ 已显式申报扩预算 +%dB（实际 +%dB）：%s" % (allowance, net, reason or "(未写理由)"))
        return 0

    print("\n✗ 净增 +%dB 但%s。" % (
        net, "未申报" if not allowance else "申报额 +%dB 不够" % allowance))
    print("  记忆层默认**预算中性**：要加一行，先删/指针化/分流等量内容（standard §0 不变量 4、§7 ⑥）。")
    print("  确需扩预算 → 在 commit message 里显式写一行，留下可审计的记录：")
    print("      claudemd-budget: +%d <为什么这条值得永久常驻>" % net)
    return 1


def cmd_hook(root):
    """PostToolUse(Write|Edit)：只在目标是 CLAUDE.md 时出声，把结果回灌给 Claude。
    fail-open —— 任何内部异常一律静默放行，坏门禁不能锁死编辑。"""
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    ti = payload.get("tool_input") or {}
    fp = ti.get("file_path") or ti.get("notebook_path") or ""
    if os.path.basename(fp) != "CLAUDE.md" or not os.path.exists(fp):
        return 0

    all_paths = discover(root)
    if os.path.abspath(fp) not in [os.path.abspath(x) for x in all_paths]:
        all_paths = all_paths + [fp]
    errs, warns, own = check(fp, tier_of(fp, all_paths), root,
                             build_index(root), datetime.date.today())
    if not errs and not warns:
        return 0

    rel = os.path.relpath(fp, root)
    out = ["claudemd-lint 对 %s 的检查结果（standard 硬约束，非建议）：" % rel]
    for e in errs:
        out.append("  ERROR  " + e)
    for w in warns:
        out.append("  warn   " + w)
    if errs:
        out.append("→ 这些是可判定的硬约束，**当轮修掉**，别留给以后。")
    sys.stderr.write("\n".join(out) + "\n")
    return 2 if errs else 0


def main():
    raw = sys.argv[1:]
    if "--hook" in raw:
        return cmd_hook(repo_root("."))
    if "--diff-gate" in raw:
        return cmd_diff_gate(raw, repo_root("."))

    argv = [a for a in raw if not a.startswith("--")]
    warn_only = "--warn-only" in raw
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
        errs, warns, own = check(p, tier, root, index, today)
        mark = "FAIL" if errs else ("warn" if warns else " ok ")
        extra = "" if own == size else "  (自有 %s)" % fmt(own)
        print("[%s] %-42s %-6s %8s / %-8s%s"
              % (mark, os.path.relpath(p, root), TIER_CN[tier], fmt(size), fmt(BUDGET[tier]), extra))
        for e in errs:
            print("       ERROR  %s" % e)
        for w in warns:
            print("       warn   %s" % w)
        n_err += len(errs)
        n_warn += len(warns)

    if not argv:  # 全仓扫描才做跨层比对（单文件模式没有可比对象）
        dupes = cross_level_dupes(all_paths, root)
        if dupes:
            print("\n[FAIL] 跨层重复（违反 §0 不变量 1「单一真相」·§2 LCA 去重）")
            for a, b, text in dupes[:12]:
                print("       ERROR  %s ↔ %s" % (a, b))
                print("              «%s»" % (text[:110] + ("…" if len(text) > 110 else "")))
            if len(dupes) > 12:
                print("       …另有 %d 条" % (len(dupes) - 12))
            print("       → 保留在 LCA 层那一份，子层只留指针。")
            n_err += len(dupes)

    print("\n合计：%d ERROR · %d warn" % (n_err, n_warn))
    if n_err and not warn_only:
        print("→ 违反 .claude/claudemd-standard.md，提交被拦。修完重跑。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
