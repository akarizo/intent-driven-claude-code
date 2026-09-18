#!/usr/bin/env python3
# slice-gate · 切片规划 lint 与切片门禁（零 token）
#
# 子命令：
#   lint     --change-dir DIR                 校验 slices.json；stdout 打印 waves JSON；违规 exit 2 并在 stderr 点名规则
#   waves    --change-dir DIR                 只打印 waves JSON
#   start    S --change-dir DIR [--base REF]  在 git toplevel 写 .openspec-slice 标记（slice / change_dir / base / started）；
#                                              标记已是同一切片时不改（resume），保住区间与 red_count
#   gate     S --change-dir DIR [--base REF]  跑 G1–G8；stdout 打印 JSON（含 base）；追加 gate-report.md；ok 时删标记，红时标记 red_count+1
#   record   --change-dir DIR --json '<gate JSON>' | --slice S --commit SHA [--red] [--failed ...] [--warnings ...]
#                                              把（临时 worktree 里跑出的）门禁结论幂等写回分支的 gate-report.md / timeline.md
#   final    --change-dir DIR                 全量 test / lint / typecheck（按基线差分）+ 全部 scenario 状态
#   baseline --change-dir DIR                 起飞前预检：跑 gate.test / lint / typecheck 与每片 verify，写 gate-baseline.json；
#                                              耗时写回 slices.json.gate.full_suite_sec；退出码按 ok
#   preflight --change-dir DIR                lint_plan + 基线四项校验（存在 / ok / plan_sha / commit 在分支历史）；通过打印 waves
#
# G2 差分：gate / final 的 lint / typecheck 非 0 时，与 gate-baseline.json 里规范化后的输出行比对，只为新增行判红；
#          无基线或该项基线为 null 时行为不变（直接判红）。
#
# JSON 契约：{"slice", "ok", "commit", "failed": [...], "warnings": [...],
#             "ceilings": [[路径, 行号, 限制, 升级路径], ...], "summary"}；failed 每项以 G<n> 开头并点名对象。
#             ceilings 由执行体转写后经 record --json 回流，形状不可信：解析见 ceiling_rows_from_json，绝不抛异常。
# 兼容 Python 3.8+，只用标准库。
import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

MAX_SLICES = 9
MAX_DEPTH = 3
MAX_OWNS = 12
MARKER = ".openspec-slice"
REPORT = "gate-report.md"
EVIDENCE = "evidence.log"
TIMELINE = "timeline.md"
BASELINE = "gate-baseline.json"
# verify 只跑测试；typecheck / lint 工具放 gate.typecheck / gate.lint，由门禁按基线差分
VERIFY_TOOL_RE = re.compile(r"\b(tsc|typecheck|eslint|rustfmt|clippy|ruff|mypy|flake8|golangci)\b")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

TEST_DIR_NAMES = {"tests", "test", "__tests__", "spec"}
TEST_FILE_RE = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*_test\.py|[^/]*\.test\.[^/]+|[^/]*\.spec\.[^/]+)$")
DOC_EXT = {".md", ".mdx", ".markdown", ".txt", ".rst", ".html"}
CONFIG_EXT = {".json", ".yaml", ".yml", ".toml", ".ini", ".lock", ".cfg"}
NON_SOURCE_PREFIX = (".claude/", "openspec/", "docs/")
PY_TEST_DEF = re.compile(r"^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(")
JS_TEST_DEF = re.compile(r"^\s*(?:test|it)\s*\(\s*[\'\"`](.+?)[\'\"`]")
JS_BLOCK_START = re.compile(r"^\s*(?:test|it|describe)\s*\(")
MARK_RE = re.compile(r"xfail|skip", re.I)
# G8 天花板标记：行首注释紧跟标记，两段用 -> 或 → 分隔（形如 `限制 -> 升级条件/路径`）
CEILING_RE = re.compile(r"^\s*(?:#|//|--|\*)+\s*ceiling\s*:\s*(.*)$", re.I)
CEILING_SPLIT = re.compile(r"->|→")
CEILING_MIN = 4
CEILING_HEAD = "## 天花板"
CEILING_COLS = "| 时间 | 切片 | 位置 | 限制 | 升级路径 |"
CEILING_SEP = "|---|---|---|---|---|"
DIFF_HUNK_RE = re.compile(r"^@@ .*?\+(\d+)")


# ---------------------------------------------------------------- 基础

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def die(msg, code=2):
    sys.stderr.write(msg.rstrip() + "\n")
    sys.exit(code)


def git(root, *args):
    p = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("git %s: %s" % (" ".join(args), p.stderr.strip()))
    return p.stdout.strip()


def toplevel(cwd=None):
    try:
        return git(cwd or os.getcwd(), "rev-parse", "--show-toplevel")
    except RuntimeError as e:
        die("不在 git 仓库内：%s" % e)


def load_plan(change_dir):
    path = os.path.join(change_dir, "slices.json")
    if not os.path.isfile(path):
        die("缺少 %s" % path)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_plan(change_dir, data):
    with open(os.path.join(change_dir, "slices.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def run_cmd_full(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def _tail(out):
    return "\n".join(out.strip().splitlines()[-6:])


def run_cmd(cmd, cwd):
    rc, out = run_cmd_full(cmd, cwd)
    return rc, _tail(out)


def normalize_lines(text):
    """去 ANSI、数字折成 #（行列号 / 错误码漂移不算新问题）、strip、丢空行，保序去重。"""
    seen, out = set(), []
    for raw in ANSI_RE.sub("", text or "").splitlines():
        line = re.sub(r"\d+", "#", raw).strip()
        if line and line not in seen:
            seen.add(line)
            out.append(line)
    return out


def plan_sha(data):
    """基线只对 gate 命令与每片 verify 负责：这些变了基线就过期，其余（owns / 耗时）不影响。"""
    gate = data.get("gate") or {}
    key = [gate.get("test"), gate.get("lint"), gate.get("typecheck"),
           [[s.get("id"), s.get("verify")] for s in data.get("slices") or []]]
    return hashlib.sha1(json.dumps(key, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def load_baseline(change_dir):
    path = os.path.join(change_dir, BASELINE)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def gate_cmd_verdict(kind, cmd, root, baseline):
    """跑 gate.<kind>，返回 (failed_item, warning_item)，至多一个非 None。

    有基线且该项非 null：只有规范化后不在基线里的输出行才判红；全在基线里则降为警告。
    """
    rc, out = run_cmd_full(cmd, root)
    if rc == 0:
        return None, None
    known = (baseline or {}).get(kind)
    if not known:
        return "G2 %s: exit %d\n%s" % (kind, rc, _tail(out)), None
    old = set(known.get("lines") or [])
    new = [l for l in normalize_lines(out) if l not in old]
    if not new:
        return None, "G2 %s: exit %d，输出与基线一致（既有 %d 行已按基线排除）" % (kind, rc, len(old))
    return "G2 %s: exit %d（新增 %d 行）\n%s" % (kind, rc, len(new), "\n".join(new[:6])), None


def glob_match(path, pattern):
    if path == pattern or fnmatch.fnmatchcase(path, pattern):
        return True
    if pattern.endswith("/**") and path.startswith(pattern[:-3] + "/"):
        return True
    return False


def globs_intersect(a, b):
    if a == b or glob_match(a, b) or glob_match(b, a):
        return True
    for x, y in ((a, b), (b, a)):
        if x.endswith("/**") and (y.startswith(x[:-3] + "/") or y == x[:-3]):
            return True
    return False


# ---------------------------------------------------------------- lint / waves

def compute_waves(slices):
    ids = [s["id"] for s in slices]
    deps = {s["id"]: list(s.get("deps") or []) for s in slices}
    placed, waves = set(), []
    while len(placed) < len(ids):
        wave = [i for i in ids if i not in placed and all(d in placed for d in deps[i])]
        if not wave:
            return waves, [i for i in ids if i not in placed]
        waves.append(wave)
        placed.update(wave)
    return waves, []


def lint_plan(data):
    errors = []
    slices = data.get("slices") or []
    ids = [s.get("id") for s in slices]
    if len(ids) != len(set(ids)):
        errors.append("ids: 切片 id 重复")
    if not (1 <= len(slices) <= MAX_SLICES):
        errors.append("count: 切片数 %d 不在 1–%d 内" % (len(slices), MAX_SLICES))
    for s in slices:
        owns = s.get("owns") or []
        if not (1 <= len(owns) <= MAX_OWNS):
            errors.append("owns: %s 的 owns 有 %d 条，须在 1–%d 内" % (s.get("id"), len(owns), MAX_OWNS))
        if not (s.get("verify") or "").strip():
            errors.append("verify: %s 缺少 verify 命令" % s.get("id"))
        elif VERIFY_TOOL_RE.search(s.get("verify") or ""):
            errors.append("verify: %s 含 typecheck/lint 工具，verify 只跑测试；typecheck 放 gate.typecheck、lint 放 gate.lint（门禁按基线差分）" % s.get("id"))
        for d in s.get("deps") or []:
            if d not in ids:
                errors.append("deps: %s 依赖的 %s 不存在" % (s.get("id"), d))
    waves, leftover = compute_waves(slices)
    if leftover:
        errors.append("cycle: 依赖成环 %s" % ", ".join(leftover))
    if len(waves) > MAX_DEPTH:
        errors.append("depth: DAG 深度 %d > %d" % (len(waves), MAX_DEPTH))
    by_id = {s["id"]: s for s in slices if "id" in s}
    for wave in waves:
        for i, a in enumerate(wave):
            for b in wave[i + 1:]:
                for pa in by_id[a].get("owns") or []:
                    for pb in by_id[b].get("owns") or []:
                        if globs_intersect(pa, pb):
                            errors.append("overlap: 同一 wave 的 %s 与 %s 都覆盖 %s / %s" % (a, b, pa, pb))
    return errors, waves


# ---------------------------------------------------------------- 留痕

def timeline_record(change_dir, event, note=""):
    path = os.path.join(change_dir, TIMELINE)
    try:
        new = not os.path.isfile(path)
        with open(path, "a", encoding="utf-8") as f:
            if new:
                f.write("<!-- timeline: ISO时间\\t事件\\t备注（由 hooks 自动追加） -->\n")
            f.write("%s\t%s\t%s\n" % (now_iso(), event, note.replace("\n", " ")))
    except OSError:
        pass


def append_report(change_dir, result):
    path = os.path.join(change_dir, REPORT)
    try:
        new = not os.path.isfile(path)
        with open(path, "a", encoding="utf-8") as f:
            if new:
                f.write("# Gate Report\n\n| 时间 | 切片 | 结论 | commit | failed | warnings |\n|---|---|---|---|---|---|\n")
            f.write("| %s | %s | %s | %s | %s | %s |\n" % (
                now_iso(), result["slice"], "ok" if result["ok"] else "red", result.get("commit", "")[:10],
                "; ".join(result["failed"]).replace("|", "/").replace("\n", " ") or "-",
                "; ".join(result["warnings"]).replace("|", "/").replace("\n", " ") or "-",
            ))
    except OSError:
        pass


def _cell(text):
    return text.replace("|", "/").replace("\n", " ")


def ceiling_rows_from_json(raw):
    """门禁 JSON 的 ceilings 字段 → record_ceilings 可用的行；形状不对的整条丢掉，行号不可信降级为 0。

    这个字段全程由执行体的结构化输出转写，不可信。解析绝不抛异常：留痕失败不得中断飞行。
    """
    if not isinstance(raw, (list, tuple)):
        return []  # 非可迭代标量 / dict：整段丢掉，不让迭代自己抛 TypeError
    out = []
    for r in raw:
        if not isinstance(r, (list, tuple)) or len(r) < 4:
            continue
        try:
            ln = int(str(r[1]).strip())
        except (TypeError, ValueError):
            ln = 0
        out.append((str(r[0]), ln, str(r[2]), str(r[3])))
    return out


def record_ceilings(change_dir, slice_id, rows):
    """把合规天花板标记汇总进 gate-report.md 的「天花板」表。

    表插在 Gate Report 表之前，这样 append_report 继续往文件尾追加的门禁行仍落在 gate 表里。
    """
    if not rows:
        return
    path = os.path.join(change_dir, REPORT)
    new = ["| %s | %s | %s:%d | %s | %s |" % (now_iso(), slice_id, rel, ln, _cell(limit), _cell(up))
           for rel, ln, limit, up in rows]
    try:
        lines = []
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        if CEILING_HEAD in lines:
            at = lines.index(CEILING_HEAD) + 1
            while at < len(lines) and not lines[at].strip():  # 表头前的空行
                at += 1
            while at < len(lines) and lines[at].startswith("|"):  # 表头与已有行，停在表尾空行
                at += 1
        else:
            at = 1 if lines and lines[0].startswith("#") else 0
            lines[at:at] = ["", CEILING_HEAD, "", CEILING_COLS, CEILING_SEP]
            at += 5
        lines[at:at] = new
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except OSError:
        pass


def evidence_state(change_dir, slice_id):
    """返回 'missing_file' | 'no_rows' | 'red_first' | 'no_red'。"""
    path = os.path.join(change_dir, EVIDENCE)
    if not os.path.isfile(path):
        return "missing_file"
    rows = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3 and parts[1] == slice_id:
                rows.append(parts[2])
    if not rows:
        return "no_rows"
    if "PASS" not in rows:
        return "no_red"
    last_pass = max(i for i, r in enumerate(rows) if r == "PASS")
    return "red_first" if any(r == "FAIL" for r in rows[:last_pass]) else "no_red"


def report_has_row(change_dir, slice_id, commit):
    path = os.path.join(change_dir, REPORT)
    if not os.path.isfile(path):
        return False
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            cols = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cols) >= 4 and cols[1] == slice_id and cols[3] == (commit or "")[:10]:
                return True
    return False


# ---------------------------------------------------------------- 文件分类与检查

def is_test_path(path):
    parts = path.split("/")
    if any(p in TEST_DIR_NAMES for p in parts[:-1]):
        return True
    return bool(TEST_FILE_RE.search(path))


def is_doc_or_config(path):
    if path.startswith(NON_SOURCE_PREFIX):
        return True
    _, ext = os.path.splitext(path)
    return ext.lower() in DOC_EXT or ext.lower() in CONFIG_EXT


def changed_files(root, base):
    head = git(root, "rev-parse", "HEAD")
    committed = set()
    if base and base != head:
        committed = set(x for x in git(root, "diff", "--name-only", "%s..HEAD" % base).splitlines() if x)
    uncommitted = set()
    # 不能用 git()：它会 strip() 掉首行的前导空格（" M path" 会被截成 "M path"）
    porcelain = subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True).stdout
    for line in porcelain.splitlines():
        if len(line) > 3:
            uncommitted.add(line[3:].split(" -> ")[-1].strip())
    return committed, uncommitted


def added_lines(root, base):
    """产出 base..HEAD 里新增的 (rel_path, lineno, text)。

    注意：`+++ b/<path>` 也以 `+` 开头，必须先判文件头再判内容行。
    """
    try:
        diff = git(root, "diff", "--unified=0", "%s..HEAD" % base)
    except RuntimeError:
        return
    rel, lineno = None, 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            p = line[4:].strip()
            rel = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
        elif line.startswith("@@"):
            m = DIFF_HUNK_RE.match(line)
            lineno = int(m.group(1)) if m else 0
        elif line.startswith(("--- ", "diff ", "index ", "old mode", "new mode", "similarity ", "rename ")):
            continue
        elif line.startswith("+") and rel:
            yield rel, lineno, line[1:]
            lineno += 1


def ceiling_rows(root, base):
    """扫新增源码行里的天花板标记，返回 (failed, rows)；rows 每项 = (rel, lineno, 限制, 升级路径)。

    无标记既不判红也不警告：判据只管标了的完整性，不管该不该标。
    """
    failed, rows = [], []
    for rel, lineno, text in added_lines(root, base):
        if is_doc_or_config(rel) or rel.startswith(NON_SOURCE_PREFIX):
            continue
        m = CEILING_RE.match(text)
        if not m:
            continue
        parts = CEILING_SPLIT.split(m.group(1), 1)
        limit = parts[0].strip().strip("`").strip()
        upgrade = parts[1].strip().strip("`").strip() if len(parts) > 1 else ""
        if len(limit) < CEILING_MIN or len(upgrade) < CEILING_MIN:
            failed.append("G8 ceiling: %s:%d 缺%s（期望形状 `限制 -> 升级条件/路径`，两段各不少于 %d 字符）" % (
                rel, lineno, "限制段" if len(limit) < CEILING_MIN else "升级路径段", CEILING_MIN))
        else:
            rows.append((rel, lineno, limit, upgrade))
    return failed, rows


def gwt_violations(root, test_files):
    out = []
    for rel in sorted(test_files):
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        for name, body in _test_bodies(rel, lines):
            pos = {}
            for kw in ("Given:", "When:", "Then:"):
                m = re.search(r"(?m)^\s*(?:#|//|\*)\s*%s" % kw, body)
                pos[kw] = m.start() if m else -1
            g, w, t = pos["Given:"], pos["When:"], pos["Then:"]
            if min(g, w, t) < 0 or not (g < w < t):
                missing = [k for k, i in pos.items() if i < 0] or ["顺序不是 Given→When→Then"]
                out.append("G4 GWT: %s::%s 缺 %s" % (rel, name, " ".join(missing)))
    return out


def _py_test_bodies(lines):
    """用 AST 找 test_* 函数，避免把字符串常量里的 def 误判为测试。"""
    import ast
    src = "\n".join(lines)
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    out = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            end = getattr(node, "end_lineno", None) or node.lineno
            out.append((node.name, "\n".join(lines[node.lineno - 1:end])))
    return out


def _test_bodies(rel, lines):
    if rel.endswith(".py"):
        bodies = _py_test_bodies(lines)
        if bodies is not None:
            for item in bodies:
                yield item
            return
        i = 0
        while i < len(lines):
            m = PY_TEST_DEF.match(lines[i])
            if not m:
                i += 1
                continue
            indent, name = len(m.group(1)), m.group(2)
            j = i + 1
            while j < len(lines):
                s = lines[j]
                if s.strip() and (len(s) - len(s.lstrip())) <= indent and not s.lstrip().startswith(("#", "@")):
                    break
                j += 1
            yield name, "\n".join(lines[i:j])
            i = j
    else:
        starts = [k for k, s in enumerate(lines) if JS_BLOCK_START.match(s)]
        for idx, k in enumerate(starts):
            m = JS_TEST_DEF.match(lines[k])
            if not m:
                continue
            end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
            yield m.group(1), "\n".join(lines[k:end])


FLIGHT_RECORDS = (TIMELINE, REPORT, EVIDENCE)


def ownership_violations(files, owns, change_rel, committed=()):
    out = []
    prefix = change_rel.rstrip("/") + "/"
    for f in sorted(files):
        if f == MARKER:
            continue
        if f.startswith(prefix):
            # 飞行记录由 hook 追加、由 integrator / 主会话单独提交；执行体把它们裹进切片 commit 会在合回时冲突
            if f in committed and f[len(prefix):] in FLIGHT_RECORDS:
                out.append("G6 flight-record: %s 属飞行记录，执行体不得提交（由 integrator 单独 commit）" % f)
            continue
        if not any(glob_match(f, o) for o in owns):
            out.append("G6 ownership: %s 不在 owns 内" % f)
    return out


def _py_decorators(source, func):
    """用 AST 取函数 func 的完整装饰器源文本（支持跨行）；解析失败或找不到返回 None。"""
    import ast
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func:
            segs = [ast.get_source_segment(source, d) or "" for d in node.decorator_list]
            return "\n".join(segs)
    return None


def scenario_status(root, data, slice_ids=None):
    """返回 (violations, total, passed)。passed = 有映射、函数存在、且无 xfail/skip 标记。"""
    tests = data.get("scenario_tests") or {}
    wanted = []
    for s in data.get("slices") or []:
        if slice_ids is None or s["id"] in slice_ids:
            wanted.extend(s.get("scenarios") or [])
    violations, passed = [], 0
    for sid in wanted:
        target = tests.get(sid)
        if not target or "::" not in target:
            violations.append("G7 scenario: %s 无测试映射" % sid)
            continue
        rel, func = target.split("::", 1)
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            violations.append("G7 scenario: %s → %s 文件不存在" % (sid, rel))
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            source = f.read()
        lines = source.splitlines()
        hit = None
        for i, line in enumerate(lines):
            if re.match(r"^\s*(?:async\s+)?def\s+%s\s*\(" % re.escape(func), line) or (
                    JS_TEST_DEF.match(line) and JS_TEST_DEF.match(line).group(1) == func):
                hit = i
                break
        if hit is None:
            violations.append("G7 scenario: %s → %s 未定义" % (sid, target))
            continue
        marked = False
        decos = _py_decorators(source, func) if rel.endswith(".py") else None
        if decos is not None:
            marked = bool(MARK_RE.search(decos))  # AST 取完整 decorator_list，跨行装饰器也能识别
        else:
            k = hit - 1
            while k >= 0 and lines[k].strip().startswith("@"):
                if MARK_RE.search(lines[k]):
                    marked = True
                k -= 1
        if marked:
            violations.append("G7 scenario: %s → %s 仍标记 xfail/skip" % (sid, target))
            continue
        passed += 1
    return violations, len(wanted), passed


def detect_test_cmd(root):
    if os.path.isfile(os.path.join(root, "package.json")):
        return "npm test"
    if any(os.path.isfile(os.path.join(root, f)) for f in ("pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini")) or os.path.isdir(os.path.join(root, "tests")):
        return "python3 -m pytest -q"
    if os.path.isfile(os.path.join(root, "go.mod")):
        return "go test ./..."
    if os.path.isfile(os.path.join(root, "Cargo.toml")):
        return "cargo test"
    return None


# ---------------------------------------------------------------- 子命令

def cmd_lint(args, print_waves=True):
    data = load_plan(args.change_dir)
    errors, waves = lint_plan(data)
    if errors:
        die("slices.json 不合法：\n  - " + "\n  - ".join(errors))
    if print_waves:
        print(json.dumps(waves, ensure_ascii=False))
    return waves


def cmd_start(args):
    root = toplevel()
    data = load_plan(args.change_dir)
    if args.slice not in [s["id"] for s in data.get("slices") or []]:
        die("切片 %s 不在 slices.json 中" % args.slice)
    existing = _read_marker(root)
    if existing and existing.get("slice") == args.slice:
        # 重试同一切片：区间起点与 red_count 都要保住，标记原样不动
        timeline_record(args.change_dir, "slice-start", "%s (resume)" % args.slice)
        print(json.dumps(existing, ensure_ascii=False))
        return
    marker = {"slice": args.slice, "change_dir": os.path.abspath(args.change_dir),
              "base": args.base or git(root, "rev-parse", "HEAD"), "started": now_iso()}
    with open(os.path.join(root, MARKER), "w", encoding="utf-8") as f:
        json.dump(marker, f, ensure_ascii=False)
    timeline_record(args.change_dir, "slice-start", args.slice)
    print(json.dumps(marker, ensure_ascii=False))


def _read_marker(root):
    path = os.path.join(root, MARKER)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def cmd_gate(args):
    root = toplevel()
    data = load_plan(args.change_dir)
    by_id = {s["id"]: s for s in data.get("slices") or []}
    if args.slice not in by_id:
        die("切片 %s 不在 slices.json 中" % args.slice)
    sl = by_id[args.slice]
    marker = _read_marker(root)
    base = args.base or (marker or {}).get("base")
    if not base:
        die("没有 base：先运行 `slice-gate.py start %s`，或传 --base" % args.slice)
    change_rel = os.path.relpath(os.path.abspath(args.change_dir), root).replace(os.sep, "/")
    failed, warnings = [], []

    committed, uncommitted = changed_files(root, base)
    stray = sorted(f for f in uncommitted if f != MARKER and not f.startswith(change_rel + "/"))
    if stray:
        warnings.append("工作树有未提交改动：%s" % ", ".join(stray[:8]))
    files = committed | uncommitted

    rc, tail = run_cmd(sl["verify"], root)
    if rc != 0:
        failed.append("G1 verify: exit %d\n%s" % (rc, tail))
    gate = data.get("gate") or {}
    baseline = load_baseline(args.change_dir)
    for key in ("lint", "typecheck"):
        cmd = gate.get(key)
        if cmd:
            f2, w2 = gate_cmd_verdict(key, cmd, root, baseline)
            if f2:
                failed.append(f2)
            if w2:
                warnings.append(w2)

    source = [f for f in files if not is_test_path(f) and not is_doc_or_config(f) and not f.startswith(change_rel + "/")]
    tests = [f for f in files if is_test_path(f)]
    if source and not tests:
        failed.append("G3 pairing: 改了源码 %s 但区间内没有测试文件改动" % ", ".join(sorted(source)[:6]))
    failed.extend(gwt_violations(root, tests))
    ev = evidence_state(args.change_dir, args.slice)
    hooks_missing = ev == "missing_file"
    if ev == "missing_file":
        warnings.append("G5 evidence: 无 evidence.log（test-evidence hook 未安装或未触发），本切片留痕无法核对")
    elif ev == "no_rows":
        failed.append("G5 evidence: evidence.log 无本切片 %s 的测试运行记录（hook 在工作却没跑过测试）" % args.slice)
    elif ev == "no_red":
        warnings.append("G5 evidence: 未见 RED 先于 GREEN 的测试运行记录")
    failed.extend(ownership_violations(files, sl.get("owns") or [], change_rel, committed))
    v7, _, _ = scenario_status(root, data, {args.slice})
    failed.extend(v7)
    v8, ceilings = ceiling_rows(root, base)
    failed.extend(v8)

    result = {"slice": args.slice, "ok": not failed, "commit": git(root, "rev-parse", "HEAD"), "base": base,
              "failed": failed, "warnings": warnings, "hooks_missing": hooks_missing,
              "ceilings": [[rel, ln, limit, up] for rel, ln, limit, up in ceilings],
              "summary": "%s：%d 项失败，%d 项警告；改动 %d 个文件" % ("通过" if not failed else "阻断", len(failed), len(warnings), len(files))}
    append_report(args.change_dir, result)
    record_ceilings(args.change_dir, args.slice, ceilings)
    timeline_record(args.change_dir, "gate", "%s %s" % (args.slice, "ok" if result["ok"] else "red"))
    if marker is not None:
        if result["ok"]:
            try:
                os.remove(os.path.join(root, MARKER))
            except OSError:
                pass
        else:
            # 记红次数：连续 2 次红执行体按纪律停下上报，stop-gate 据此不再强制续跑
            marker["red_count"] = int(marker.get("red_count") or 0) + 1
            try:
                with open(os.path.join(root, MARKER), "w", encoding="utf-8") as f:
                    json.dump(marker, f, ensure_ascii=False)
            except OSError:
                pass
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 1)


def cmd_record(args):
    """integrator 把（在临时 worktree 里跑出的）切片门禁 JSON 幂等写回 change 分支的 gate-report.md / timeline.md。"""
    if args.json:
        try:
            result = json.loads(args.json)
        except ValueError as e:
            die("--json 不是合法 JSON：%s" % e)
    else:
        if not (args.slice and args.commit):
            die("record 需要 --json，或 --slice 与 --commit（可选 --ok/--red --failed --warnings）")
        result = {"slice": args.slice, "ok": not args.red, "commit": args.commit,
                  "failed": [x for x in (args.failed or "").split(";") if x.strip()],
                  "warnings": [x for x in (args.warnings or "").split(";") if x.strip()]}
    result.setdefault("failed", [])
    result.setdefault("warnings", [])
    if report_has_row(args.change_dir, result.get("slice", ""), result.get("commit", "")):
        print(json.dumps({"recorded": False, "reason": "already recorded"}, ensure_ascii=False))
        return
    append_report(args.change_dir, result)
    # 临时 worktree 里跑出的天花板行同样不会随 commit 进分支，随门禁结论一起写回（幂等由上面的 report_has_row 兜）
    record_ceilings(args.change_dir, result.get("slice", ""),
                    ceiling_rows_from_json(result.get("ceilings")))
    timeline_record(args.change_dir, "gate", "%s %s" % (result.get("slice"), "ok" if result.get("ok") else "red"))
    print(json.dumps({"recorded": True, "slice": result.get("slice"), "commit": result.get("commit")}, ensure_ascii=False))


def cmd_final(args):
    root = toplevel()
    data = load_plan(args.change_dir)
    gate = data.get("gate") or {}
    failed, warnings = [], []
    test_cmd = gate.get("test") or detect_test_cmd(root)
    if not test_cmd:
        warnings.append("未配置也未探测到全量测试命令")
    else:
        rc, tail = run_cmd(test_cmd, root)
        if rc != 0:
            failed.append("G2 test: exit %d\n%s" % (rc, tail))
    baseline = load_baseline(args.change_dir)
    for key in ("lint", "typecheck"):
        cmd = gate.get(key)
        if cmd:
            f2, w2 = gate_cmd_verdict(key, cmd, root, baseline)
            if f2:
                failed.append(f2)
            if w2:
                warnings.append(w2)
    v7, total, passed = scenario_status(root, data)
    failed.extend(v7)
    result = {"slice": "final", "ok": not failed, "commit": git(root, "rev-parse", "HEAD"),
              "failed": failed, "warnings": warnings,
              "scenarios": {"total": total, "passed": passed if not failed else min(passed, total - len(v7))},
              "summary": "final %s：scenario %d/%d" % ("通过" if not failed else "阻断", passed, total)}
    append_report(args.change_dir, result)
    timeline_record(args.change_dir, "final", "ok" if result["ok"] else "red")
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 1)


def cmd_baseline(args):
    root = toplevel()
    data = load_plan(args.change_dir)
    gate = data.setdefault("gate", {})
    test_cmd = gate.get("test") or detect_test_cmd(root)
    if not test_cmd:
        die("未配置也未探测到全量测试命令")
    gate["test"] = test_cmd
    t0 = time.time()
    rc, out = run_cmd_full(test_cmd, root)
    gate["full_suite_sec"] = round(time.time() - t0, 1)
    reasons = []
    if rc != 0:
        reasons.append("全量测试在基线上红（exit %d）" % rc)
    bl = {"commit": git(root, "rev-parse", "HEAD"), "at": now_iso(), "plan_sha": None,
          "ok": None, "reasons": reasons, "test": {"exit": rc, "sec": gate["full_suite_sec"]}}
    for key in ("lint", "typecheck"):
        cmd = gate.get(key)
        if cmd:
            krc, kout = run_cmd_full(cmd, root)
            bl[key] = {"exit": krc, "lines": normalize_lines(kout)}
        else:
            bl[key] = None
    bl["verify"] = {}
    for s in data.get("slices") or []:
        vrc, _ = run_cmd_full(s.get("verify") or "false", root)
        bl["verify"][s["id"]] = {"exit": vrc}
        if vrc != 0:
            reasons.append("%s verify 在基线上红（exit %d）：命令不可运行或含既有错误" % (s["id"], vrc))
    save_plan(args.change_dir, data)
    bl["plan_sha"] = plan_sha(data)
    bl["ok"] = not reasons
    with open(os.path.join(args.change_dir, BASELINE), "w", encoding="utf-8") as f:
        json.dump(bl, f, ensure_ascii=False, indent=2)
        f.write("\n")
    timeline_record(args.change_dir, "baseline", "exit %d, %ss %s" % (rc, gate["full_suite_sec"], "ok" if bl["ok"] else "red"))
    print(json.dumps(dict(bl, test_cmd=test_cmd, tail=_tail(out)), ensure_ascii=False))
    sys.exit(0 if bl["ok"] else 1)


def cmd_preflight(args):
    """起飞前四项校验：计划合法、基线存在且绿、基线未过期、基线 commit 在当前分支历史。通过打印 waves。"""
    root = toplevel()
    data = load_plan(args.change_dir)
    errors, waves = lint_plan(data)
    if errors:
        die("slices.json 不合法：\n  - " + "\n  - ".join(errors))
    bl = load_baseline(args.change_dir)
    if bl is None:
        die("缺基线：先运行 slice-gate.py baseline --change-dir %s" % args.change_dir)
    if not bl.get("ok"):
        die("基线红，不能起飞：\n  - " + "\n  - ".join(bl.get("reasons") or ["ok 为 false 但无 reasons"]))
    if bl.get("plan_sha") != plan_sha(data):
        die("基线过期：gate / verify 改动后需重跑 baseline")
    # 不能用 git()：--is-ancestor 不成立时退出 1，git() 会当成异常抛
    p = subprocess.run(["git", "merge-base", "--is-ancestor", str(bl.get("commit") or ""), "HEAD"],
                       cwd=root, capture_output=True, text=True)
    if p.returncode != 0:
        die("基线 commit 不在当前分支历史：%s（重跑 baseline）" % (bl.get("commit") or "?")[:10])
    print(json.dumps(waves, ensure_ascii=False))


def report_latest(change_dir):
    """gate-report.md 按切片取最后一行：{slice: {"ok": bool, "commit": 10位, "failed": str}}。"""
    path = os.path.join(change_dir, REPORT)
    latest = {}
    if not os.path.isfile(path):
        return latest
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            cols = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cols) >= 5 and cols[2] in ("ok", "red"):
                latest[cols[1]] = {"ok": cols[2] == "ok", "commit": cols[3], "failed": cols[4]}
    return latest


def cmd_ship(args):
    """draft / ready 裁决：只读 gate-report.md、HEAD、review-findings.json；工作流的 blocked 只作说明。"""
    root = toplevel()
    head = git(root, "rev-parse", "HEAD")
    reasons = []
    findings = {}
    fpath = os.path.join(args.change_dir, "review-findings.json")
    if os.path.isfile(fpath):
        with open(fpath, "r", encoding="utf-8") as f:
            findings = json.load(f) or {}
    plan_path = os.path.join(args.change_dir, "slices.json")
    if os.path.isfile(plan_path):
        data = load_plan(args.change_dir)
        latest = report_latest(args.change_dir)
        for s in data.get("slices") or []:
            row = latest.get(s["id"])
            if row is None:
                reasons.append("切片 %s 无门禁记录" % s["id"])
            elif not row["ok"]:
                reasons.append("切片 %s 门禁红：%s" % (s["id"], row["failed"]))
        final = latest.get("final")
        if final is None:
            reasons.append("final 未运行")
        elif not final["ok"]:
            reasons.append("final 红：%s" % final["failed"])
        elif final["commit"] != head[:10]:
            reasons.append("final 过期：记录 %s，HEAD %s" % (final["commit"], head[:10]))
    # 铁律 4：CRITICAL/HIGH 未闭环不得非 draft —— 与是否飞行模式无关，无条件检查
    blocking = findings.get("blocking") or []
    if blocking:
        reasons.append("%d 条 CRITICAL/HIGH 评审未闭环" % len(blocking))
    blocked = findings.get("blocked") or []
    result = {"ready": not reasons, "commit": head, "reasons": reasons, "blocked": blocked}
    timeline_record(args.change_dir, "ship", "ready" if result["ready"] else "draft: " + "; ".join(reasons))
    if args.markdown:
        parts = []
        if reasons:
            parts.append("## 飞行门禁未全绿\n\n" + "\n".join("- %s" % r for r in reasons))
        if blocked:
            parts.append("### 飞行中记 blocked 的切片\n\n" + "\n".join(
                "- %s（%s）：%s" % (b.get("slice", "?"), b.get("kind", "infra"), b.get("reason", "")) for b in blocked))
        print("\n\n".join(parts))
    else:
        print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ready"] else 1)


def main():
    ap = argparse.ArgumentParser(description="slice-gate：切片规划 lint 与切片门禁")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("lint", "waves", "final", "baseline", "preflight"):
        p = sub.add_parser(name)
        p.add_argument("--change-dir", required=True)
    p = sub.add_parser("start")
    p.add_argument("slice")
    p.add_argument("--change-dir", required=True)
    p.add_argument("--base", help="区间起点；默认 HEAD（临时 worktree 里从分支 commit 分叉时由派发方传入）")
    p = sub.add_parser("gate")
    p.add_argument("slice")
    p.add_argument("--change-dir", required=True)
    p.add_argument("--base")
    p = sub.add_parser("record", help="把切片门禁 JSON 幂等写回 gate-report.md / timeline.md（integrator 合回并行切片时用）")
    p.add_argument("--change-dir", required=True)
    p.add_argument("--json")
    p.add_argument("--slice")
    p.add_argument("--commit")
    p.add_argument("--red", action="store_true")
    p.add_argument("--failed")
    p.add_argument("--warnings")
    p = sub.add_parser("ship", help="draft / ready 裁决：读 gate-report.md + HEAD + review-findings.json；退出码 0 ready / 1 draft")
    p.add_argument("--change-dir", required=True)
    p.add_argument("--markdown", action="store_true", help="打印可贴入 PR 正文的段落而不是 JSON")
    args = ap.parse_args()
    {"lint": cmd_lint, "waves": cmd_lint, "start": cmd_start, "gate": cmd_gate, "record": cmd_record,
     "final": cmd_final, "baseline": cmd_baseline, "preflight": cmd_preflight, "ship": cmd_ship}[args.cmd](args)


if __name__ == "__main__":
    main()
