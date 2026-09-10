"""slice-gate.py ship：飞行收口的机械 draft / ready 裁决（scenario: ship-verdict#*）。"""
import json
import re

from conftest import ROOT, commit_all, git, run_hook, write

CMD = ROOT / "template" / ".claude" / "commands"
SKILL = ROOT / "template" / ".claude" / "skills" / "openspec-apply-change" / "SKILL.md"
WORKFLOW = ROOT / "template" / ".claude" / "workflows" / "opsx-apply.js"


def ship_repo(git_repo, slice_verdict="ok", final_verdict="ok", final_at_head=True, findings=None, plan=True):
    """造一个已提交工件的仓库：slices.json（S1）+ gate-report.md + 可选 review-findings.json。返回 change 目录。"""
    change = git_repo / "openspec" / "changes" / "c"
    if plan:
        write(change / "slices.json", json.dumps({
            "version": 1, "change": "c", "gate": {"test": "true"},
            "slices": [{"id": "S1", "title": "S1", "scenarios": [], "owns": ["src/**"], "deps": [], "verify": "true", "packet": "slices/S1.md"}],
            "scenario_tests": {},
        }))
    else:
        write(change / "tasks.md", "- [ ] x\n")
    head = commit_all(git_repo, "artifacts")
    final_commit = head[:10] if final_at_head else "0000000000"
    rows = ["# Gate Report", "", "| 时间 | 切片 | 结论 | commit | failed | warnings |", "|---|---|---|---|---|---|"]
    if slice_verdict:
        rows.append("| 2026-09-10T00:00:00Z | S1 | red | %s | G2 test: exit 1 | - |" % head[:10])
        rows.append("| 2026-09-10T00:01:00Z | S1 | %s | %s | %s | - |" % (slice_verdict, head[:10], "-" if slice_verdict == "ok" else "G4 gwt: test_x"))
    if final_verdict:
        rows.append("| 2026-09-10T00:02:00Z | final | %s | %s | %s | - |" % (final_verdict, final_commit, "-" if final_verdict == "ok" else "G2 test: exit 1"))
    write(change / "gate-report.md", "\n".join(rows) + "\n")
    if findings is not None:
        write(change / "review-findings.json", json.dumps(findings))
    return change


def ship(git_repo, change, *extra):
    return run_hook("slice-gate", "ship", "--change-dir", str(change), *extra, cwd=git_repo)


def test_ship_ready_when_all_green_at_head(git_repo):
    """scenario: ship-verdict#全绿对齐 HEAD 判 ready"""
    # Given: S1 最新行 ok、final ok 且 commit 为 HEAD、无 review-findings.json
    change = ship_repo(git_repo)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 true、reasons 为空、退出码 0；timeline 记了 ship 事件
    out = json.loads(p.stdout)
    assert out["ready"] is True, out
    assert out["reasons"] == []
    assert p.returncode == 0
    assert "\tship\tready" in (change / "timeline.md").read_text(encoding="utf-8")


def test_ship_draft_when_slice_red(git_repo):
    """scenario: ship-verdict#切片门禁红判 draft"""
    # Given: S1 最新行 red（更早一行 ok 不算数），final ok 对齐 HEAD
    change = ship_repo(git_repo, slice_verdict="red")

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false，reasons 有一条点名 S1，退出码 1
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("S1" in r for r in out["reasons"]), out["reasons"]
    assert p.returncode == 1


def test_ship_draft_when_slice_has_no_row(git_repo):
    """scenario: ship-verdict#切片门禁红判 draft（无记录变体）"""
    # Given: slices.json 有 S1 但 gate-report.md 没有 S1 的任何行
    change = ship_repo(git_repo, slice_verdict=None)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false 且 reasons 点名 S1 无门禁记录
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("S1" in r and "无门禁记录" in r for r in out["reasons"]), out["reasons"]


def test_ship_draft_when_final_stale(git_repo):
    """scenario: ship-verdict#final 过期判 draft"""
    # Given: final 最新行 ok 但 commit 不是 HEAD
    change = ship_repo(git_repo, final_at_head=False)
    head = git(git_repo, "rev-parse", "HEAD")

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false；reasons 有一条同时含「过期」、记录 commit 与 HEAD 前缀
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("过期" in r and "0000000000" in r and head[:10] in r for r in out["reasons"]), out["reasons"]


def test_ship_draft_when_final_missing(git_repo):
    """scenario: ship-verdict#final 过期判 draft（未运行变体）"""
    # Given: gate-report.md 没有 final 行
    change = ship_repo(git_repo, final_verdict=None)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false 且 reasons 指出 final 未运行
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("final" in r and "未运行" in r for r in out["reasons"]), out["reasons"]


def test_ship_draft_when_blocking_findings_open(git_repo):
    """scenario: ship-verdict#阻断 finding 未闭环判 draft"""
    # Given: 门禁全绿对齐 HEAD；review-findings.json 的 blocking 含 1 条
    change = ship_repo(git_repo, findings={"blocked": [], "blocking": [{"severity": "HIGH", "file": "a.py", "line": 1, "summary": "x"}], "deferred": [], "fix": None})

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false 且 reasons 给出数量 1 与 CRITICAL/HIGH 字样
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("1" in r and "CRITICAL/HIGH" in r for r in out["reasons"]), out["reasons"]


def test_ship_blocked_is_informational_only(git_repo):
    """scenario: ship-verdict#blocked 只作说明不作裁决"""
    # Given: 门禁全绿对齐 HEAD；review-findings.json 的 blocked 含一条 kind=infra
    blocked = [{"slice": "wave1", "kind": "infra", "reason": "integrator 未返回"}]
    change = ship_repo(git_repo, findings={"blocked": blocked, "blocking": [], "deferred": [], "fix": None})

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 true，blocked 原样带出
    out = json.loads(p.stdout)
    assert out["ready"] is True, out
    assert out["blocked"] == blocked
    assert p.returncode == 0


def test_ship_ready_without_plan(git_repo):
    """scenario: ship-verdict#非飞行模式直接 ready"""
    # Given: change 目录没有 slices.json
    change = ship_repo(git_repo, plan=False, slice_verdict=None, final_verdict=None)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 true 且退出码 0
    out = json.loads(p.stdout)
    assert out["ready"] is True, out
    assert p.returncode == 0


def test_ship_markdown_lists_reasons_and_blocked(git_repo):
    """scenario: ship-verdict#draft 时输出 reasons 段落"""
    # Given: S1 红 + 1 条阻断 finding（两条 reasons），blocked 含一条 gate 条目
    blocked = [{"slice": "S1", "kind": "gate", "reason": "G4 gwt: test_x"}]
    change = ship_repo(git_repo, slice_verdict="red", findings={"blocked": blocked, "blocking": [{"severity": "HIGH"}], "deferred": [], "fix": None})

    # When: 运行 ship --markdown
    p = ship(git_repo, change, "--markdown")

    # Then: stdout 以「## 飞行门禁未全绿」开头，两条 reasons 各占一行，blocked 段带 kind 与 reason；退出码仍为 1
    out = p.stdout
    assert out.startswith("## 飞行门禁未全绿"), out
    reason_lines = [l for l in out.splitlines() if l.startswith("- ") and ("S1" in l or "CRITICAL/HIGH" in l)]
    assert len(reason_lines) >= 2, out
    assert "### 飞行中记 blocked 的切片" in out and "infra" not in out and "gate" in out and "G4 gwt: test_x" in out
    assert p.returncode == 1


def test_ship_markdown_empty_when_ready(git_repo):
    """scenario: ship-verdict#draft 时输出 reasons 段落（ready 反例）"""
    # Given: 全绿对齐 HEAD 且无 blocked
    change = ship_repo(git_repo)

    # When: 运行 ship --markdown
    p = ship(git_repo, change, "--markdown")

    # Then: stdout 为空串，退出码 0
    assert p.stdout.strip() == "", p.stdout
    assert p.returncode == 0


# ---------------------------------------------------------------- 命令 / skill / 工作流文本契约

def test_pr_ship_bidirectional_transition():
    """scenario: ship-verdict#命令文本包含双向转换"""
    # Given: template/.claude/commands/pr-ship.md
    text = (CMD / "pr-ship.md").read_text(encoding="utf-8")

    # When: 定位建 PR 步骤与自动修复步骤
    create = text.index("7. **创建 PR/MR**")
    autofix = text.index("10. **CRITICAL/HIGH 自动修复", create)

    # Then: 建 PR 前引用 ship 裁决；自动修复收尾引用 gh pr ready 与 --undo、glab 对应参数、记 pr-ready / pr-draft 事件；不再有模型自判散文
    assert "slice-gate.py ship" in text[create:autofix]
    tail = text[autofix:]
    assert "gh pr ready <num>" in tail and "gh pr ready --undo <num>" in tail
    assert "--ready" in tail and "--draft" in tail
    assert "timeline.py record pr-ready" in tail and "timeline.py record pr-draft" in tail
    assert "门禁未全绿 → 加 `--draft`" not in text


def test_apply_writes_full_findings_and_calls_ship():
    """scenario: ship-verdict#opsx-apply 收口写全量 review-findings 并调用 ship"""
    # Given: opsx-apply.md 与同名 skill
    for path in (CMD / "opsx-apply.md", SKILL):
        text = path.read_text(encoding="utf-8")

        # When: 取收口到 pr-ship 之间的文本
        tail = text[text.index("apply-done"):]

        # Then: 写入的 JSON 含 blocked；引用 slice-gate.py ship；不再有「final 未绿或有 blocked 切片」自判散文
        assert re.search(r"\{blocked, blocking, deferred, fix\}", tail), path
        assert "slice-gate.py ship" in tail, path
        assert "final 未绿或有 blocked 切片" not in text, path


def test_workflow_blocked_entries_carry_kind():
    """scenario: ship-verdict#工作流 blocked 条目带 kind"""
    # Given: opsx-apply.js
    text = WORKFLOW.read_text(encoding="utf-8")

    # When: 找出每处 blocked.push({...})
    pushes = [l for l in text.splitlines() if "blocked.push({" in l]

    # Then: 至少四处，每处都带 kind 且取值只有 'gate' / 'infra'
    assert len(pushes) >= 4, pushes
    for p in pushes:
        m = re.search(r"kind:\s*'(\w+)'", p)
        assert m and m.group(1) in ("gate", "infra"), p
