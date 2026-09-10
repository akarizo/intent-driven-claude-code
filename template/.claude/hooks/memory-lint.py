#!/usr/bin/env python3
"""memory-lint —— memory 索引完整性门禁。

守 `~/.claude/projects/<slug>/memory/` 这个常驻上下文载体：索引每会话必付、
正文按需 recall，故索引的每一个字节都必须为真。四道闸：

    · 悬空指针（索引 → 不存在的文件）        ERROR
    · 孤儿文件（实体文件未被任何索引登记）    ERROR
    · 状态漂移（索引行状态词 ≠ 正文 description）  warn
    · 索引行长 / 常驻总量超预算              分档

与 claudemd-lint 零耦合（design D1）：检查对象不在任何 git 仓库下，故没有版本
基线，预算只能是绝对阈值、无法做净增量闸。

fail-open 是硬约束：任何内部异常一律静默放行 —— 坏门禁不能锁死编辑。

用法：
    python3 memory-lint.py            # 全量检查当前项目的 memory
    python3 memory-lint.py --all      # 同上
    python3 memory-lint.py --hook     # PostToolUse(Write|Edit)，读 stdin payload
"""

import json
import os
import pathlib
import re
import sys

# 阈值取自实测分布（2026-08-28，本机 21 个有 memory 的项目、209 条索引行）：
#   p50=146  p75=187  p90=322  p95=384  p99=503  max=552
# 刻意宽于 CLAUDE.md 的 200/400 —— 索引行承担坑位前置警告职能，
# 按 CLAUDE.md 行长标准压缩等同于摘除防护（design D2）。
LINE_WARN = 400           # 覆盖实测 top 3%
LINE_ERR = 700            # 当前零触发，纯防未来失控
INDEX_BUDGET = 28 * 1024  # 常驻索引总量；amc-afa 24KB 是唯一接近者

INDEX_NAME = "MEMORY.md"
# 二级索引靠命名约定识别，不靠「文件内含条目清单」—— 后者会把普通正文里的
# markdown 链接误计为已登记，造成漏报孤儿。门禁漏报比误报更危险（design D3）。
SECONDARY_PREFIX = "index-"

# 索引条目指针：`](某文件.md)`
LINK_RE = re.compile(r"\]\(([^)\s]+\.md)\)")
# 索引条目行：以 `- ` 开头且含指针
ENTRY_RE = re.compile(r"^\s*-\s")


def memory_dir_for(project_root):
    """由项目根绝对路径推导 memory 目录。

    规则：绝对路径的 `/` 全部替换为 `-`，拼在 ~/.claude/projects/ 下。
    只做正向 —— 项目名自带 `-` 时反向不可逆（design D5）。
    """
    slug = str(project_root).replace("/", "-")
    return pathlib.Path.home() / ".claude" / "projects" / slug / "memory"


def parse_index(text):
    """从索引文本提取条目指针，返回 [(行号, 行文本, 目标文件名)]。

    一行可以并排放多个指针（amc-afa 的真实写法），全部提取。
    """
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        if not ENTRY_RE.match(line):
            continue
        for m in LINK_RE.finditer(line):
            hits.append((i, line, m.group(1)))
    return hits


# 推进阶段有序表（design D4）。取命中的最高阶段；两侧都能判定且索引侧落后才报。
# 「部署」用否定预查排掉「待部署 / 未部署」——那还没到部署态。
STAGES = [
    (1, re.compile(r"已\s*propose|未\s*apply|待\s*apply")),
    (2, re.compile(r"已\s*apply|apply\s*完|\d+\s*/\s*\d+\s*(完成|task)?")),
    (3, re.compile(r"待开\s*MR|已开\s*MR|MR\s*!?\s*\d+|待\s*PR|待开\s*PR")),
    (4, re.compile(r"已合\s*main|已合并|已\s*merge")),
    (5, re.compile(r"(?<![待未])部署|已上线|已发\s*eks|发\s*eks|已发版")),
]

# frontmatter 的 description 单行。只读它、不扫正文全文 —— 正文常回顾历史阶段
# （「此前 propose 时……」），全文扫描必然误报（design D4）。
DESC_RE = re.compile(r"^description:\s*(.+?)\s*$", re.M)


def fmt(n):
    """字节数的人类可读形式。"""
    if n >= 1024:
        return "%.1fKB" % (n / 1024.0)
    return "%dB" % n


def _read(path):
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


STAGE_NAMES = {1: "propose", 2: "apply", 3: "待 MR/PR", 4: "已合 main", 5: "已部署"}


def _stage_name(level):
    return STAGE_NAMES.get(level, "?")


def stage_of(text):
    """提取文本所述的推进阶段序号；命中多个取最高，判定不了返回 0。"""
    best = 0
    for level, pat in STAGES:
        if pat.search(text):
            best = max(best, level)
    return best


def description_of(path):
    """取 frontmatter 的 description 单行；没有 frontmatter 返回空串。"""
    text = _read(path)
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    if end < 0:
        return ""
    m = DESC_RE.search(text[:end])
    if not m:
        return ""
    return m.group(1).strip().strip('"').strip("'")


def collect_entries(memory_dir):
    """收集全部索引条目，沿 index-*.md 递归一层，visited 防环。

    返回 [(来源索引文件名, 行号, 行文本, 目标文件名)]。
    """
    entries = []
    queue = [INDEX_NAME]
    visited = set()
    while queue:
        cur = queue.pop(0)
        if cur in visited:
            continue
        visited.add(cur)
        path = memory_dir / cur
        if not path.is_file():
            continue
        for lineno, line, target in parse_index(_read(path)):
            entries.append((cur, lineno, line, target))
            # 只对 index- 前缀的目标继续递归；普通 memory 文件的正文链接不展开
            if target.startswith(SECONDARY_PREFIX) and target not in visited:
                queue.append(target)
    return entries


def collect_registered(memory_dir):
    """收集被索引登记的文件名集合。"""
    return set(t for _, _, _, t in collect_entries(memory_dir))


def index_files(memory_dir):
    """索引文件集合：一级索引 + 全部二级索引（它们不是被登记的知识条目）。"""
    names = set([INDEX_NAME])
    for p in memory_dir.glob(SECONDARY_PREFIX + "*.md"):
        names.add(p.name)
    return names


def run(memory_dir):
    """对一个 memory 目录跑全部检查，返回 (errors, warnings)。"""
    memory_dir = pathlib.Path(memory_dir)
    index_path = memory_dir / INDEX_NAME
    # 多数项目没有 memory 目录 —— 静默退出，零输出零影响
    if not memory_dir.is_dir() or not index_path.is_file():
        return [], []

    errs = []
    warns = []

    entries = collect_entries(memory_dir)
    registered = set(t for _, _, _, t in entries)
    idx_names = index_files(memory_dir)

    # 闸一 · 悬空指针：索引指向的文件不存在
    dangling = []
    for src, lineno, _, target in entries:
        if not (memory_dir / target).is_file():
            dangling.append(target)
            errs.append("%s:%d 悬空指针 → %s 不存在" % (src, lineno, target))

    # 闸二 · 孤儿文件：实体文件未被任何索引登记（索引文件自身不算实体条目）
    orphans = []
    for p in sorted(memory_dir.glob("*.md")):
        if p.name in idx_names or p.name in registered:
            continue
        orphans.append(p.name)
        errs.append("孤儿文件 %s 未被任何索引登记" % p.name)

    # 双面归因：悬空与孤儿同时出现，多半是一次重命名没同步索引
    if dangling and orphans:
        errs.append("↑ 悬空(%s) 与 孤儿(%s) 可能是同一次重命名的两面"
                    % ("、".join(dangling), "、".join(orphans)))

    # 闸四 · 索引行长：按 UTF-8 字节，不按字符（字节是硬数据）
    # 同一行可含多个指针，按 (来源, 行号) 去重，只报一次
    seen_lines = set()
    for src, lineno, line, _ in entries:
        key = (src, lineno)
        if key in seen_lines:
            continue
        seen_lines.add(key)
        nbytes = len(line.encode("utf-8"))
        if nbytes > LINE_ERR:
            errs.append("%s:%d 索引行 %s > %s —— 细节下沉正文，索引行只留主题与关键词"
                        % (src, lineno, fmt(nbytes), fmt(LINE_ERR)))
        elif nbytes > LINE_WARN:
            warns.append("%s:%d 索引行 %s > %s —— 考虑把细节下沉到正文"
                         % (src, lineno, fmt(nbytes), fmt(LINE_WARN)))

    # 闸五 · 常驻索引总量：只算一级索引。
    # 二级索引按需 recall、不常驻 —— 把它算进来会惩罚「下沉」这个正确行为：
    # 下沉后总字节不变，warn 永远消不掉，用户只会困惑。
    total = index_path.stat().st_size
    if total > INDEX_BUDGET:
        warns.append("常驻索引 %s (%d B) > %s —— 把已完结条目下沉到 %s*.md 二级索引"
                     % (fmt(total), total, fmt(INDEX_BUDGET), SECONDARY_PREFIX))

    # 闸三 · 状态漂移：索引行所述阶段落后于正文 description
    # 自然语言比对不可能完全可判定，故只提醒、不阻断
    for src, lineno, line, target in entries:
        path = memory_dir / target
        if not path.is_file():
            continue
        desc = description_of(path)
        if not desc:
            continue
        idx_stage = stage_of(line)
        body_stage = stage_of(desc)
        if idx_stage and body_stage and idx_stage < body_stage:
            warns.append(
                "%s:%d 状态漂移 → %s：索引说「%s」，正文 description 说「%s」"
                % (src, lineno, target, _stage_name(idx_stage), _stage_name(body_stage)))

    return errs, warns


def memory_dir_of_path(file_path):
    """被写文件是否落在某个 memory 目录内；是则返回该目录，否则 None。

    判据是「父目录名为 memory 且其下有一级索引」—— 不依赖 CWD 推导，
    因为 PostToolUse 拿到的 file_path 本身就是绝对路径。
    """
    if not file_path:
        return None
    d = pathlib.Path(file_path).parent
    if d.name == "memory" and (d / INDEX_NAME).is_file():
        return d
    return None


def report(errs, warns, label):
    """把结果写 stderr —— exit code 2 时它会被回灌给 Claude。"""
    out = ["memory-lint 对 %s 的检查结果（standard 硬约束，非建议）：" % label]
    for e in errs:
        out.append("  ERROR  " + e)
    for w in warns:
        out.append("  warn   " + w)
    if errs:
        out.append("→ 这些是可判定的硬约束，**当轮修掉**，别留给以后。")
    sys.stderr.write("\n".join(out) + "\n")


def cmd_hook():
    """PostToolUse(Write|Edit)：只在目标落在 memory 目录内时出声。

    fail-open —— 任何内部异常一律静默放行，坏门禁不能锁死编辑（design D6）。
    """
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    try:
        ti = payload.get("tool_input") or {}
        fp = ti.get("file_path") or ti.get("notebook_path") or ""
        mdir = memory_dir_of_path(fp)
        if mdir is None:
            return 0
        errs, warns = run(mdir)
        if not errs and not warns:
            return 0
        report(errs, warns, str(mdir))
        return 2 if errs else 0
    except Exception:
        return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if "--hook" in argv:
        return cmd_hook()
    try:
        mdir = memory_dir_for(os.getcwd())
        errs, warns = run(mdir)
        if not errs and not warns:
            return 0
        report(errs, warns, str(mdir))
        return 2 if errs else 0
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())
