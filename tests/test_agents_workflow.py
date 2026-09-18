"""agent 定义与 opsx-apply 工作流脚本的静态契约（scenario: flight-apply#workflow-script-valid / executor-agent-contract / reviewer-no-rerun）。"""
import re
import shutil
import subprocess

import pytest

from conftest import ROOT

AGENTS = ROOT / "template" / ".claude" / "agents"
WORKFLOW = ROOT / "template" / ".claude" / "workflows" / "opsx-apply.js"


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    assert m, "%s 缺少 frontmatter" % path
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm, m.group(2)


def test_workflow_script_valid():
    # Given: template/.claude/workflows/opsx-apply.js
    text = WORKFLOW.read_text(encoding="utf-8")
    body = re.sub(r"^\s*//.*$", "", text, flags=re.M).lstrip()

    # When: 静态检查脚本结构（并在有 node 时做语法检查）
    node_ok = True
    if shutil.which("node"):
        node_ok = subprocess.run(["node", "--check", str(WORKFLOW)], capture_output=True, text=True).returncode == 0

    # Then: 首条语句是 export const meta 字面量、name 为 opsx-apply、四个 phase 齐全；wave 用 parallel；评审只 push 不 await 且在 Fix 阶段之后才 Promise.all；无 Date.now / Math.random / import()；node --check 通过
    assert body.startswith("export const meta = {")
    assert "name: 'opsx-apply'" in text
    assert all(("title: '%s'" % p) in text for p in ("Implement", "Review", "Fix", "Finalize"))
    assert "await parallel(" in text
    assert "reviews.push(agent(" in text and "await reviews.push" not in text
    assert text.index("phase('Fix')") < text.index("Promise.all(reviews)")
    assert "Date.now(" not in text and "Math.random(" not in text and "import(" not in text
    assert node_ok


def test_workflow_routes_models_explicitly():
    # Given: template/.claude/workflows/opsx-apply.js
    text = WORKFLOW.read_text(encoding="utf-8")

    # When: 数 agent( 调用次数与带 model: 的调用次数，并找 models 必填校验
    calls = len(re.findall(r"\bagent\(", text))
    with_model = len(re.findall(r"model:\s*models\.", text))

    # Then: 脚本要求 args.models 含 executor / reviewer / integrator（缺则 throw）；每个 agent( 调用都显式带 model 与 effort；开头 log 路由表
    assert "args.models" in text and "throw new Error" in text
    assert all(("models.%s" % k) in text for k in ("executor", "reviewer", "integrator"))
    assert calls >= 5 and with_model == calls, (calls, with_model)
    assert len(re.findall(r"effort:\s*efforts\.", text)) == calls
    assert "log(`模型路由" in text


def test_workflow_hands_ceilings_to_record():
    # Given: template/.claude/workflows/opsx-apply.js（飞行模式默认路径：切片在临时 worktree 跑 gate，integrator 用 record 写回）
    text = WORKFLOW.read_text(encoding="utf-8")

    # When: 取 GATE 结构化输出 schema 段与 integrator 的 record 命令拼装行
    schema = text[text.index("const GATE = {"):text.index("const FINDINGS = {")]
    record_cmd = re.search(r"slice-gate\.py record [^\n`]*", text)

    # Then: GATE schema 声明 ceilings 属性（否则结构化输出会丢掉天花板行）；record 命令用 --json 传整份门禁 JSON 而不是只传 --slice/--commit
    assert "ceilings" in schema, schema
    assert record_cmd and "--json" in record_cmd.group(0), record_cmd and record_cmd.group(0)


def test_executor_agent_contract():
    # Given: template/.claude/agents/slice-executor.md
    fm, body = frontmatter(AGENTS / "slice-executor.md")

    # When: 读取 frontmatter 与正文
    tools = [t.strip() for t in fm.get("tools", "").split(",")]

    # Then: model inherit、maxTurns 40、permissionMode acceptEdits、tools 含 Read/Edit/Write/Bash；正文含 start 命令、owns 约束、一轮多动作、禁 cd && 前缀、收尾 gate 并原样返回 JSON、不写报告
    assert fm.get("model") == "inherit"
    assert fm.get("maxTurns") == "40"
    assert fm.get("permissionMode") == "acceptEdits"
    assert all(t in tools for t in ("Read", "Edit", "Write", "Bash"))
    assert "slice-gate.py start" in body
    assert "owns" in body
    assert "一轮多动作" in body
    assert "cd &&" in body
    assert "slice-gate.py gate" in body and "原样" in body and "JSON" in body
    assert "不写报告" in body


def test_reviewer_no_rerun():
    # Given: template/.claude/agents/code-reviewer.md
    fm, body = frontmatter(AGENTS / "code-reviewer.md")

    # When: 读取正文
    modes = re.findall(r"\*\*`(full|integration|follow-up)`\*\*", body)

    # Then: 只保留 full 与 follow-up 两种模式，无 integration 与水位线；铁律含不重跑测试与 evidence.log；支持结构化 findings
    assert set(modes) == {"full", "follow-up"}
    assert "水位线" not in body
    assert "不重跑测试" in body and "evidence.log" in body
    assert "findings" in body and "severity" in body


def test_integrator_agent_contract():
    # Given: template/.claude/agents/integrator.md
    fm, body = frontmatter(AGENTS / "integrator.md")

    # When: 读取 frontmatter 与正文
    tools = [t.strip() for t in fm.get("tools", "").split(",")]

    # Then: model sonnet、effort low、tools 含 Bash；正文含合回 commit、_interfaces.md、slice-gate.py final
    assert fm.get("model") == "sonnet"
    assert fm.get("effort") == "low"
    assert "Bash" in tools
    assert "git merge" in body and "_interfaces.md" in body and "slice-gate.py final" in body


def test_executor_carries_subtractive_rules():
    # Given: template/.claude/agents/slice-executor.md 这份执行体契约文件
    # When: 读它的 frontmatter 与正文
    fm, body = frontmatter(AGENTS / "slice-executor.md")

    # Then: 三条减法纪律都在（先查已有并复用 · 全部 caller 修在汇流处 · 切角标 ceiling:），且正文不含 LOC 之类的长度阈值
    assert "先查已有" in body and "复用" in body
    assert "全部 caller" in body and "汇流处" in body
    assert "ceiling:" in body
    assert "LOC" not in body


def test_reviewer_flags_symptom_fix():
    # Given: template/.claude/agents/code-reviewer.md 这份评审员契约文件
    # When: 读它的 frontmatter 与正文（含审查 checklist）
    fm, body = frontmatter(AGENTS / "code-reviewer.md")

    # Then: 正确性维度含症状修复（同类输入经其他 caller 仍失败），且既有可维护性维度的重复代码与过度设计条目一条不少
    assert "症状修复" in body and "caller" in body
    assert "重复代码" in body and "过度设计" in body


# ---------------------------------------------------------------- flight-preflight-and-retry（scenario: slice-retry-resume#workflow-* / apply-docs-*）
# S3 已解锁（骨架标记已去）。

CMD = ROOT / "template" / ".claude" / "commands"
SKILLS = ROOT / "template" / ".claude" / "skills"


def test_workflow_retry_resumes_previous_commit():
    # Given: template/.claude/workflows/opsx-apply.js
    text = WORKFLOW.read_text(encoding="utf-8")

    # When: 取 executorPrompt 函数体与 GATE schema 段
    prompt = text[text.index("const executorPrompt"):text.index("const reviewPrompt")]
    schema = text[text.index("const GATE = {"):text.index("const FINDINGS = {")]
    node_ok = subprocess.run(["node", "--check", str(WORKFLOW)], capture_output=True, text=True).returncode == 0 if shutil.which("node") else True

    # Then: 重试分支含 git cherry-pick 与 retryOf.commit，并以 --base 传 retryOf.base；首轮仍含 expectHead；schema 有 base；node --check 通过
    assert "git cherry-pick" in prompt and "retryOf.commit" in prompt
    assert "--base" in prompt and "retryOf.base" in prompt
    assert "expectHead" in prompt
    assert re.search(r"base:\s*\{\s*type:\s*'string'", schema), schema
    assert node_ok


def test_apply_docs_mirror_retry_and_preflight():
    # Given: opsx-apply.md 与 openspec-apply-change/SKILL.md
    cmd = (CMD / "opsx-apply.md").read_text(encoding="utf-8")
    skill = (SKILLS / "openspec-apply-change" / "SKILL.md").read_text(encoding="utf-8")

    # When: 检查 step 3 与回退路径
    def hooks(t):
        return set(re.findall(r"(slice-gate\.py|spec_html\.py|timeline\.py|session-decompose\.py)", t))

    # Then: 两者都在 lint 之后跑 preflight 并说明非 0 停飞；回退路径都含 cherry-pick 与 --base；hook 脚本集合一致
    for t in (cmd, skill):
        assert t.index("slice-gate.py lint") < t.index("slice-gate.py preflight")
        assert "停" in t[t.index("slice-gate.py preflight"):t.index("slice-gate.py preflight") + 400]
        assert "cherry-pick" in t and "--base" in t
    assert hooks(cmd) == hooks(skill)
