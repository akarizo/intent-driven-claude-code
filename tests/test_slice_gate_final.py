"""slice-gate final 先判 G7、gate.test 按基线逐条差分（scenario: final-gate-fastpath#final-skips-* / final-runs-*，test-gate-baseline-diff#*）。
骨架：每个 scenario 一个 strict xfail，断言是真实的；切片 S1 实现后去掉标记即解锁。"""
import json
import shlex
import sys

import pytest

from conftest import commit_all, git, run_hook, write
from test_slice_gate import plan, slice_, write_plan

PYTEST = "%s -m pytest -q tests" % shlex.quote(sys.executable)
PASSING = "def test_adds():\n    assert 1 + 1 == 2\n"
STILL_XFAIL = (
    "import pytest\n\n\n"
    "@pytest.mark.xfail(strict=True, reason=\"pending\")\n"
    "def test_adds():\n    assert 1 + 1 == 3\n"
)
ORDERED = (
    "def test_adds():\n"
    "    with open('order.log', 'a', encoding='utf-8') as f:\n"
    "        f.write('g7\\n')\n"
    "    assert 1 + 1 == 2\n"
)
OLD_RED = "def test_old():\n    assert False\n"
NEW_RED = "def test_new():\n    assert False\n"


def _repo(git_repo, gate_test, cap_test=PASSING, lint=None, files=None):
    """单片计划：cap#adds → tests/test_cap.py::test_adds；gate.test / gate.lint 可注入；返回 change 目录。"""
    change = git_repo / "openspec" / "changes" / "c"
    data = plan(
        [slice_("S1", ["src/**", "tests/**"], scenarios=["cap#adds"])],
        gate={"test": gate_test, "lint": lint, "typecheck": None, "full_suite_sec": None},
        scenario_tests={"cap#adds": "tests/test_cap.py::test_adds"},
    )
    write_plan(change, data)
    write(git_repo / "tests" / "test_cap.py", cap_test)
    for rel, text in (files or {}).items():
        write(git_repo / rel, text)
    commit_all(git_repo, "artifacts")
    return change


def _final(git_repo, change):
    p = run_hook("slice-gate", "final", "--change-dir", str(change), cwd=git_repo)
    return json.loads(p.stdout)


def _baseline(git_repo, change):
    return run_hook("slice-gate", "baseline", "--change-dir", str(change), cwd=git_repo)


def test_final_skips_full_suite_when_g7_red(git_repo):
    # Given: cap#adds 的测试仍带 strict xfail；gate.test 运行时写下 ran-g2，gate.lint 运行时写下 ran-lint
    change = _repo(git_repo, "touch ran-g2", cap_test=STILL_XFAIL, lint="touch ran-lint")

    # When: 运行 slice-gate.py final
    out = _final(git_repo, change)

    # Then: ok 为 false 且 failed 含点名 cap#adds 的 G7 项；全量没跑、lint 照跑；warnings 含「G2 全量未跑」
    assert out["ok"] is False
    assert any(f.startswith("G7") and "cap#adds" in f for f in out["failed"]), out["failed"]
    assert not (git_repo / "ran-g2").exists()
    assert (git_repo / "ran-lint").exists()
    assert any("G2 全量未跑" in w for w in out["warnings"]), out["warnings"]


def test_final_runs_g7_before_full_suite(git_repo):
    # Given: cap#adds 的测试通过、运行时向 order.log 追加 g7；gate.test 运行时向 order.log 追加 g2
    change = _repo(git_repo, "echo g2 >> order.log", cap_test=ORDERED)

    # When: 运行 slice-gate.py final
    out = _final(git_repo, change)

    # Then: ok 为 true；order.log 依次为 g7、g2
    assert out["ok"] is True, out
    assert (git_repo / "order.log").read_text(encoding="utf-8").split() == ["g7", "g2"]


def test_baseline_records_preexisting_failures(git_repo):
    # Given: gate.test 为 pytest；tests 里 test_old 失败、其余通过
    change = _repo(git_repo, PYTEST, files={"tests/test_old.py": OLD_RED})

    # When: 运行 slice-gate.py baseline
    p = _baseline(git_repo, change)

    # Then: 退出 0；gate-baseline.json 的 ok 为 true，test.failed 恰 1 条且含 test_old；warnings 含「预存红」
    assert p.returncode == 0, p.stdout + p.stderr
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    assert bl["ok"] is True
    assert len(bl["test"]["failed"]) == 1 and "test_old" in bl["test"]["failed"][0], bl["test"]
    assert any("预存红" in w for w in bl.get("warnings") or []), bl.get("warnings")


def test_final_excludes_baseline_failures(git_repo):
    # Given: 上述基线已生成；test_old 仍失败，cap#adds 的测试通过
    change = _repo(git_repo, PYTEST, files={"tests/test_old.py": OLD_RED})
    assert _baseline(git_repo, change).returncode == 0

    # When: 运行 slice-gate.py final
    out = _final(git_repo, change)

    # Then: ok 为 true，warnings 含「按基线排除」
    assert out["ok"] is True, out
    assert any("按基线排除" in w for w in out["warnings"]), out["warnings"]


def test_final_flags_new_failures(git_repo):
    # Given: 上述基线已生成；又新增一个失败的 test_new
    change = _repo(git_repo, PYTEST, files={"tests/test_old.py": OLD_RED})
    assert _baseline(git_repo, change).returncode == 0
    write(git_repo / "tests" / "test_new.py", NEW_RED)

    # When: 运行 slice-gate.py final
    out = _final(git_repo, change)

    # Then: ok 为 false；failed 有一项以「G2 test」开头、含「新增」与 test_new、不含 test_old
    assert out["ok"] is False
    g2 = [f for f in out["failed"] if f.startswith("G2 test")]
    assert len(g2) == 1, out["failed"]
    assert "新增" in g2[0] and "test_new" in g2[0] and "test_old" not in g2[0], g2[0]


def test_diff_falls_back_when_unmeasurable(git_repo):
    # Given: gate.test 先后运行两次 pytest（输出两行汇总），其中有失败
    change = _repo(git_repo, "%s; %s" % (PYTEST, PYTEST), files={"tests/test_old.py": OLD_RED})

    # When: 运行 slice-gate.py baseline
    p = _baseline(git_repo, change)

    # Then: 退出 1；reasons 有一项含「按退出码」与「汇总行」
    assert p.returncode == 1, p.stdout + p.stderr
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    assert any("按退出码" in r and "汇总行" in r for r in bl["reasons"]), bl["reasons"]


def test_non_pytest_gate_keeps_exit_code(git_repo):
    # Given: gate.test 为 sh -c 'exit 1'
    change = _repo(git_repo, "sh -c 'exit 1'")

    # When: 运行 slice-gate.py baseline
    p = _baseline(git_repo, change)

    # Then: 退出 1；reasons 有一项含「exit 1」与「按退出码」
    assert p.returncode == 1, p.stdout + p.stderr
    bl = json.loads((change / "gate-baseline.json").read_text(encoding="utf-8"))
    assert any("exit 1" in r and "按退出码" in r for r in bl["reasons"]), bl["reasons"]


FORCE_EXIT_1 = (
    "def pytest_sessionfinish(session, exitstatus):\n"
    "    session.exitstatus = 1\n"
)


def test_exit_1_without_failures_is_red(git_repo):
    # Given: gate.test 为 pytest；全部用例通过，但 tests/conftest.py 在 sessionfinish 把 exitstatus 设成 1
    change = _repo(git_repo, PYTEST, files={"tests/conftest.py": FORCE_EXIT_1})

    # When: 运行 slice-gate.py final
    out = _final(git_repo, change)

    # Then: ok 为 false；failed 有一项以「G2 test」开头且含「按退出码判」
    assert out["ok"] is False, out
    assert any(f.startswith("G2 test") and "按退出码判" in f for f in out["failed"]), out["failed"]


# ---------------------------------------------------------------- flight-unattended S2（骨架：实现后去掉 xfail 标记）


def _final_integ(git_repo, change, base):
    """带 --integ-base 跑 final，返回 JSON。"""
    p = run_hook("slice-gate", "final", "--change-dir", str(change), "--integ-base", base, cwd=git_repo)
    return json.loads(p.stdout)


def _g9(out):
    return [f for f in out["failed"] if f.startswith("G9 integ:")]


def _branch_from(git_repo, name, base):
    git(git_repo, "checkout", "-q", "-b", name, base)


def test_guard_rejects_artifact_and_scenario_edits(git_repo):
    # Given: 单片计划 cap#adds → tests/test_cap.py::test_adds，gate.test 恒绿；base 之后分支甲改了 specs/cap/spec.md 与 slices.json，
    #        分支乙改了 test_adds 函数体里的一行
    change = _repo(git_repo, "true")
    base = git(git_repo, "rev-parse", "HEAD")
    _branch_from(git_repo, "jia", base)
    write(change / "specs" / "cap" / "spec.md", "## ADDED Requirements\n")
    data = json.loads((change / "slices.json").read_text(encoding="utf-8"))
    data["slices"][0]["title"] = "改过的标题"
    (change / "slices.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    commit_all(git_repo, "jia")

    # When: 甲上带 --integ-base 与不带各跑一次 final；切到乙再带 --integ-base 跑一次
    jia = _final_integ(git_repo, change, base)
    plain = _final(git_repo, change)
    _branch_from(git_repo, "yi", base)
    write(git_repo / "tests" / "test_cap.py", PASSING.replace("1 + 1 == 2", "2 + 0 == 2"))
    commit_all(git_repo, "yi")
    yi = _final_integ(git_repo, change, base)

    # Then: 甲的 G9 项点名 specs/cap/spec.md 与 slices.json；乙的 G9 项点名 test_adds；不带 --integ-base 时没有 G9 项
    assert any("specs/cap/spec.md" in f for f in _g9(jia)), jia
    assert any("slices.json" in f for f in _g9(jia)), jia
    assert any("test_adds" in f for f in _g9(yi)), yi
    assert not [f for f in plain["failed"] if f.startswith("G9")], plain


def test_guard_rejects_weakened_tests(git_repo):
    # Given: 同一单片计划，另有 tests/test_b.py（test_b1 两行 assert、test_b2 一行 assert）与 src/x.py；base 之后四个分支：
    #        甲删两行 assert 只加一行；乙给 test_b2 加 @pytest.mark.skip；丙删掉 test_b2；丁改 src/x.py 并新增带 assert 的 test_b3
    test_b = "import pytest\n\n\ndef test_b1():\n    assert 1\n    assert 2\n\n\ndef test_b2():\n    assert 3\n"
    change = _repo(git_repo, "true", files={"tests/test_b.py": test_b, "src/x.py": "X = 1\n"})
    base = git(git_repo, "rev-parse", "HEAD")
    variants = {
        "jia": {"tests/test_b.py": test_b.replace("    assert 1\n    assert 2\n", "    assert 1 and 2\n")},
        "yi": {"tests/test_b.py": test_b.replace("def test_b2", "@pytest.mark.skip(reason='x')\ndef test_b2")},
        "bing": {"tests/test_b.py": test_b.split("\n\n\ndef test_b2")[0] + "\n"},
        "ding": {"src/x.py": "X = 2\n", "tests/test_b.py": test_b + "\n\ndef test_b3():\n    assert 4\n"},
    }

    # When: 每个分支从 base 切出、提交后带 --integ-base 跑 final
    outs = {}
    for name, files in variants.items():
        _branch_from(git_repo, name, base)
        for rel, text in files.items():
            write(git_repo / rel, text)
        commit_all(git_repo, name)
        outs[name] = _final_integ(git_repo, change, base)

    # Then: 甲、乙、丙各有 G9 项，分别点出 assert、skip、测试函数；丁没有 G9 项
    assert any("assert" in f for f in _g9(outs["jia"])), outs["jia"]
    assert any("skip" in f for f in _g9(outs["yi"])), outs["yi"]
    assert any("测试函数" in f for f in _g9(outs["bing"])), outs["bing"]
    assert not _g9(outs["ding"]), outs["ding"]


def test_features_declare_integ_guard():
    # Given: 本仓库的 slice-gate.py
    # When: 运行 slice-gate.py features
    p = run_hook("slice-gate", "features")

    # Then: 以 0 退出，输出的某一行恰为 integ-guard
    assert p.returncode == 0, p.stderr
    assert "integ-guard" in p.stdout.split(), p.stdout
