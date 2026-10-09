"""计划指纹（scenario: plan-fingerprint#*）。骨架：S1 实现 plan_fp.py 后逐条去掉 xfail 标记。"""
import json
import re

import pytest

from conftest import make_change, run_hook, write


EXECUTION_RECORDS = ("spec.html", "timeline.md", "gate-report.md", "gate-baseline.json", "evidence.log",
                     "review-findings.json", ".flight", "slices/_interfaces.md")


def fp(change_dir, *flags):
    p = run_hook("plan_fp", "--change-dir", str(change_dir), *flags)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def edit_slices(change_dir, mutate):
    path = change_dir / "slices.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    mutate(data)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_fp_ignores_execution_records(tmp_path):
    # Given: 计划工件齐全的 change 目录及其指纹 F
    d = make_change(tmp_path)
    before = fp(d)

    # When: 勾选 tasks.md，并写入全部执行记录类文件
    (d / "tasks.md").write_text("- [x] S1 t\n", encoding="utf-8")
    for rel in EXECUTION_RECORDS:
        write(d / rel, "changed %s\n" % rel)

    # Then: 指纹仍等于 F
    assert fp(d) == before


def test_fp_changes_on_plan_edit(tmp_path):
    # Given: 五份相同的 change 目录，各自记下指纹
    def append(rel):
        return lambda d: (d / rel).write_text((d / rel).read_text(encoding="utf-8") + "改\n", encoding="utf-8")

    edits = {
        "proposal": append("proposal.md"),
        "design": append("design.md"),
        "spec": append("specs/cap/spec.md"),
        "owns": lambda d: edit_slices(d, lambda s: s["slices"][0]["owns"].append("b.py")),
        "packet": append("slices/S1.md"),
    }

    # When: 每份只改一处计划内容后重算指纹
    changed = {}
    for i, (label, mutate) in enumerate(edits.items()):
        d = make_change(tmp_path / str(i))
        base = fp(d)
        mutate(d)
        changed[label] = fp(d) != base

    # Then: 每一处改动都让指纹变化
    assert changed == {label: True for label in edits}, changed


def test_fp_ignores_measured_suite_time(tmp_path):
    # Given: change 目录及其指纹 F（slices.json 的 gate.full_suite_sec 为 9.6）
    d = make_change(tmp_path)
    before = fp(d)

    # When: 基线把实测耗时改写为 12.3
    edit_slices(d, lambda s: s["gate"].__setitem__("full_suite_sec", 12.3))

    # Then: 指纹仍等于 F
    assert fp(d) == before


def test_fp_normalizes_line_endings(tmp_path):
    # Given: 内容相同的两份 change，第二份所有计划文本改用 CRLF
    lf = make_change(tmp_path / "lf")
    crlf = make_change(tmp_path / "crlf")
    for rel in ("proposal.md", "design.md", "specs/cap/spec.md", "slices.json", "slices/S1.md"):
        path = crlf / rel
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))

    # When: 分别计算指纹
    a, b = fp(lf), fp(crlf)

    # Then: 两个指纹相等
    assert a == b


def test_fp_cli_short_is_prefix(tmp_path):
    # Given: 计划工件齐全的 change 目录，以及一个不存在的目录
    d = make_change(tmp_path)
    missing = tmp_path / "nope"

    # When: 默认与 --short 各跑一次，再对不存在的目录跑一次
    full, short = fp(d), fp(d, "--short")
    bad = run_hook("plan_fp", "--change-dir", str(missing))

    # Then: 默认是 64 位小写十六进制，--short 是其前 8 位；不存在的目录以 2 退出且 stderr 非空
    assert re.fullmatch(r"[0-9a-f]{64}", full), full
    assert short == full[:8]
    assert bad.returncode == 2 and bad.stderr.strip()


# ---------------------------------------------------------------- flight-integrity-fixes（scenario: approval-chain-hardening#plan-fp-escapes-glob-metachars）
# 骨架：S4 实现后去掉 xfail 标记。

@pytest.mark.xfail(strict=True, reason="S4 未实现 glob 转义")
def test_plan_fp_escapes_glob_metachars(tmp_path):
    # Given: change 目录位于路径含 [ 与 ] 的目录「My [Projects]」下
    d = make_change(tmp_path / "My [Projects]")

    # When: 先算一次指纹，再改 specs/cap/spec.md 后再算一次
    before = fp(d)
    spec = d / "specs" / "cap" / "spec.md"
    spec.write_text(spec.read_text(encoding="utf-8") + "- **AND** 新增一步\n", encoding="utf-8")
    after = fp(d)

    # Then: 两次指纹不同
    assert before != after
