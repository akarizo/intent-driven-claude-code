"""slices.json 的 artifact_files：lint 校验与审批面板（scenario: flight-takeoff-artifact-files#lint-* / approval-page-lists-artifact-files）。"""
import json

import pytest

from conftest import run_hook, write
from test_slice_gate import plan, slice_, write_plan
from test_spec_html import artifacts, render

SECTION = "起飞时一并提交的周边文件"


def plan_with(change_dir, files):
    data = plan([slice_("S1", ["a/**"])])
    if files is not None:
        data["artifact_files"] = files
    return write_plan(change_dir, data)


def test_lint_accepts_plan_with_or_without_artifact_files(tmp_path):
    # Given: 两份合法计划：一份没有 artifact_files，一份为 tests/helpers.py、openspec/adr/INDEX.md、openspec/adr/DRAFT-x.md
    bare = plan_with(tmp_path / "a" / "openspec" / "changes" / "c", None)
    declared = plan_with(tmp_path / "b" / "openspec" / "changes" / "c",
                         ["tests/helpers.py", "openspec/adr/INDEX.md", "openspec/adr/DRAFT-x.md"])

    # When: 分别运行 slice-gate.py lint
    results = [run_hook("slice-gate", "lint", "--change-dir", str(d)) for d in (bare, declared)]

    # Then: 两次都退出 0
    for p in results:
        assert p.returncode == 0, p.stderr


def test_lint_rejects_bad_artifact_files(tmp_path):
    # Given: artifact_files 依次为字符串、含数字、含空串、绝对路径、含 .. 段、含通配符、已编号 ADR
    cases = [
        ("tests/a.py", None),
        ([1], None),
        ([""], None),
        (["/abs/a.py"], "/abs/a.py"),
        (["tests/../a.py"], "tests/../a.py"),
        (["tests/*.py"], "tests/*.py"),
        (["openspec/adr/0007-x.md"], "openspec/adr/0007-x.md"),
    ]

    for i, (files, shown) in enumerate(cases):
        change = plan_with(tmp_path / str(i) / "openspec" / "changes" / "c", files)

        # When: 运行 slice-gate.py lint
        p = run_hook("slice-gate", "lint", "--change-dir", str(change))

        # Then: 非 0 退出、stderr 含 artifact_files:；逐项的情形 stderr 含该项原值
        assert p.returncode != 0, (files, p.stdout)
        assert "artifact_files:" in p.stderr, (files, p.stderr)
        if shown is not None:
            assert shown in p.stderr, (files, p.stderr)


def test_approval_page_lists_artifact_files(tmp_path):
    # Given: 一份 slices.json 的 artifact_files 为 tests/helpers.py 与 openspec/adr/INDEX.md，另一份没有该字段
    pages = []
    for name, files in (("declared", ["tests/helpers.py", "openspec/adr/INDEX.md"]), ("bare", None)):
        change = artifacts(tmp_path / name / "openspec" / "changes" / "add-export")
        data = {
            "version": 1, "change": "add-export", "gate": {"test": "pytest -q"},
            "slices": [{"id": "S1", "title": "数据模型", "scenarios": [], "owns": ["app/x.py"], "deps": [], "verify": "pytest -q"}],
            "scenario_tests": {},
        }
        if files is not None:
            data["artifact_files"] = files
        write(change / "slices.json", json.dumps(data, ensure_ascii=False))
        out = tmp_path / name / "spec.html"

        # When: 分别渲染 spec.html
        p = render(change, out)
        assert p.returncode == 0, p.stderr
        pages.append(out.read_text(encoding="utf-8"))

    # Then: 前者含该节标题与两个路径；后者不含该节标题
    declared, bare = pages
    assert SECTION in declared
    assert "tests/helpers.py" in declared and "openspec/adr/INDEX.md" in declared
    assert SECTION not in bare
