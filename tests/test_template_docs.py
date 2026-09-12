"""命令 / skill / schema 文本契约（scenario: flight-apply#apply-command-zero-prompts / pr-ship-single-review,
executable-specs#schema-tasks-produce-slices / propose-command-triggers）。
骨架：xfail(strict) 直到 S5 实现；执行体去掉标记即解锁。"""
import re

import pytest

from conftest import ROOT

CMD = ROOT / "template" / ".claude" / "commands"
SKILLS = ROOT / "template" / ".claude" / "skills"
SCHEMA = ROOT / "template" / "openspec" / "schemas" / "intent-driven"


def read(path):
    return path.read_text(encoding="utf-8")


def test_apply_command_zero_prompts():
    # Given: template/.claude/commands/opsx-apply.md
    text = read(CMD / "opsx-apply.md")

    # When: 找出启动步骤与 pr-ship 步骤之间的文本
    launch = text.index("slice-gate.py lint")
    ship = text.index("/pr-ship", launch)
    middle = text[launch:ship]

    # Then: 含 lint→waves→Workflow→回退→收 JSON→收口分解→pr-ship 的要素；启动到 pr-ship 之间无 AskUserQuestion；保留 --gate=per-task 指向 legacy；不再有模式问询与水位线
    assert "Workflow" in middle and "useAgentTypes" in middle and "回退" in middle
    assert "session-decompose" in middle and "timeline.py record approve" in middle
    assert "AskUserQuestion" not in middle
    assert "--gate=per-task" in text and "legacy" in text
    assert "水位线" not in text and "整合审" not in text


def test_pr_ship_single_review():
    # Given: template/.claude/commands/pr-ship.md
    text = read(CMD / "pr-ship.md")

    # When: 统计 AskUserQuestion 出现次数并检查评审输入
    asks = text.count("AskUserQuestion")

    # Then: 问询至多 1 处；评审输入含 gate-report.md 与 evidence.log 并声明不重跑测试；自动修复至多 2 轮；无水位线
    assert asks <= 1, asks
    assert "gate-report.md" in text and "evidence.log" in text and "不重跑测试" in text
    assert re.search(r"(至多|最多|≤)\s*2\s*轮", text)
    assert "水位线" not in text and "review-log" not in text
    assert text.count('model: "<main>"') >= 2, "code-reviewer 派发（首审与复核）都必须显式带 model"
    assert "timeline.py record pr-open" in text and "review-findings.json" in text


def test_schema_tasks_produce_slices():
    # Given: template/openspec/schemas/intent-driven/schema.yaml 与 templates/tasks.md
    schema = read(SCHEMA / "schema.yaml")
    tmpl = read(SCHEMA / "templates" / "tasks.md")

    # When: 取 tasks 工件的 instruction 段
    tasks = schema[schema.index("- id: tasks"):schema.index("apply:")]

    # Then: 要求产出 slices.json、切片包、xfail 骨架与生成的 tasks.md；切片规则齐全；tasks 仍 requires specs；模板示例含 deps / verify 后缀
    assert "slices.json" in tasks and "slices/" in tasks and "xfail" in tasks and "tasks.md" in tasks
    assert "owns" in tasks and "深度" in tasks and "1–9" in tasks and "12" in tasks
    assert re.search(r"requires:\s*\n\s*- specs", tasks)
    assert "deps:" in tmpl and "verify:" in tmpl


def test_propose_command_triggers():
    # Given: opsx-propose.md 与 openspec-propose/SKILL.md
    cmd = read(CMD / "opsx-propose.md")
    skill = read(SKILLS / "openspec-propose" / "SKILL.md")

    # When: 检查两者的关键步骤
    both = [cmd, skill]

    # Then: 两者都含一次成稿、触发器表、baseline 与 spec_html.py 渲染，且不再要求模型渲染 HTML
    assert all("一次成稿" in t or "一次性写出" in t for t in both)
    assert all("触发器" in t for t in both)
    assert all("slice-gate.py baseline" in t for t in both)
    assert all("spec_html.py" in t for t in both)
    assert all("spec-html-render/SKILL.md 的流程" not in t for t in both)


def test_command_skill_sync():
    # Given: 四对命令与同名 skill
    pairs = [("opsx-apply.md", "openspec-apply-change"), ("opsx-propose.md", "openspec-propose"),
             ("opsx-verify.md", "openspec-verify-change"), ("opsx-continue.md", "openspec-continue-change")]

    # When: 提取每对文件里提到的 hook 脚本名集合
    def hooks(t):
        return set(re.findall(r"(slice-gate\.py|spec_html\.py|timeline\.py|session-decompose\.py)", t))
    diffs = [(c, s, hooks(read(CMD / c)) ^ hooks(read(SKILLS / s / "SKILL.md"))) for c, s in pairs]

    # Then: 每对提到的 hook 脚本集合一致（命令与 skill 不漂移）
    assert all(not d for _, _, d in diffs), diffs


def test_git_discipline_wave_parallel_carveout():
    # Given: template/.claude/skills/openspec-git-discipline/SKILL.md 的 Worktree Isolation 节
    text = read(SKILLS / "openspec-git-discipline" / "SKILL.md")
    section = text[text.index("## Worktree Isolation"):text.index("## Gates")]

    # When: 检查该节文字
    # Then: 核心禁令原文保留（禁止嵌套子 worktree）；新增 carve-out 说明 wave 内并行切片的临时 worktree
    #       由 Workflow/Agent 运行时创建与清理、由 integrator 合回、不 push / 不 merge main，
    #       与 opsx-apply.js 的 isolation: worktree 并行机制不再自相矛盾
    assert "禁止为单个 task 各开 worktree，也禁止在 change worktree 内再嵌套子 worktree" in section
    assert "wave" in section and "isolation" in section
    assert "integrator" in section
    assert "运行时" in section
    assert "不 push" in section


# ---------------------------------------------------------------- 起飞判据（scenario: model-routing#apply-resolves-main-model /
# pr-ship-resolves-main-model, takeoff-approval#apply-checks-approval-gate）。


def test_apply_resolves_main_model():
    # Given: /opsx-apply 命令与 openspec-apply-change skill
    cmd = read(CMD / "opsx-apply.md")
    skill = read(SKILLS / "openspec-apply-change" / "SKILL.md")

    # When: 检查两份文件里 <main> 的来源与失败处置
    texts = [cmd, skill]

    # Then: <main> 取自 session-model.py；判定失败停下报告并提示 --model=；.flight 记录路由与来源；收口带 --expect-models；不再有"看 /model"式自述
    for t in texts:
        assert "session-model.py" in t
        assert "看 `/model`" not in t
        assert "--expect-models" in t
    assert "--model=" in cmd and "停下报告" in cmd
    assert ".flight" in cmd and '"models"' in cmd


def test_pr_ship_resolves_main_model():
    # Given: /pr-ship 命令
    text = read(CMD / "pr-ship.md")

    # When: 检查两处 code-reviewer 派发的 <main> 来源
    asks = text.count('model: "<main>"')

    # Then: 两处仍显式带 model；<main> 注明取自 session-model.py；不再有"看 /model"式自述
    assert asks >= 2, asks
    assert "session-model.py" in text
    assert "看 `/model`" not in text


def test_apply_checks_approval_gate():
    # Given: /opsx-apply 命令与 openspec-apply-change skill
    cmd = read(CMD / "opsx-apply.md")
    skill = read(SKILLS / "openspec-apply-change" / "SKILL.md")

    # When: 切出 step 0「批准自检」实体（step 1「选 change」之前），而非开头的流程摘要句
    assert "0. **批准自检" in cmd, "step 0 批准自检整块缺失"
    step0 = cmd[cmd.index("0. **批准自检"): cmd.index("1. **选 change**")]

    # Then: step 0 内实跑 takeoff-gate.py --change-dir 并交出 spec.html、不问询；门禁调用早于 step 1；skill 一致；approve 事件带批准证据
    assert "takeoff-gate.py --change-dir" in step0 and "spec.html" in step0
    assert "AskUserQuestion" not in step0
    assert cmd.index("takeoff-gate.py") < cmd.index("1. **选 change**")
    assert "takeoff-gate.py" in skill
    assert "record approve" in cmd and "批准证据" in cmd


# ------------------------------------------------ 阶段边界与起飞确认 flag（S2 骨架，实现后去掉 xfail 标记）
@pytest.mark.xfail(strict=True, reason="S2 未改 explore 命令与 skill；实现后去掉本标记")
def test_explore_command_states_boundary():
    # Given: /opsx-explore 命令与 openspec-explore skill
    cmd = read(CMD / "opsx-explore.md")
    skill = read(SKILLS / "openspec-explore" / "SKILL.md")

    # When: 检查 Guardrails 里的三条硬边界与收尾交接措辞
    for text in (cmd, skill):
        # Then: 三类飞行计划工件、baseline、实现类子 agent 都写明禁止，并引导人显式 /opsx-propose
        assert "slices.json" in text and "tasks.md" in text
        assert "baseline" in text and "slice-executor" in text
        assert "/opsx-propose" in text
        # Then: 仍保留 explore 可写思考类工件的既有定位
        assert "proposal.md" in text and "design.md" in text
        # Then: 不再有把 explore 直接推进到飞行的措辞
        assert "Flow into a proposal" not in text


@pytest.mark.xfail(strict=True, reason="S2 未改 apply 命令与 skill；实现后去掉本标记")
def test_apply_command_documents_flag():
    # Given: /opsx-apply 命令与 openspec-apply-change skill
    cmd = read(CMD / "opsx-apply.md")
    skill = read(SKILLS / "openspec-apply-change" / "SKILL.md")

    # When: 检查确认 flag 的语义、归属与既有步骤是否保留
    for text in (cmd, skill):
        # Then: 写明 flag 拼写、不参与 change 名解析、由 UserPromptSubmit hook 强制
        assert "--confirm-model=" in text
        assert "change 名" in text and "UserPromptSubmit" in text
        # Then: PR #29 的 takeoff-gate 自检与 session-model 取值原样保留
        assert "takeoff-gate.py" in text and "session-model.py" in text
