"""flight-ship-ledger 的文档（scenario: flight-ship-docs#*）。"""
from conftest import ROOT

APPLY_DOCS = ("template/.claude/commands/opsx-apply.md", "template/.claude/skills/openspec-apply-change/SKILL.md")
ALL_DOCS = APPLY_DOCS + ("README.md", "docs/WORKFLOW_zh.md")


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def _title(text, n):
    return next(line for line in text.splitlines() if line.lstrip().startswith("%d. **" % n))


def test_pr_ship_flight_mode_uses_ship_tool():
    # Given: template/plugins/flight/commands/pr-ship.md
    text = read("template/plugins/flight/commands/pr-ship.md")

    # When: 切出第 7 步，并取第 8、9、10 步的标题行
    step7 = text[text.index("7. **创建 PR/MR**"):text.index("8. **")]
    titles = [_title(text, n) for n in (8, 9, 10)]

    # Then: 第 7 步含「飞行模式」、--draft 与「`ship` 工具」且不含 gh pr ready；第 8–10 步标题都含「飞行外」；全文含「非账本裁决」且不再要求改写 blocking
    assert "飞行模式" in step7 and "--draft" in step7 and "`ship` 工具" in step7
    assert "gh pr ready" not in step7
    assert all("飞行外" in t for t in titles), titles
    assert "非账本裁决" in text
    assert "只更新 `review-findings.json` 的 `blocking`" not in text


def test_apply_docs_describe_whole_review():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md、README.md、docs/WORKFLOW_zh.md
    docs = {rel: read(rel) for rel in ALL_DOCS}

    # When: 逐份查找关键词
    missing = {rel: [k for k in ("全量评审", "按账本裁决") if k not in d] for rel, d in docs.items()}
    apply_missing = {rel: [k for k in ("至多 2 轮", "复核", "`ship` 工具") if k not in docs[rel]] for rel in APPLY_DOCS}
    origin = {rel: docs[rel].count("**来源规则**") for rel in APPLY_DOCS}

    # Then: 四份都含「全量评审」与「按账本裁决」；两份 apply 文档含「至多 2 轮」「复核」「`ship` 工具」，且「**来源规则**」各恰好一次
    assert all(not v for v in missing.values()), missing
    assert all(not v for v in apply_missing.values()), apply_missing
    assert all(c == 1 for c in origin.values()), origin
