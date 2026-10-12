"""slice-gate.py ship：飞行收口的机械 draft / ready 裁决，只读账本、slices.json 与 git（scenario: ship-verdict#* / flight-ship-ledger#*）。"""
import json

from conftest import ROOT, commit_all, git, ledger_append, make_change, run_hook, write

CMD = ROOT / "template" / "plugins" / "flight" / "commands"
TIMELINE0 = "2026-10-13T00:00:00Z\tapprove\tx\n"
HIGH = {"severity": "HIGH", "file": "a.py", "line": 1, "summary": "x", "fix": "y"}


def _ev(ev, change="c", **fields):
    """账本事件外壳 + 字段；attempt 缺省 1。"""
    base = {"v": 1, "ev": ev, "change": change, "at": "2026-10-13T00:00:00Z",
            "by": {"plugin": "flight", "session": "s"}}
    if ev != "approve":
        base["attempt"] = 1
    return dict(base, **fields)


def takeoff(model="opus"):
    return _ev("takeoff", fp="a" * 64, branch="worktree-c", model=model, waves=[["S1"]])


def merge(slice_id, ok=True, commit="m" * 40):
    return _ev("merge", slice=slice_id, ok=ok, commit=commit, failed=[] if ok else ["G2 test: exit 1"])


def final(commit, ok=True):
    return _ev("final", ok=ok, commit=commit, failed=[] if ok else ["G2 test: exit 1"])


def dispatch(slice_id, agent, role="reviewer", commit=None):
    fields = {"slice": slice_id, "role": role, "agent": agent, "model": "claude-opus-5-5", "worktree": "/w"}
    if commit is not None:
        fields["commit"] = commit
    return _ev("dispatch", **fields)


def review(slice_id, agent, findings=()):
    return _ev("review", slice=slice_id, agent=agent, findings=list(findings))


def blocked(slice_id, kind="infra", reason="未返回"):
    return _ev("blocked", slice=slice_id, kind=kind, reason=reason)


def ended(agent, model="claude-opus-5-5"):
    return _ev("ended", agent=agent, reason="done", model=model)


def new_repo(path):
    """与 conftest 的 git_repo 同形：一次 init 提交的空仓库。"""
    path.mkdir(parents=True)
    git(path, "init", "-q", "-b", "main")
    git(path, "config", "user.email", "t@example.com")
    git(path, "config", "user.name", "t")
    (path / "README.md").write_text("# t\n", encoding="utf-8")
    commit_all(path, "init")
    return path


def ship_repo(repo, slice_ok=True, final_at="head", extra=(), plan=True, files=None):
    """造一个已提交工件的仓库：slices.json（S1）+ timeline.md + 可选 files；再往账本追加
    takeoff、S1 的 merge（slice_ok 为 None 时不追加）、final（final_at：head / stale / red / None）与 extra。
    extra 可以是事件列表，或接收 HEAD 全长返回事件列表的函数。返回 change 目录。"""
    change = repo / "openspec" / "changes" / "c"
    if plan:
        write(change / "slices.json", json.dumps({
            "version": 1, "change": "c", "gate": {"test": "true"},
            "slices": [{"id": "S1", "title": "S1", "scenarios": [], "owns": ["src/**"], "deps": [], "verify": "true", "packet": "slices/S1.md"}],
            "scenario_tests": {},
        }))
    else:
        write(change / "tasks.md", "- [ ] x\n")
    (change / "timeline.md").write_text(TIMELINE0, encoding="utf-8")
    for name, text in (files or {}).items():
        write(change / name, text)
    head = commit_all(repo, "artifacts")
    events = [takeoff()]
    if slice_ok is not None:
        events.append(merge("S1", ok=slice_ok))
    if final_at == "head":
        events.append(final(head))
    elif final_at == "stale":
        events.append(final("0" * 40))
    elif final_at == "red":
        events.append(final(head, ok=False))
    events.extend(extra(head) if callable(extra) else extra)
    for e in events:
        ledger_append(repo, "c", e)
    return change


def ship(repo, change, *extra):
    return run_hook("slice-gate", "ship", "--change-dir", str(change), *extra, cwd=repo)


def test_ship_ready_when_all_green_at_head(git_repo):
    """scenario: ship-verdict#全绿对齐 HEAD 判 ready"""
    # Given: 账本有 takeoff、S1 的 ok merge、final ok 且 commit 为 HEAD，没有评审事件；timeline.md 只有一行 approve
    change = ship_repo(git_repo)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 true、reasons 为空、退出码 0；timeline.md 没有被改动
    out = json.loads(p.stdout)
    assert out["ready"] is True, out
    assert out["reasons"] == []
    assert p.returncode == 0
    assert (change / "timeline.md").read_text(encoding="utf-8") == TIMELINE0


def test_ship_draft_when_slice_red(git_repo):
    """scenario: ship-verdict#切片门禁红判 draft"""
    # Given: 账本里 S1 只有一条 ok 为 false 的 merge，final ok 对齐 HEAD
    change = ship_repo(git_repo, slice_ok=False)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false，reasons 有一条点名 S1，退出码 1
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("S1" in r for r in out["reasons"]), out["reasons"]
    assert p.returncode == 1


def test_ship_draft_when_slice_has_no_row(git_repo):
    """scenario: ship-verdict#切片门禁红判 draft（无记录变体）"""
    # Given: slices.json 有 S1，但账本没有 S1 的任何 merge 事件
    change = ship_repo(git_repo, slice_ok=None)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false 且 reasons 含「切片 S1 未合回」
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert "切片 S1 未合回" in out["reasons"], out["reasons"]


def test_ship_draft_when_final_stale(git_repo):
    """scenario: ship-verdict#final 过期判 draft"""
    # Given: 账本最新 final ok，但 commit 是不在历史里的 0000000000…，不是 HEAD
    change = ship_repo(git_repo, final_at="stale")
    head = git(git_repo, "rev-parse", "HEAD")

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false；reasons 有一条同时含「过期」、记录 commit 与 HEAD 前缀
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("过期" in r and "0000000000" in r and head[:10] in r for r in out["reasons"]), out["reasons"]


def test_ship_draft_when_final_missing(git_repo):
    """scenario: ship-verdict#final 过期判 draft（未运行变体）"""
    # Given: 账本没有 final 事件
    change = ship_repo(git_repo, final_at=None)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false 且 reasons 含「final 未运行」
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert "final 未运行" in out["reasons"], out["reasons"]


def test_ship_draft_when_blocking_findings_open(git_repo):
    """scenario: ship-verdict#阻断 finding 未闭环判 draft"""
    # Given: 门禁全绿对齐 HEAD；没有全量评审，S1 的切片评审有 1 条 HIGH
    change = ship_repo(git_repo, extra=[dispatch("S1", "r1"), review("S1", "r1", [HIGH])])

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false 且 reasons 含「1 条 CRITICAL/HIGH 评审未闭环」
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert "1 条 CRITICAL/HIGH 评审未闭环" in out["reasons"], out["reasons"]


def test_ship_blocked_is_informational_only(git_repo):
    """scenario: ship-verdict#blocked 只作说明不作裁决"""
    # Given: 门禁全绿对齐 HEAD；账本本 attempt 有一条 slice wave1、kind infra 的 blocked
    change = ship_repo(git_repo, extra=[blocked("wave1", "infra", "integrator 未返回")])

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 true，blocked 为那一条，退出码 0
    out = json.loads(p.stdout)
    assert out["ready"] is True, out
    assert out["blocked"] == [{"slice": "wave1", "kind": "infra", "reason": "integrator 未返回"}]
    assert p.returncode == 0


def test_ship_ready_without_plan(git_repo):
    """scenario: ship-verdict#非飞行模式判 draft（没有 slices.json）"""
    # Given: change 目录没有 slices.json
    change = ship_repo(git_repo, plan=False, slice_ok=None, final_at=None)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false，reasons 含「没有 slices.json」，退出码 1
    out = json.loads(p.stdout)
    assert out["ready"] is False, out
    assert any("没有 slices.json" in r for r in out["reasons"]), out["reasons"]
    assert p.returncode == 1


def test_ship_blocks_open_findings_without_plan(git_repo):
    """scenario: ship-verdict#非飞行模式判 draft（文件里的 blocking 不再读取）"""
    # Given: change 目录没有 slices.json，review-findings.json 的 blocking 含 1 条
    findings = json.dumps({"blocked": [], "blocking": [HIGH], "deferred": [], "fix": None})
    change = ship_repo(git_repo, plan=False, slice_ok=None, final_at=None, files={"review-findings.json": findings})

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false，reasons 恰为「没有 slices.json：不是飞行 change」，退出码 1
    out = json.loads(p.stdout)
    assert out["ready"] is False, out
    assert out["reasons"] == ["没有 slices.json：不是飞行 change"], out["reasons"]
    assert p.returncode == 1


def test_ship_markdown_lists_reasons_and_blocked(git_repo):
    """scenario: ship-verdict#draft 时输出 reasons 段落"""
    # Given: S1 未合回 + S1 切片评审 1 条 HIGH（两条 reasons），本 attempt 有一条 slice S1、kind gate 的 blocked
    change = ship_repo(git_repo, slice_ok=False, extra=[
        dispatch("S1", "r1"), review("S1", "r1", [HIGH]), blocked("S1", "gate", "G4 gwt: test_x")])

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
    # Given: 账本全绿对齐 HEAD 且无 blocked
    change = ship_repo(git_repo)

    # When: 运行 ship --markdown
    p = ship(git_repo, change, "--markdown")

    # Then: stdout 为空串，退出码 0
    assert p.stdout.strip() == "", p.stdout
    assert p.returncode == 0


# ---------------------------------------------------------------- 命令文本契约

def test_pr_ship_flight_creates_draft_then_calls_ship_tool():
    """flight-ship-ledger：飞行模式以 draft 建 PR，由 ship 工具按账本裁决（原「双向转换」改由插件完成）"""
    # Given: template/plugins/flight/commands/pr-ship.md
    text = (CMD / "pr-ship.md").read_text(encoding="utf-8")

    # When: 切出第 7 步（创建 PR/MR）
    step7 = text[text.index("7. **创建 PR/MR**"):text.index("8. **")]

    # Then: 第 7 步含 --draft、`ship` 工具与 mcp__flight__ship，不含 gh pr ready；全文不再有模型执行的「收尾复裁」
    assert "--draft" in step7
    assert "`ship` 工具" in step7 and "mcp__flight__ship" in step7
    assert "gh pr ready" not in step7
    assert "收尾复裁" not in text


def test_pr_ship_does_not_rewrite_blocking():
    """flight-ship-ledger：飞行模式不让模型改写 review-findings.json 的裁决依据"""
    # Given: template/plugins/flight/commands/pr-ship.md
    text = (CMD / "pr-ship.md").read_text(encoding="utf-8")

    # When: 切出 Guardrails 段
    guard = text[text.index("**Guardrails**"):]

    # Then: 全文不再要求只更新 blocking 字段；Guardrails 写明飞行模式不改 review-findings.json
    assert "只更新 `review-findings.json`" not in text and "`blocking` 字段为" not in text
    assert "不改 `review-findings.json`" in guard


# ---------------------------------------------------------------- flight-wave-fixes（scenario: ship-final-freshness#*）
# 记账豁免；两条守卫（改源码 / 改计划仍判过期）锁住白名单边界。账本 final 记在 ship_repo 的提交上。


def _commit_after_final(git_repo, touch):
    """ship_repo 在账本记下 S1 与 final（commit = 当时 HEAD）；先提交一次记账，再提交一次 touch(change) 造成的改动。返回 change 目录。"""
    change = ship_repo(git_repo)
    _append(change / "timeline.md", "x")
    commit_all(git_repo, "chore(flight): 记录")
    touch(change)
    commit_all(git_repo, "after final")
    return change


def _append(path, line):
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def test_ship_ready_after_bookkeeping_commits(git_repo):
    """scenario: ship-final-freshness#ship-ignores-bookkeeping-commits"""
    # Given: 账本 S1 与 final 都在 commit F 记为 ok；之后两个 commit 只改了 change 目录的 timeline.md、tasks.md、evidence.log、review-findings.json
    def touch(change):
        for name in ("timeline.md", "tasks.md", "evidence.log"):
            _append(change / name, "x")
        write(change / "review-findings.json", json.dumps({"blocked": [], "blocking": [], "deferred": [], "fix": None}))
    change = _commit_after_final(git_repo, touch)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 true，reasons 里没有「过期」，退出码 0
    out = json.loads(p.stdout)
    assert out["ready"] is True, out
    assert not any("过期" in r for r in out["reasons"]), out["reasons"]
    assert p.returncode == 0


def test_ship_stale_after_code_change(git_repo):  # 既有行为守卫：白名单之外的改动在判据引入前后都判过期，故不标 xfail
    """scenario: ship-final-freshness#ship-flags-code-change-after-final"""
    # Given: 账本 final 在 commit F 记为 ok；之后的 commit 改了源码 src/app.py
    change = _commit_after_final(git_repo, lambda change: write(git_repo / "src" / "app.py", "x = 1\n"))

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false，reasons 有一条含「过期」
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("过期" in r for r in out["reasons"]), out["reasons"]


def test_ship_stale_after_plan_change(git_repo):  # 既有行为守卫：同上
    """scenario: ship-final-freshness#ship-flags-plan-change-after-final"""
    # Given: 账本 final 在 commit F 记为 ok；之后的 commit 改了 change 目录的 slices.json（计划，不是记账）
    def touch(change):
        data = json.loads((change / "slices.json").read_text(encoding="utf-8"))
        data["slices"][0]["title"] = "S1 revised"
        write(change / "slices.json", json.dumps(data))
    change = _commit_after_final(git_repo, touch)

    # When: 运行 ship
    p = ship(git_repo, change)

    # Then: ready 为 false，reasons 有一条含「过期」
    out = json.loads(p.stdout)
    assert out["ready"] is False
    assert any("过期" in r for r in out["reasons"]), out["reasons"]

# ---------------------------------------------------------------- flight-hardening
# flight-hardening S1 的 scenario 测试。


def test_final_fresh_ignores_other_change_bookkeeping(git_repo):
    # Given: changes 下有 c、b 两个 change；c 的账本 final 记在提交 X 且 ok；X 之后一次提交只改了 b 的 gate-report.md 与 timeline.md
    c = ship_repo(git_repo)
    b = git_repo / "openspec" / "changes" / "b"
    write(b / "gate-report.md", "# Gate Report\n")
    write(b / "timeline.md", "2026-10-10T00:00:00Z\tfinal\tok\n")
    commit_all(git_repo, "chore(flight): 记录 b")

    # When: 对 c 运行 ship；之后再提交一次代码改动，再对 c 运行 ship
    before = json.loads(ship(git_repo, c).stdout)["reasons"]
    write(git_repo / "src" / "x.py", "x = 1\n")
    commit_all(git_repo, "feat: x")
    after = json.loads(ship(git_repo, c).stdout)["reasons"]

    # Then: 前者 reasons 没有「过期」；代码改动之后 reasons 含「过期」
    assert not any("过期" in r for r in before), before
    assert any("过期" in r for r in after), after


def test_final_fresh_ignores_interfaces_summary(git_repo):
    # Given: change c 的账本 final 记在提交 X 且 ok；X 之后一次提交只改了 c 的 slices/_interfaces.md
    c = ship_repo(git_repo)
    write(c / "slices" / "_interfaces.md", "## S1\n- def run(x):\n")
    commit_all(git_repo, "chore(flight): 记录")

    # When: 对 c 运行 ship
    reasons = json.loads(ship(git_repo, c).stdout)["reasons"]

    # Then: reasons 没有「过期」
    assert not any("过期" in r for r in reasons), reasons

# ---------------------------------------------------------------- flight-ship-ledger


def test_ship_ignores_record_files(tmp_path):
    # Given: 甲、乙两个仓库，账本都有 takeoff（opus）、S1 ok merge、final ok 在 HEAD、whole 派发（commit 为 HEAD）；
    #        甲的 whole review 没有 finding，但 gate-report.md 写 S1 红、review-findings.json 的 blocking 有 1 条 HIGH；
    #        乙的 whole review 有 1 条 HIGH，两个文件都写全绿
    red_files = {"gate-report.md": "| 2026-10-13T00:00:00Z | S1 | red | 0000000000 | G2 test: exit 1 | - |\n",
                 "review-findings.json": json.dumps({"blocked": [], "blocking": [HIGH], "deferred": [], "fix": None})}
    green_files = {"gate-report.md": "| 2026-10-13T00:00:00Z | S1 | ok | 0000000000 | - | - |\n",
                   "review-findings.json": json.dumps({"blocked": [], "blocking": [], "deferred": [], "fix": None})}
    a, b = new_repo(tmp_path / "a"), new_repo(tmp_path / "b")
    ca = ship_repo(a, files=red_files, extra=lambda h: [dispatch("whole", "w1", commit=h), review("whole", "w1")])
    cb = ship_repo(b, files=green_files, extra=lambda h: [dispatch("whole", "w1", commit=h), review("whole", "w1", [HIGH])])

    # When: 分别运行 slice-gate.py ship
    pa, pb = ship(a, ca), ship(b, cb)

    # Then: 甲退出 0、ready 为 true、reasons 为空；乙退出 1、reasons 含「1 条 CRITICAL/HIGH 评审未闭环」、blocking 恰为那条 HIGH；两个 timeline.md 都未改动
    oa, ob = json.loads(pa.stdout), json.loads(pb.stdout)
    assert pa.returncode == 0 and oa["ready"] is True and oa["reasons"] == [], oa
    assert pb.returncode == 1 and "1 条 CRITICAL/HIGH 评审未闭环" in ob["reasons"], ob
    assert ob["blocking"] == [HIGH], ob["blocking"]
    assert [(c / "timeline.md").read_text(encoding="utf-8") for c in (ca, cb)] == [TIMELINE0, TIMELINE0]


def test_ship_follows_latest_whole_round(tmp_path):
    # Given: 四份账本都有 takeoff、S1 ok merge、final ok 在 HEAD：
    #        甲 whole 1 条 HIGH → fix-r1 合回 ok → whole-r1 无 finding（派发 commit 为 HEAD）；乙同甲但 whole-r1 有 1 条 HIGH；
    #        丙 whole 1 条 HIGH → fix-r1 合回 ok，没有 whole-r1；丁只有 blocked review:whole（infra），没有 whole review
    def rounds(r1_findings):
        return lambda h: [dispatch("whole", "w1", commit=h), review("whole", "w1", [HIGH]),
                          dispatch("fix-r1", "f1", role="fixer"), merge("fix-r1", commit=h),
                          dispatch("whole-r1", "w2", commit=h), review("whole-r1", "w2", r1_findings)]
    plans = {
        "甲": rounds([]),
        "乙": rounds([HIGH]),
        "丙": lambda h: [dispatch("whole", "w1", commit=h), review("whole", "w1", [HIGH]),
                        dispatch("fix-r1", "f1", role="fixer"), merge("fix-r1", commit=h)],
        "丁": lambda h: [dispatch("whole", "w1", commit=h), blocked("review:whole", "infra", "评审未返回：w1")],
    }
    repos = {k: new_repo(tmp_path / str(i)) for i, k in enumerate(plans)}
    changes = {k: ship_repo(repos[k], extra=plans[k]) for k in plans}

    # When: 分别运行 ship
    outs = {k: json.loads(ship(repos[k], changes[k]).stdout) for k in plans}

    # Then: 甲 ready；乙 draft 且含「1 条 CRITICAL/HIGH 评审未闭环」；丙 draft 且含「第 1 轮修复未经复核」；丁 draft 且含「全量评审未返回」
    assert outs["甲"]["ready"] is True, outs["甲"]
    assert outs["乙"]["ready"] is False and "1 条 CRITICAL/HIGH 评审未闭环" in outs["乙"]["reasons"], outs["乙"]
    assert outs["丙"]["ready"] is False and "第 1 轮修复未经复核" in outs["丙"]["reasons"], outs["丙"]
    assert outs["丁"]["ready"] is False and any("全量评审未返回" in r for r in outs["丁"]["reasons"]), outs["丁"]


def test_ship_checks_routing_and_review_freshness(tmp_path):
    # Given: 甲：起飞主模型 opus，whole 审到 HEAD 且无 finding，评审员 w1 的 ended 模型为 claude-sonnet-5-5；
    #        乙：whole 派发 commit 为 X、无 finding，X 之后有一次改 src/a.py 的提交，最新 final ok 记在新 HEAD
    a, b = new_repo(tmp_path / "a"), new_repo(tmp_path / "b")
    ca = ship_repo(a, extra=lambda h: [dispatch("whole", "w1", commit=h), review("whole", "w1"),
                                       ended("w1", model="claude-sonnet-5-5")])
    cb = ship_repo(b, extra=lambda h: [dispatch("whole", "w1", commit=h), review("whole", "w1")])
    write(b / "src" / "a.py", "x = 1\n")
    ledger_append(b, "c", final(commit_all(b, "feat: a")))

    # When: 分别运行 ship
    oa, ob = json.loads(ship(a, ca).stdout), json.loads(ship(b, cb).stdout)

    # Then: 甲 draft，blocking 恰有一条 file 为 routing、line 为 0、summary 含「路由不符」的 HIGH；乙 draft，reasons 含「全量评审过期」
    assert oa["ready"] is False, oa
    assert [(f["severity"], f["file"], f["line"], "路由不符" in f["summary"]) for f in oa["blocking"]] == [
        ("HIGH", "routing", 0, True)], oa["blocking"]
    assert ob["ready"] is False and any("全量评审过期" in r for r in ob["reasons"]), ob


def test_judges_know_ship_event(git_repo):
    # Given: change demo 的 timeline.md 有 10:00:00 的 approve 行、没有 pr-open 行；
    #        账本有 takeoff 与一条 10:30:00 的 ship 事件（pr 为 https://x/pull/7、verdict 为 ready）
    d = make_change(git_repo)
    write(d / "timeline.md", "2026-10-13T10:00:00Z\tapprove\tx\n")
    ship_ev = _ev("ship", change="demo", at="2026-10-13T10:30:00Z", pr="https://x/pull/7", verdict="ready", commit="c" * 40)
    ledger_append(git_repo, "demo", dict(takeoff(), change="demo"))
    ledger_append(git_repo, "demo", ship_ev)

    # When: 运行 ledger.py events / show、slice-gate.py features、timeline.py report
    events = run_hook("ledger", "events").stdout.split()
    show = run_hook("ledger", "show", "--change-dir", str(d))
    feats = run_hook("slice-gate", "features", cwd=git_repo).stdout.split()
    report = run_hook("timeline", "report", "--change-dir", str(d)).stdout

    # Then: events 含 ship；show 退出 0 并打印那条 ship 事件；features 含 ship-ledger；report 含「批准 → PR 打开：30.0 min」
    assert "ship" in events, events
    assert show.returncode == 0 and ship_ev in [json.loads(l) for l in show.stdout.splitlines()], show.stdout + show.stderr
    assert "ship-ledger" in feats, feats
    assert "批准 → PR 打开：30.0 min" in report, report
