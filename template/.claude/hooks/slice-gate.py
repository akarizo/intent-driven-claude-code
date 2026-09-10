#!/usr/bin/env python3
# slice-gate · 切片规划 lint 与切片门禁（零 token）
#
# 子命令：
#   lint     --change-dir DIR                 校验 slices.json；stdout 打印 waves JSON；违规 exit 2 并在 stderr 点名规则
#   waves    --change-dir DIR                 只打印 waves JSON
#   start    S --change-dir DIR               在 git toplevel 写 .openspec-slice 标记（slice / change_dir / base=HEAD / started）
#   gate     S --change-dir DIR [--base REF]  跑 G1–G7；stdout 打印 JSON；追加 gate-report.md；ok 时删标记，红时标记 red_count+1
#   record   --change-dir DIR --json '<gate JSON>' | --slice S --commit SHA [--red] [--failed ...] [--warnings ...]
#                                              把（临时 worktree 里跑出的）门禁结论幂等写回分支的 gate-report.md / timeline.md
#   final    --change-dir DIR                 全量 test / lint / typecheck + 全部 scenario 状态
#   baseline --change-dir DIR                 跑一次全量测试，把耗时写回 slices.json.gate.full_suite_sec
#
# JSON 契约：{"slice", "ok", "commit", "failed": [...], "warnings": [...], "summary"}；failed 每项以 G<n> 开头并点名对象。
# 兼容 Python 3.8+，只用标准库。
import argparse
import fnmatch
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

TEST_DIR_NAMES = {"tests", "test", "__tests__", "spec"}
TEST_FILE_RE = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*_test\.py|[^/]*\.test\.[^/]+|[^/]*\.spec\.[^/]+)$")
DOC_EXT = {".md", ".mdx", ".markdown", ".txt", ".rst", ".html"}
CONFIG_EXT = {".json", ".yaml", ".yml", ".toml", ".ini", ".lock", ".cfg"}
NON_SOURCE_PREFIX = (".claude/", "openspec/", "docs/")
PY_TEST_DEF = re.compile(r"^(\s*)(?:async\s+)?def\s+(test_\w+)\s*\(")
JS_TEST_DEF = re.compile(r"^\s*(?:test|it)\s*\(\s*[\'\"`](.+?)[\'\"`]")
JS_BLOCK_START = re.compile(r"^\s*(?:test|it|describe)\s*\(")
MARK_RE = re.compile(r"xfail|skip", re.I)


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


def run_cmd(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    tail = "\n".join(out.strip().splitlines()[-6:])
    return p.returncode, tail


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
    marker = {"slice": args.slice, "change_dir": os.path.abspath(args.change_dir),
              "base": git(root, "rev-parse", "HEAD"), "started": now_iso()}
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
    for key, label in (("lint", "G2 lint"), ("typecheck", "G2 typecheck")):
        cmd = gate.get(key)
        if cmd:
            rc, tail = run_cmd(cmd, root)
            if rc != 0:
                failed.append("%s: exit %d\n%s" % (label, rc, tail))

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

    result = {"slice": args.slice, "ok": not failed, "commit": git(root, "rev-parse", "HEAD"),
              "failed": failed, "warnings": warnings, "hooks_missing": hooks_missing,
              "summary": "%s：%d 项失败，%d 项警告；改动 %d 个文件" % ("通过" if not failed else "阻断", len(failed), len(warnings), len(files))}
    append_report(args.change_dir, result)
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
    for key in ("lint", "typecheck"):
        cmd = gate.get(key)
        if cmd:
            rc, tail = run_cmd(cmd, root)
            if rc != 0:
                failed.append("G2 %s: exit %d\n%s" % (key, rc, tail))
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
    rc, tail = run_cmd(test_cmd, root)
    gate["full_suite_sec"] = round(time.time() - t0, 1)
    save_plan(args.change_dir, data)
    timeline_record(args.change_dir, "baseline", "exit %d, %ss" % (rc, gate["full_suite_sec"]))
    print(json.dumps({"test": test_cmd, "exit": rc, "full_suite_sec": gate["full_suite_sec"], "tail": tail}, ensure_ascii=False))
    sys.exit(0 if rc == 0 else 1)


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
    for name in ("lint", "waves", "final", "baseline"):
        p = sub.add_parser(name)
        p.add_argument("--change-dir", required=True)
    p = sub.add_parser("start")
    p.add_argument("slice")
    p.add_argument("--change-dir", required=True)
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
     "final": cmd_final, "baseline": cmd_baseline, "ship": cmd_ship}[args.cmd](args)


if __name__ == "__main__":
    main()
