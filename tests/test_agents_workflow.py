"""agent 定义与 opsx-apply 工作流脚本的静态契约（scenario: flight-apply#workflow-script-valid / executor-agent-contract / reviewer-no-rerun）。"""
import json
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


# ---------------------------------------------------------------- flight-wave-fixes（scenario: slice-base-check#workflow-* / executor-* · integrator-merge-contract#*）
# 骨架：xfail(strict) 直到 S2 实现；执行体去掉标记即解锁。
# run_workflow 用 node 把脚本正文包进 async 函数，mock 掉 agent / parallel / phase / log 后真跑一遍，按 label 正则回放预设结果。

HARNESS = r"""
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const args = input.args;
const calls = [];
async function agent(prompt, opts) {
  calls.push({ prompt, opts });
  const label = (opts && opts.label) || '';
  for (const [pat, reply] of input.replies) if (new RegExp(pat).test(label)) return reply;
  return null;
}
const parallel = (thunks) => Promise.all(thunks.map((t) => t()));
const phase = () => {};
const log = () => {};
(async () => { __BODY__ })()
  .then((result) => process.stdout.write(JSON.stringify({ calls, result })))
  .catch((e) => process.stdout.write(JSON.stringify({ calls, error: String((e && e.stack) || e) })));
"""


def run_workflow(tmp_path, args, replies):
    """跑 opsx-apply.js：replies 是 [[label 正则, 返回值], ...]；返回 {calls: [{prompt, opts}], result}。"""
    if not shutil.which("node"):
        pytest.skip("需要 node 驱动工作流脚本")
    body = WORKFLOW.read_text(encoding="utf-8").replace("export const meta", "const meta", 1)
    js = tmp_path / "harness.cjs"
    js.write_text(HARNESS.replace("__BODY__", body), encoding="utf-8")
    p = subprocess.run(["node", str(js)], input=json.dumps({"args": args, "replies": replies}),
                       capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    out = json.loads(p.stdout)
    assert "error" not in out, out["error"]
    return out


def flight_args(**over):
    args = {"change": "c", "changeDir": "openspec/changes/c", "hooksDir": ".claude/hooks", "agentsDir": ".claude/agents",
            "waves": [["S1", "S2"], ["S3"]], "useAgentTypes": True, "branch": "worktree-c",
            "models": {"executor": "opus", "reviewer": "opus", "integrator": "sonnet"}}
    args.update(over)
    return args


def gate_json(s, ok=True, commit="c" * 40, failed=(), base="b" * 40):
    return {"slice": s, "ok": ok, "commit": commit, "failed": list(failed), "warnings": [], "base": base}


def start_cmds(prompt):
    """prompt 里真正的 start 命令（带 --change-dir 的那几处），不含说明文字里提到的 start。"""
    return re.findall(r"slice-gate\.py start \S+ --change-dir [^`\n]*", prompt)


TAIL_REPLIES = [
    ["^integrate:", {"ok": True, "merged": ["S1", "S2"], "failed": [], "warnings": []}],
    ["^review:", {"findings": []}],
    ["^final-gate$", {"slice": "final", "ok": True, "commit": "d" * 40, "failed": []}],
]


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S2 未实现：每个执行体按分支名校验基点")
def test_workflow_start_carries_expect_branch(tmp_path):
    # Given: branch=worktree-c，waves [[S1, S2], [S3]]；S1 首轮被 start 以 G0 拒绝（commit 为空），S2 首轮门禁红（带 commit 与 base），两者重派后都绿
    replies = [
        ["^S1$", {"slice": "S1", "ok": False, "commit": "", "failed": ["G0 base: HEAD 不是分支 worktree-c 的后代"]}],
        ["^S1:retry$", gate_json("S1")],
        ["^S2$", gate_json("S2", ok=False, commit="e" * 40, failed=["G1 verify: exit 1"])],
        ["^S2:retry$", gate_json("S2")],
        ["^S3$", gate_json("S3")],
    ] + TAIL_REPLIES

    # When: 用 mock agent 跑完整个工作流，取全部执行体派发（label 为 S<n> 或 S<n>:retry）及其中的 start 命令
    out = run_workflow(tmp_path, flight_args(), replies)
    execs = {c["opts"]["label"]: c["prompt"] for c in out["calls"] if re.fullmatch(r"S\d+(:retry)?", c["opts"]["label"])}
    starts = {label: start_cmds(prompt) for label, prompt in execs.items()}

    # Then: 五次执行体派发的 start 命令都带 --expect-branch worktree-c；S1 重派不 cherry-pick，S2 重派 cherry-pick 且 start 带上一轮 --base；脚本不再出现 expectHead
    assert sorted(execs) == ["S1", "S1:retry", "S2", "S2:retry", "S3"], sorted(execs)
    for label, cmds in starts.items():
        assert cmds and all("--expect-branch worktree-c" in c for c in cmds), (label, cmds)
    assert "cherry-pick" not in execs["S1:retry"]
    assert "cherry-pick" in execs["S2:retry"] and any("--base " + "b" * 40 in c for c in starts["S2:retry"])
    assert "expectHead" not in WORKFLOW.read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S2 未实现：合回改用独立返回结构、不跑 final")
def test_workflow_merge_dispatch_forbids_final(tmp_path):
    # Given: waves [[S1, S2], [S3]]，全部切片与合回都成功
    replies = [["^S1$", gate_json("S1")], ["^S2$", gate_json("S2")], ["^S3$", gate_json("S3")]] + TAIL_REPLIES

    # When: 用 mock agent 跑完工作流，取 wave 1 的合回派发
    out = run_workflow(tmp_path, flight_args(), replies)
    merges = [c for c in out["calls"] if c["opts"]["label"].startswith("integrate:")]

    # Then: 合回派发的返回结构必填项含 ok 与 failed、不含 slice 与 commit；prompt 含「不要运行第 3 项」；blocked 里没有 wave 开头的条目
    assert len(merges) == 1, [c["opts"]["label"] for c in merges]
    required = set(merges[0]["opts"]["schema"]["required"])
    assert {"ok", "failed"} <= required and not ({"slice", "commit"} & required), required
    assert "不要运行第 3 项" in merges[0]["prompt"]
    assert not [b for b in out["result"]["blocked"] if b["slice"].startswith("wave")], out["result"]["blocked"]


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S2 未实现：执行体契约写明 start 拒绝即原样返回")
def test_executor_returns_start_refusal():
    # Given: template/.claude/agents/slice-executor.md
    fm, body = frontmatter(AGENTS / "slice-executor.md")

    # When: 取「开工」段
    opening = body[body.index("## 开工"):body.index("## 纪律")]

    # Then: 开工段含 --expect-branch，并写明 start 非 0 时不做任何改动、把它打印的 JSON 原样返回
    assert "--expect-branch" in opening
    assert "非 0" in opening and "不做任何改动" in opening and "原样" in opening


@pytest.mark.xfail(strict=True, raises=AssertionError, reason="S2 未实现：integrator 第 3 项仅点名才跑")
def test_integrator_final_only_when_named():
    # Given: template/.claude/agents/integrator.md
    fm, body = frontmatter(AGENTS / "integrator.md")

    # When: 取第 3 项「全量门禁」段
    item3 = body[body.index("## 3. 全量门禁"):body.index("## 4.")]

    # Then: 该段写明仅当 prompt 点名才运行、wave 合回不跑；仍给出 slice-gate.py final 命令
    assert "点名" in item3 and "合回" in item3
    assert "slice-gate.py final" in item3
