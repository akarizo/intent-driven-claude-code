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


def test_gate_g8_silent_without_marker(git_repo):
    # Given: 区间内不含任何 ceiling 标记，但含一条带 ceiling: 字样的非注释代码行与一份 Markdown 里的示例说明
    change = gate_repo(git_repo, src_body=NO_MARKER_SRC, extra_owned={"docs/note.md": "# %s 示例说明\n" % CEILING})

    # When: 运行 slice-gate.py gate S1
    p = run_hook("slice-gate", "gate", "S1", "--change-dir", str(change), cwd=git_repo)

    # Then: failed 与 warnings 里都没有以 G8 开头的项；门禁结论与判据引入前一致（ok 仍为 true）
    out = json.loads(p.stdout)
    assert [x for x in out["failed"] + out["warnings"] if x.startswith("G8")] == [], out
    assert out["ok"] is True, out
