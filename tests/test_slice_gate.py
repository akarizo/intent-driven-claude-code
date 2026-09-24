"""slice-gate.py：切片规划 lint 与切片门禁（scenario: slice-gate#*）。"""
import json

import pytest

from conftest import commit_all, git, run_hook, write


def plan(slices, gate=None, scenario_tests=None):
    return {
        "version": 1, "change": "c",
        "gate": gate or {"test": "python3 -m pytest -q tests", "lint": None, "typecheck": None, "full_suite_sec": None},
        "slices": slices,
        "scenario_tests": scenario_tests or {},
    }


def slice_(sid, owns, deps=(), verify="true", scenarios=()):
    return {"id": sid, "title": sid, "scenarios": list(scenarios), "owns": owns, "deps": list(deps), "verify": verify, "packet": f"slices/{sid}.md"}


def write_plan(change_dir, data):
    write(change_dir / "slices.json", json.dumps(data, ensure_ascii=False, indent=1))
    return change_dir


def six_slice_plan():
    return plan([
        slice_("S1", ["a/**"]), slice_("S2", ["b/**"]),
        slice_("S3", ["c/**"], deps=["S1", "S2"]),
        slice_("S4", ["d/**"], deps=["S3"]), slice_("S5", ["e/**"], deps=["S3"]), slice_("S6", ["f/**"], deps=["S3"]),
    ])


# ---------------------------------------------------------------- lint

def test_lint_accepts_valid_plan(tmp_path):
    # Given: 6 个切片，deps 无环且深度为 3，同 wave 内 owns 两两不相交，每片 verify 非空
    change = write_plan(tmp_path / "openspec" / "changes" / "c", six_slice_plan())

    # When: 运行 slice-gate.py lint
    p = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 退出码 0，且 stdout 打印 waves [["S1","S2"],["S3"],["S4","S5","S6"]]
    assert p.returncode == 0, p.stderr
    assert json.loads(p.stdout) == [["S1", "S2"], ["S3"], ["S4", "S5", "S6"]]


def test_lint_rejects_overlap(tmp_path):
    # Given: 两个无依赖关系（同一 wave）的切片都在 owns 里声明了 src/a.py
    data = plan([slice_("S1", ["src/a.py"]), slice_("S2", ["src/a.py", "src/b.py"])])
    change = write_plan(tmp_path / "c", data)

    # When: 运行 lint
    p = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 退出码非 0，错误信息点名规则 overlap、两个切片 id 与重叠路径
    assert p.returncode != 0
    assert "overlap" in p.stderr and "S1" in p.stderr and "S2" in p.stderr and "src/a.py" in p.stderr


def test_lint_rejects_depth(tmp_path):
    # Given: deps 链 S1 ← S2 ← S3 ← S4，深度为 4
    data = plan([slice_("S1", ["a"]), slice_("S2", ["b"], deps=["S1"]), slice_("S3", ["c"], deps=["S2"]), slice_("S4", ["d"], deps=["S3"])])
    change = write_plan(tmp_path / "c", data)

    # When: 运行 lint
    p = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 退出码非 0，错误信息点名规则 depth
    assert p.returncode != 0
    assert "depth" in p.stderr


def test_lint_rejects_count(tmp_path):
    # Given: 10 个互不依赖、owns 各异的切片
    data = plan([slice_(f"S{i}", [f"d{i}/**"]) for i in range(1, 11)])
    change = write_plan(tmp_path / "c", data)

    # When: 运行 lint
    p = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 退出码非 0，错误信息点名规则 count
    assert p.returncode != 0
    assert "count" in p.stderr


def test_lint_rejects_owns_limit(tmp_path):
    # Given: 一个切片声明了 13 条 owns
    data = plan([slice_("S1", [f"src/f{i}.py" for i in range(13)])])
    change = write_plan(tmp_path / "c", data)

    # When: 运行 lint
    p = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 退出码非 0，错误信息点名规则 owns
    assert p.returncode != 0
    assert "owns" in p.stderr


# ---------------------------------------------------------------- gate

GOOD_TEST = '''
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from src.mod import add


def test_mod_adds():
    # Given: 两个整数 1 与 2
    a, b = 1, 2
    # When: 调用 add
    result = add(a, b)
    # Then: 返回 3
    assert result == 3
'''

BAD_TEST = '''
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from src.mod import add


def test_mod_adds():
    # Given: 两个整数 1 与 2
    # When: 调用 add
    assert add(1, 2) == 3
'''


DEFAULT_SRC = "def add(a, b):\n    return a + b\n"


def gate_repo(git_repo, test_body=GOOD_TEST, extra_file=None, src_body=DEFAULT_SRC, extra_owned=None):
    """构造：已 start 的切片 S1 + 一个含源码与配对测试的 commit。返回 change 目录。

    src_body 换源码正文；extra_owned 是 {相对路径: 正文}，既写文件也一并进 owns。
    """
    change = git_repo / "openspec" / "changes" / "c"
    extra_owned = extra_owned or {}
    data = plan(
        [slice_("S1", ["src/mod.py", "tests/test_mod.py"] + sorted(extra_owned), verify="python3 -m pytest -q tests/test_mod.py", scenarios=["cap#adds"])],
        scenario_tests={"cap#adds": "tests/test_mod.py::test_mod_adds"},
    )
    write_plan(change, data)
    write(change / "tasks.md", "- [ ] S1 x\n")
    commit_all(git_repo, "artifacts")
    p = run_hook("slice-gate", "start", "S1", "--change-dir", str(change), cwd=git_repo)
    assert p.returncode == 0, p.stderr
    write(git_repo / "src" / "mod.py", src_body)
    write(git_repo / "tests" / "test_mod.py", test_body)
    for rel, text in extra_owned.items():
        write(git_repo / rel, text)
    if extra_file:
        write(git_repo / extra_file, "x = 1\n")
    git(git_repo, "add", "src", "tests", *sorted(extra_owned))  # 执行体纪律：只 add owns 内文件，不裹飞行记录
    git(git_repo, "commit", "-q", "-m", "S1")
    return change


def test_gate_pass_json(git_repo):
    # Given: 已 start 的切片 S1；区间内改了 src/mod.py 与配对测试（含按序 GWT 注释），改动全在 owns 内，scenario 骨架无 xfail
    change = gate_repo(git_repo)

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: stdout 是 JSON 且 ok 为 true、failed 为空、commit 为 HEAD；gate-report.md 追加含 S1 的一行；.openspec-slice 标记被移除
    out = json.loads(p.stdout)
    assert out["ok"] is True, out
    assert out["failed"] == []
    assert out["commit"] == git(git_repo, "rev-parse", "HEAD")
    assert "S1" in (change / "gate-report.md").read_text(encoding="utf-8")
    assert not (git_repo / ".openspec-slice").exists()


def test_gate_ownership_violation(git_repo):
    # Given: 已 start 的切片 S1，区间内的 commit 还改动了 owns 之外的 src/other.py
    change = gate_repo(git_repo, extra_file="src/other.py")

    # When: 运行 gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false，failed 含一项以 G6 开头并点名 src/other.py
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert any(f.startswith("G6") and "src/other.py" in f for f in out["failed"]), out["failed"]


def test_gate_missing_gwt(git_repo):
    # Given: 区间内改动的测试文件里 test_mod_adds 缺少 Then: 注释
    change = gate_repo(git_repo, test_body=BAD_TEST)

    # When: 运行 gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false，failed 含一项以 G4 开头并点名 test_mod_adds
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert any(f.startswith("G4") and "test_mod_adds" in f for f in out["failed"]), out["failed"]


def test_gate_warns_uncommitted_with_full_path(git_repo):
    # Given: 已 start 的切片 S1，commit 之后 src/mod.py 又被改动但未提交（git status 首行带前导空格）
    change = gate_repo(git_repo)
    (git_repo / "src" / "mod.py").write_text("def add(a, b):\n    return a + b  # touched\n", encoding="utf-8")

    # When: 运行 gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: 仍通过（文件在 owns 内），且 warnings 里的路径是完整的 src/mod.py 而不是被截断的
    out = json.loads(p.stdout)
    assert out["ok"] is True, out
    assert any("src/mod.py" in w and "rc/mod.py" not in w.replace("src/mod.py", "") for w in out["warnings"]), out["warnings"]


def test_record_appends_gate_row_idempotently(git_repo):
    # Given: 一份切片门禁 JSON（S1 ok，commit 为某 SHA）
    change = gate_repo(git_repo)
    gate_json = json.dumps({"slice": "S1", "ok": True, "commit": "abc1234def", "failed": [], "warnings": [], "summary": "通过"})

    # When: 用 slice-gate.py record --json 记录两次
    run_hook("slice-gate", "record", "--json", gate_json, "--change-dir", str(change), cwd=git_repo)
    p = run_hook("slice-gate", "record", "--json", gate_json, "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0，gate-report.md 里该 slice+commit 只有一行（幂等），timeline 记了 gate 事件
    assert p.returncode == 0, p.stderr
    rows = [l for l in (change / "gate-report.md").read_text(encoding="utf-8").splitlines() if "abc1234def" in l]
    assert len(rows) == 1
    assert "gate\tS1 ok" in (change / "timeline.md").read_text(encoding="utf-8")


def test_gate_flags_committed_flight_records(git_repo):
    # Given: 已 start 的切片 S1，区间内的 commit 把 change 目录内的 timeline.md 一起提交了（执行体不该提交飞行记录）
    change = gate_repo(git_repo)
    write(change / "timeline.md", "<!-- timeline -->\n2026-09-10T00:00:00Z\tslice-start\tS1\n")
    commit_all(git_repo, "S1 with flight record")

    # When: 运行 gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false，failed 含一项以 G6 开头并点名 timeline.md 属飞行记录
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert any(f.startswith("G6") and "timeline.md" in f for f in out["failed"]), out["failed"]


MULTILINE_XFAIL_TEST = '''
import sys, pathlib
import pytest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from src.mod import add


@pytest.mark.xfail(
    strict=True,
    reason="pending",
)
def test_mod_adds():
    # Given: 两个整数 1 与 2
    a, b = 1, 2
    # When: 调用 add
    result = add(a, b)
    # Then: 返回 4（故意错，让 xfail 成立）
    assert result == 4
'''


def test_final_detects_multiline_xfail(git_repo):
    # Given: scenario 骨架的 xfail 装饰器跨多行（def 的上一行是右括号）
    change = gate_repo(git_repo, test_body=MULTILINE_XFAIL_TEST)

    # When: 运行 slice-gate.py final
    p = run_hook("slice-gate", "final", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false，failed 含 G7 且点名「仍标记 xfail/skip」
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert any(f.startswith("G7") and "xfail" in f for f in out["failed"]), out["failed"]


def test_gate_g5_fails_when_evidence_has_no_rows_for_slice(git_repo):
    # Given: change 目录已有 evidence.log（hooks 在工作），但里面没有本切片 S1 的任何测试运行行
    change = gate_repo(git_repo)
    write(change / "evidence.log", "2026-09-10T00:00:00Z\tS9\tPASS\tpytest -q\n")

    # When: 运行 gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false，failed 含 G5
    out = json.loads(p.stdout)
    assert out["ok"] is False
    assert any(f.startswith("G5") for f in out["failed"]), out["failed"]


def test_gate_g5_warns_when_hooks_missing(git_repo):
    # Given: change 目录没有 evidence.log（hooks 未安装）
    change = gate_repo(git_repo)

    # When: 运行 gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: 仍通过，但 JSON 标 hooks_missing 为 true 且 warnings 含 G5
    out = json.loads(p.stdout)
    assert out["ok"] is True, out
    assert out.get("hooks_missing") is True
    assert any(w.startswith("G5") for w in out["warnings"])


def test_final_gate_reports_scenarios(git_repo):
    # Given: slices.json 把 scenario cap#adds 映射到 tests/test_mod.py::test_mod_adds，且该测试通过、无 xfail
    change = gate_repo(git_repo)

    # When: 运行 slice-gate.py final
    p = run_hook("slice-gate", "final", "--change-dir", str(change), cwd=git_repo)

    # Then: JSON 含 scenarios.total 为 1、scenarios.passed 为 1，且 ok 为 true
    out = json.loads(p.stdout)
    assert out["scenarios"]["total"] == 1
    assert out["scenarios"]["passed"] == 1
    assert out["ok"] is True, out


# 标记一律用拼接构造：本仓自身提交这些夹具时，G8 判据不该把它们当成真标记
CEILING = "ceiling:"
GOOD_CEILING_SRC = (
    "def add(a, b):\n    # %s 只支持两个整数相加 -> 需要小数精度时换 Decimal\n    return a + b\n"
    "\n\ndef sub(a, b):\n    # %s 不做溢出检查 → 出现越界时接入 checked 运算\n    return a - b\n"
) % (CEILING, CEILING)
MISSING_UPGRADE_SRC = "def add(a, b):\n    # %s 先用全局锁\n    return a + b\n" % CEILING
MISSING_LIMIT_SRC = "def add(a, b):\n    # %s -> 以后优化\n    return a + b\n" % CEILING
NO_MARKER_SRC = 'import re\n\nCEILING_RE = re.compile(r"%s")\n\n\ndef add(a, b):\n    return a + b\n' % CEILING


def test_gate_g8_accepts_complete_ceiling(git_repo):
    # Given: 已 start 的切片 S1，区间内新增的源码行含完整 ceiling 标记（限制 -> 升级路径），半角箭头与全角箭头各一条
    change = gate_repo(git_repo, src_body=GOOD_CEILING_SRC)

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: failed 里没有以 G8 开头的项；gate-report.md 的天花板表里半角箭头那条有一行含 src/mod.py:2 与限制、升级路径两段文本；全角箭头那条有一行含 src/mod.py:7 与两段文本
    out = json.loads(p.stdout)
    rows = (change / "gate-report.md").read_text(encoding="utf-8").splitlines()
    assert [f for f in out["failed"] if f.startswith("G8")] == [], out["failed"]
    assert any("src/mod.py:2" in r and "只支持两个整数相加" in r and "需要小数精度时换 Decimal" in r for r in rows), rows
    assert any("src/mod.py:7" in r and "不做溢出检查" in r and "出现越界时接入 checked 运算" in r for r in rows), rows


def test_gate_g8_flags_missing_upgrade_path(git_repo):
    # Given: 区间内新增的源码行含 `# ceiling: 先用全局锁`，只有限制段、无分隔符与升级路径
    change = gate_repo(git_repo, src_body=MISSING_UPGRADE_SRC)

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false；failed 含一项以 G8 ceiling: 开头、点名 src/mod.py:2 并说明缺升级路径、给出期望形状
    out = json.loads(p.stdout)
    assert out["ok"] is False, out
    assert any(f.startswith("G8 ceiling:") and "src/mod.py:2" in f and "升级路径" in f and "限制 -> 升级条件/路径" in f for f in out["failed"]), out["failed"]


def test_gate_g8_flags_missing_limit(git_repo):
    # Given: 区间内新增的源码行含 `# ceiling: -> 以后优化`，有分隔符与升级段但限制段为空
    change = gate_repo(git_repo, src_body=MISSING_LIMIT_SRC)

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: ok 为 false；failed 含一项以 G8 ceiling: 开头并点名 src/mod.py:2 说明缺限制段
    out = json.loads(p.stdout)
    assert out["ok"] is False, out
    assert any(f.startswith("G8 ceiling:") and "src/mod.py:2" in f and "限制" in f for f in out["failed"]), out["failed"]


def test_gate_json_carries_ceilings(git_repo):
    # Given: 已 start 的切片 S1，区间内新增源码含两条完整 ceiling 标记（src/mod.py 第 2 行与第 7 行）
    change = gate_repo(git_repo, src_body=GOOD_CEILING_SRC)

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: JSON 的 ceilings 字段是两条行，分别为 ["src/mod.py", 2, 限制, 升级路径] 与 ["src/mod.py", 7, ...]
    out = json.loads(p.stdout)
    assert out.get("ceilings") == [
        ["src/mod.py", 2, "只支持两个整数相加", "需要小数精度时换 Decimal"],
        ["src/mod.py", 7, "不做溢出检查", "出现越界时接入 checked 运算"],
    ], out.get("ceilings")


def test_record_writes_ceilings_from_gate_json(git_repo):
    # Given: 一份带 ceilings 的切片门禁 JSON（S1 ok、commit abc1234def、天花板行 src/mod.py:2），change 分支上还没有它的门禁行
    change = gate_repo(git_repo)
    gate_json = json.dumps({"slice": "S1", "ok": True, "commit": "abc1234def", "failed": [], "warnings": [],
                            "ceilings": [["src/mod.py", 2, "只支持两个整数相加", "需要小数精度时换 Decimal"]],
                            "summary": "通过"}, ensure_ascii=False)

    # When: 用 slice-gate.py record --json 记录两次
    run_hook("slice-gate", "record", "--json", gate_json, "--change-dir", str(change), cwd=git_repo)
    p = run_hook("slice-gate", "record", "--json", gate_json, "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0；gate-report.md 有天花板表头；含 src/mod.py:2 与限制、升级路径两段的行恰好一条（幂等）
    assert p.returncode == 0, p.stderr
    text = (change / "gate-report.md").read_text(encoding="utf-8")
    rows = [l for l in text.splitlines() if "src/mod.py:2" in l and "只支持两个整数相加" in l and "需要小数精度时换 Decimal" in l]
    assert "## 天花板" in text, text
    assert len(rows) == 1, rows


def test_record_survives_bad_ceiling_lineno(git_repo):
    # Given: ceilings 的行号不是整数（执行体结构化输出可以给出任意形状，GATE schema 的内层元素无类型约束）
    change = gate_repo(git_repo)
    gate_json = json.dumps({"slice": "S1", "ok": True, "commit": "abc1234def", "failed": [], "warnings": [],
                            "ceilings": [["src/mod.py", "第二行", "只支持两个整数相加", "需要小数精度时换 Decimal"],
                                         ["src/mod.py", 7, "不做溢出检查", "出现越界时接入 checked 运算"]],
                            "summary": "通过"}, ensure_ascii=False)

    # When: 用 slice-gate.py record --json 记录
    p = run_hook("slice-gate", "record", "--json", gate_json, "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0 不抛异常；timeline 的 gate 行已写（不停在 append_report 之后的半写态）；坏行号降级为 :0 仍留下天花板文本，好行照常
    assert p.returncode == 0, p.stderr
    assert "S1 ok" in (change / "timeline.md").read_text(encoding="utf-8")
    text = (change / "gate-report.md").read_text(encoding="utf-8")
    assert any("src/mod.py:0" in l and "只支持两个整数相加" in l for l in text.splitlines()), text
    assert any("src/mod.py:7" in l and "不做溢出检查" in l for l in text.splitlines()), text


def test_record_survives_non_iterable_ceilings(git_repo):
    # Given: ceilings 被转写成真值非可迭代标量（回退路径由 integrator 手写 record --json，没有 JS schema 拦这层）
    change = gate_repo(git_repo)
    gate_json = json.dumps({"slice": "S1", "ok": True, "commit": "abc1234def", "failed": [], "warnings": [],
                            "ceilings": 5, "summary": "通过"}, ensure_ascii=False)

    # When: 用 slice-gate.py record --json 记录
    p = run_hook("slice-gate", "record", "--json", gate_json, "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0 不抛 TypeError；门禁行与 timeline 行都写全，不停在半写态
    assert p.returncode == 0, p.stderr
    assert "S1 ok" in (change / "timeline.md").read_text(encoding="utf-8")
    assert "abc1234def" in (change / "gate-report.md").read_text(encoding="utf-8")


def test_gate_g8_silent_without_marker(git_repo):
    # Given: 区间内不含任何 ceiling 标记，但含一条带 ceiling: 字样的非注释代码行与一份 Markdown 里的示例说明
    change = gate_repo(git_repo, src_body=NO_MARKER_SRC, extra_owned={"docs/note.md": "# %s 示例说明\n" % CEILING})

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: failed 与 warnings 里都没有以 G8 开头的项；门禁结论与判据引入前一致（ok 仍为 true）
    out = json.loads(p.stdout)
    assert [x for x in out["failed"] + out["warnings"] if x.startswith("G8")] == [], out
    assert out["ok"] is True, out


# ---------------------------------------------------------------- flight-preflight-and-retry
# （scenario: flight-preflight#* / gate-baseline-diff#* / slice-retry-resume#start-* gate-json-carries-base）



def _baseline_repo(git_repo, verify2="true", lint=None):
    """两片计划：S1/S2 的 verify 可注入；gate.test 用 true；返回 change 目录。"""
    change = git_repo / "openspec" / "changes" / "c"
    data = plan([slice_("S1", ["a/**"]), slice_("S2", ["b/**"], verify=verify2)],
                gate={"test": "true", "lint": lint, "typecheck": None, "full_suite_sec": None})
    write_plan(change, data)
    write(change / "tasks.md", "- [ ] S1 x\n- [ ] S2 y\n")
    commit_all(git_repo, "artifacts")
    return change


LINT_TWO_LINES = "sh -c 'printf \"a.ts(186,41): error TS2339 x\\nb.rs:12: warning y\\n\"; exit 1'"


def test_baseline_writes_gate_baseline(git_repo):
    # Given: gate.test 与两片 verify 在当前树上都退出 0；gate.lint 退出 1 并输出两行
    change = _baseline_repo(git_repo, lint=LINT_TWO_LINES)

    # When: 运行 slice-gate.py baseline
    p = run_hook("slice-gate", "baseline", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0；gate-baseline.json 的 ok 为 true、commit 为 HEAD、plan_sha 40 位；verify 每片 exit 0；lint.exit 1 且 lines 含规范化行；full_suite_sec 仍写回
    assert p.returncode == 0, p.stderr
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    assert bl["ok"] is True and bl["commit"] == git(git_repo, "rev-parse", "HEAD")
    assert len(bl["plan_sha"]) == 40
    assert bl["verify"] == {"S1": {"exit": 0}, "S2": {"exit": 0}}
    assert bl["lint"]["exit"] == 1 and any("a.ts(#,#): error TS# x" == l for l in bl["lint"]["lines"])
    assert json.loads((change / "slices.json").read_text(encoding="utf-8"))["gate"]["full_suite_sec"] is not None


def test_baseline_flags_red_verify(git_repo):
    # Given: S2 的 verify 在当前树上退出 1
    change = _baseline_repo(git_repo, verify2="false")

    # When: 运行 baseline
    p = run_hook("slice-gate", "baseline", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 1；文件与 stdout 的 ok 都为 false，reasons 点名 S2 并说明 verify 在基线上红
    assert p.returncode == 1
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    out = json.loads(p.stdout)
    assert bl["ok"] is False and out["ok"] is False
    assert any("S2" in r and "verify" in r and "基线" in r for r in bl["reasons"])


def test_preflight_refuses_missing_or_red_baseline(git_repo):
    # Given: 合法计划但没有 gate-baseline.json；之后再放一个 ok=false 的基线
    change = _baseline_repo(git_repo)

    # When: 运行 preflight 两次
    p1 = run_hook("slice-gate", "preflight", "--change-dir", str(change), cwd=git_repo)
    write(change / "gate-baseline.json", json.dumps({"ok": False, "reasons": ["S2 verify 在基线上红（exit 1）"], "commit": git(git_repo, "rev-parse", "HEAD"), "plan_sha": "x"}))
    p2 = run_hook("slice-gate", "preflight", "--change-dir", str(change), cwd=git_repo)

    # Then: 两次都非 0；第一次提示先跑 baseline；第二次原样列出 reasons
    assert p1.returncode != 0 and "基线" in p1.stderr and "baseline" in p1.stderr
    assert p2.returncode != 0 and "S2 verify 在基线上红" in p2.stderr


def test_preflight_refuses_stale_baseline(git_repo):
    # Given: baseline 绿之后把 S2 的 verify 改掉（plan_sha 不再匹配）
    change = _baseline_repo(git_repo)
    assert run_hook("slice-gate", "baseline", "--change-dir", str(change), cwd=git_repo).returncode == 0
    data = json.loads((change / "slices.json").read_text(encoding="utf-8"))
    data["slices"][1]["verify"] = "true && true"
    write_plan(change, data)

    # When: 运行 preflight；改回后再运行一次
    p1 = run_hook("slice-gate", "preflight", "--change-dir", str(change), cwd=git_repo)
    data["slices"][1]["verify"] = "true"
    write_plan(change, data)
    p2 = run_hook("slice-gate", "preflight", "--change-dir", str(change), cwd=git_repo)

    # Then: 第一次非 0 且提示过期需重跑 baseline；第二次退出 0 且 stdout 是 waves JSON
    assert p1.returncode != 0 and "过期" in p1.stderr
    assert p2.returncode == 0, p2.stderr
    assert json.loads(p2.stdout) == [["S1", "S2"]]


def test_lint_rejects_verify_embedding_typecheck(tmp_path):
    # Given: S1 的 verify 里嵌了 pnpm typecheck 的 grep
    change = tmp_path / "c"
    data = plan([slice_("S1", ["a/**"], verify="sh -c 'pnpm test && ! (pnpm -s typecheck | grep src/)'")])
    write_plan(change, data)

    # When: 运行 lint；把 verify 改成只跑测试再运行一次
    p1 = run_hook("slice-gate", "lint", "--change-dir", str(change))
    data["slices"][0]["verify"] = "pnpm test"
    write_plan(change, data)
    p2 = run_hook("slice-gate", "lint", "--change-dir", str(change))

    # Then: 第一次非 0，stderr 有以 verify: 开头、点名 S1 并提到 gate.typecheck 的项；第二次通过
    assert p1.returncode != 0
    assert any(l.strip().startswith("- verify:") and "S1" in l and "gate.typecheck" in l for l in p1.stderr.splitlines())
    assert p2.returncode == 0, p2.stderr


def _write_baseline(change, git_repo, lint_lines=None, typecheck_lines=None):
    bl = {"commit": git(git_repo, "rev-parse", "HEAD"), "at": "2026-09-18T00:00:00Z", "plan_sha": "x", "ok": True, "reasons": [],
          "test": {"exit": 0, "sec": 0.1},
          "lint": {"exit": 1, "lines": lint_lines} if lint_lines is not None else None,
          "typecheck": {"exit": 1, "lines": typecheck_lines} if typecheck_lines is not None else None,
          "verify": {"S1": {"exit": 0}}}
    write(change / "gate-baseline.json", json.dumps(bl, ensure_ascii=False))


def _lint_cmd(lines):
    return "sh -c 'printf \"%s\"; exit 1'" % "".join(l + "\\n" for l in lines)


def _set_gate(change, key, cmd):
    data = json.loads((change / "slices.json").read_text(encoding="utf-8"))
    data["gate"][key] = cmd
    write_plan(change, data)


def test_gate_lint_excludes_baseline_lines(git_repo):
    # Given: 已 start 的切片；基线记了 a.ts 的规范化报错；本次 lint 输出同一报错但行列号漂移
    change = gate_repo(git_repo)
    _write_baseline(change, git_repo, lint_lines=["a.ts(#,#): error TS# x"])
    _set_gate(change, "lint", _lint_cmd(["a.ts(190,41): error TS2339 x"]))

    # When: 运行切片门禁
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)
    res = json.loads(p.stdout)

    # Then: failed 无 G2 lint；warnings 有 G2 lint 且含「已按基线排除」
    assert not any(f.startswith("G2 lint") for f in res["failed"]), res["failed"]
    assert any(w.startswith("G2 lint") and "已按基线排除" in w for w in res["warnings"]), res["warnings"]


def test_gate_lint_flags_new_lines_only(git_repo):
    # Given: 同上基线；本次 lint 除既有行外多一行 b.ts 的新错误
    change = gate_repo(git_repo)
    _write_baseline(change, git_repo, lint_lines=["a.ts(#,#): error TS# x"])
    _set_gate(change, "lint", _lint_cmd(["a.ts(190,41): error TS2339 x", "b.ts(3,1): error TS2304 y"]))

    # When: 运行切片门禁
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)
    res = json.loads(p.stdout)

    # Then: ok 为 false；failed 有 G2 lint 项含「新增」与 b.ts，且不含基线里的 a.ts 行
    assert res["ok"] is False
    item = next(f for f in res["failed"] if f.startswith("G2 lint"))
    assert "新增" in item and "b.ts" in item and "a.ts" not in item


def test_gate_lint_red_without_baseline(git_repo):  # 既有行为守卫：判据引入前后都必须通过，故不标 xfail
    # Given: 没有 gate-baseline.json；lint 退出 1
    change = gate_repo(git_repo)
    _set_gate(change, "lint", _lint_cmd(["a.ts(190,41): error TS2339 x"]))

    # When: 运行切片门禁
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)
    res = json.loads(p.stdout)

    # Then: failed 有以 G2 lint: exit 1 开头的项（现行为）；warnings 无「已按基线排除」
    assert any(f.startswith("G2 lint: exit 1") for f in res["failed"]), res["failed"]
    assert not any("已按基线排除" in w for w in res["warnings"])


def test_gate_lint_red_when_baseline_was_green(git_repo):
    # Given: 基线记的 lint 是绿的（exit 0、lines 为 []）；本次 lint 退出 1 且输出一行错误
    change = gate_repo(git_repo)
    _write_baseline(change, git_repo, lint_lines=[])
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    bl["lint"]["exit"] = 0
    write(change / "gate-baseline.json", json.dumps(bl, ensure_ascii=False))
    _set_gate(change, "lint", _lint_cmd(["a.ts(190,41): error TS2339 x"]))

    # When: 运行切片门禁
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)
    res = json.loads(p.stdout)

    # Then: ok 为 false；failed 有以 G2 lint: exit 1 开头且含「基线为绿」的项；warnings 无「已按基线排除」
    assert res["ok"] is False
    assert any(f.startswith("G2 lint: exit 1") and "基线为绿" in f for f in res["failed"]), res["failed"]
    assert not any("已按基线排除" in w for w in res["warnings"])


def test_gate_lint_red_when_output_empty_with_red_baseline(git_repo):
    # Given: 基线记了一行 lint 既有错误（exit 1）；本次 lint 退出 1 但无任何输出（静默型检查器）
    change = gate_repo(git_repo)
    _write_baseline(change, git_repo, lint_lines=["a.ts(#,#): error TS# x"])
    _set_gate(change, "lint", "sh -c 'exit 1'")

    # When: 运行切片门禁
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)
    res = json.loads(p.stdout)

    # Then: ok 为 false；failed 有以 G2 lint: exit 1 开头且含「无输出可与基线比对」的项；warnings 无「已按基线排除」
    assert res["ok"] is False
    assert any(f.startswith("G2 lint: exit 1") and "无输出可与基线比对" in f for f in res["failed"]), res["failed"]
    assert not any("已按基线排除" in w for w in res["warnings"])


def test_baseline_records_empty_lines_for_green_lint(git_repo):
    # Given: gate.lint 在当前树上退出 0 但打印 "All checks passed"
    change = _baseline_repo(git_repo, lint="sh -c 'echo All checks passed; exit 0'")

    # When: 运行 slice-gate.py baseline
    p = run_hook("slice-gate", "baseline", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0；gate-baseline.json 的 lint 为 {"exit": 0, "lines": []}，成功输出不记进基线行
    assert p.returncode == 0, p.stderr
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    assert bl["lint"] == {"exit": 0, "lines": []}


def test_final_typecheck_excludes_baseline_lines(git_repo):
    # Given: 基线记了两行 typecheck 既有错误；final 时 typecheck 输出这两行（行号漂移）；之后再多一行
    change = gate_repo(git_repo)
    _write_baseline(change, git_repo, typecheck_lines=["a.ts(#,#): error TS# x", "b.ts(#,#): error TS# y"])
    _set_gate(change, "typecheck", _lint_cmd(["a.ts(200,1): error TS2339 x", "b.ts(9,9): error TS2304 y"]))

    # When: 运行 final 两次（第二次多一行新错误）
    r1 = json.loads(run_hook("slice-gate", "final", "--change-dir", str(change), cwd=git_repo).stdout)
    _set_gate(change, "typecheck", _lint_cmd(["a.ts(200,1): error TS2339 x", "b.ts(9,9): error TS2304 y", "c.ts(1,1): error TS1005 z"]))
    r2 = json.loads(run_hook("slice-gate", "final", "--change-dir", str(change), cwd=git_repo).stdout)

    # Then: 第一次无 G2 typecheck 失败且 warnings 含「已按基线排除」；第二次 failed 有含「新增」的 G2 typecheck 项
    assert not any(f.startswith("G2 typecheck") for f in r1["failed"]), r1["failed"]
    assert any("已按基线排除" in w for w in r1["warnings"])
    assert any(f.startswith("G2 typecheck") and "新增" in f for f in r2["failed"]), r2["failed"]


def test_start_keeps_marker_for_same_slice(git_repo):
    # Given: 标记为 S1、base 为 X、red_count 为 1；之后又有一个新 commit
    change = gate_repo(git_repo)
    marker_path = git_repo / ".openspec-slice"
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    base_x = marker["base"]
    marker["red_count"] = 1
    marker_path.write_text(json.dumps(marker), encoding="utf-8")
    write(git_repo / "src" / "more.py", "y = 2\n")
    commit_all(git_repo, "more")

    # When: 再次 start S1
    p = run_hook("slice-gate", "start", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: 退出 0；base 与 red_count 不变；timeline 最后一行是 slice-start 且备注含 S1 与 resume
    assert p.returncode == 0, p.stderr
    after = json.loads(marker_path.read_text(encoding="utf-8"))
    assert after["base"] == base_x and after["red_count"] == 1
    last = (change / "timeline.md").read_text(encoding="utf-8").strip().splitlines()[-1]
    assert "\tslice-start\t" in last and "S1" in last and "resume" in last


def test_start_accepts_base_flag(git_repo):
    # Given: 没有标记；X 是 HEAD 的父 commit
    change = gate_repo(git_repo)
    (git_repo / ".openspec-slice").unlink()
    parent = git(git_repo, "rev-parse", "HEAD~1")

    # When: start S1 --base X；删标记后再不带 --base start 一次
    p1 = run_hook("slice-gate", "start", "S1", "--change-dir", str(change), "--base", parent, cwd=git_repo)
    m1 = json.loads((git_repo / ".openspec-slice").read_text(encoding="utf-8"))
    (git_repo / ".openspec-slice").unlink()
    run_hook("slice-gate", "start", "S1", "--change-dir", str(change), cwd=git_repo)
    m2 = json.loads((git_repo / ".openspec-slice").read_text(encoding="utf-8"))

    # Then: 带 --base 时 base 为 X；不带时仍为 HEAD
    assert p1.returncode == 0, p1.stderr
    assert m1["base"] == parent
    assert m2["base"] == git(git_repo, "rev-parse", "HEAD")


def test_gate_json_carries_base(git_repo):
    # Given: 已 start 的切片，标记 base 为 X
    change = gate_repo(git_repo)
    base_x = json.loads((git_repo / ".openspec-slice").read_text(encoding="utf-8"))["base"]

    # When: 运行切片门禁
    res = json.loads(run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo).stdout)

    # Then: JSON 含 base 等于 X；commit 仍为 HEAD
    assert res["base"] == base_x
    assert res["commit"] == git(git_repo, "rev-parse", "HEAD")


# ---------------------------------------------------------------- flight-wave-fixes（scenario: slice-base-check#start-*）
# 骨架：xfail(strict) 直到 S1 实现 start --expect-branch；执行体去掉标记即解锁。


def _branch_repo(git_repo):
    """change 计划已提交；分支 worktree-c 指向当前 HEAD（即 change 分支的最新 commit）。返回 change 目录。"""
    change = write_plan(git_repo / "openspec" / "changes" / "c", plan([slice_("S1", ["src/**"])]))
    commit_all(git_repo, "plan")
    git(git_repo, "branch", "worktree-c")
    return change


def _marker(git_repo):
    return json.loads((git_repo / ".openspec-slice").read_text(encoding="utf-8"))


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S1 未实现：start --expect-branch")
def test_start_expect_branch_accepts_tip(git_repo):
    # Given: worktree 的 HEAD 正是 change 分支 worktree-c 的最新 commit（临时 worktree 从最新 tip 分叉）
    change = _branch_repo(git_repo)

    # When: start S1 --expect-branch worktree-c
    p = run_hook("slice-gate", "start", "S1", "--change-dir", str(change), "--expect-branch", "worktree-c", cwd=git_repo)

    # Then: 退出 0；标记的 slice 为 S1、base 为 HEAD
    assert p.returncode == 0, p.stderr
    marker = _marker(git_repo)
    assert marker["slice"] == "S1" and marker["base"] == git(git_repo, "rev-parse", "HEAD")


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S1 未实现：start --expect-branch")
def test_start_expect_branch_accepts_descendant(git_repo):
    # Given: 分支 worktree-c 指向 T；HEAD 在 T 之上多一个 commit（重试时 cherry-pick 了上一轮的 commit）
    change = _branch_repo(git_repo)
    tip = git(git_repo, "rev-parse", "worktree-c")
    write(git_repo / "src" / "mod.py", "x = 1\n")
    commit_all(git_repo, "previous round")

    # When: start S1 --base T --expect-branch worktree-c
    p = run_hook("slice-gate", "start", "S1", "--change-dir", str(change), "--base", tip,
                 "--expect-branch", "worktree-c", cwd=git_repo)

    # Then: 退出 0；标记的 base 为 T（祖先关系成立即放行，不要求 HEAD 等于 tip）
    assert p.returncode == 0, p.stderr
    assert _marker(git_repo)["base"] == tip


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S1 未实现：start --expect-branch")
def test_start_expect_branch_refuses_stale_base(git_repo):
    # Given: 分支 worktree-c 已前进一个 commit（wave 1 合回），HEAD 仍停在它之前的 commit；另有一个不存在的分支名
    change = _branch_repo(git_repo)
    git(git_repo, "checkout", "-q", "worktree-c")
    write(git_repo / "src" / "merged.py", "y = 2\n")
    commit_all(git_repo, "integrate wave 1")
    git(git_repo, "checkout", "-q", "main")

    # When: 分别以 --expect-branch worktree-c 与 --expect-branch no-such-branch 运行 start S1
    runs = [(name, run_hook("slice-gate", "start", "S1", "--change-dir", str(change), "--expect-branch", name, cwd=git_repo))
            for name in ("worktree-c", "no-such-branch")]

    # Then: 两次都退出非 0，stdout 是 G0 JSON（slice S1 · ok false · commit 空串 · failed 首项以 G0 base 开头并点名分支）；不写标记；随后 gate 因无 base 退出非 0
    for name, p in runs:
        assert p.returncode != 0 and p.stdout.strip().startswith("{"), (name, p.returncode, p.stdout, p.stderr)
        res = json.loads(p.stdout)
        assert res["slice"] == "S1" and res["ok"] is False and res["commit"] == "", res
        assert res["failed"][0].startswith("G0 base") and name in res["failed"][0], res["failed"]
    assert not (git_repo / ".openspec-slice").exists()
    assert run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo).returncode != 0
