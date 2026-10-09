"""随插件发布的 agent 类型与提示词（scenario: flight-agent-types#*）。
agent 定义文件由 pytest 直接解析；提示词是 TS 纯函数，断言插件里同名的 TS 测试通过（沿用 test_flight_plugin.py）。
骨架：S3 写定义文件、提示词与同名 TS 测试后逐条去掉 xfail 标记。"""
import pytest

from conftest import ROOT
from test_flight_plugin import assert_ts_passed

AGENTS = ROOT / "template" / "plugins" / "flight" / "agents"
WRITERS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"]


def parse(name):
    """返回 (frontmatter 字典, 正文)。frontmatter 只支持 `key: value` 与 `key:` 加 `  - item` 列表两种写法。"""
    text = (AGENTS / ("%s.md" % name)).read_text(encoding="utf-8")
    assert text.startswith("---\n"), name
    head, _, body = text[4:].partition("\n---\n")
    meta, key = {}, None
    for line in head.splitlines():
        if line.startswith("  - ") and key:
            meta.setdefault(key, []).append(line[4:].strip())
        elif ":" in line:
            key, _, value = line.partition(":")
            key, value = key.strip(), value.strip()
            meta[key] = value if value else []
    return meta, body


def tools(meta):
    raw = meta.get("tools", [])
    return [t.strip() for t in raw.split(",")] if isinstance(raw, str) else raw


@pytest.mark.xfail(strict=True, reason="S3：插件 agents/ 尚未建立")
def test_agent_files_declare_flight_types():
    # Given: template/plugins/flight/agents/ 下的三份文件
    parsed = {n: parse(n)[0] for n in ("executor", "reviewer", "fixer")}

    # When: 解析它们的 frontmatter
    names = {n: m.get("name") for n, m in parsed.items()}

    # Then: name 依次对应，effort 都是 high，都没有 model 字段
    assert names == {"executor": "executor", "reviewer": "reviewer", "fixer": "fixer"}, names
    for n, m in parsed.items():
        assert m.get("effort") == "high", (n, m)
        assert "model" not in m, (n, m)
    # Then: executor 与 fixer 的 tools 恰为写代码的六件，maxTurns 40
    for n in ("executor", "fixer"):
        assert tools(parsed[n]) == WRITERS, (n, tools(parsed[n]))
        assert parsed[n].get("maxTurns") == "40", (n, parsed[n])
    # Then: reviewer 的 tools 含 submit_findings，不含 Edit 与 Write
    rv = tools(parsed["reviewer"])
    assert "mcp__flight__submit_findings" in rv and "Edit" not in rv and "Write" not in rv, rv


@pytest.mark.xfail(strict=True, reason="S3：插件 agents/ 尚未建立")
def test_agent_bodies_leave_gate_to_control_plane():
    # Given: 同上三份文件
    bodies = {n: parse(n)[1] for n in ("executor", "reviewer", "fixer")}

    # When: 读它们的正文
    forbidden = ["slice-gate.py start", "slice-gate.py gate", "slice-gate.py record"]

    # Then: executor 与 fixer 写明「控制面」且不含三条门禁命令；reviewer 写明 submit_findings 与「空列表」
    for n in ("executor", "fixer"):
        assert "控制面" in bodies[n], n
        assert not [f for f in forbidden if f in bodies[n]], (n, [f for f in forbidden if f in bodies[n]])
    assert "submit_findings" in bodies["reviewer"] and "空列表" in bodies["reviewer"]


@pytest.mark.xfail(strict=True, reason="S3：同名 TS 测试尚未实现")
def test_prompts_executor_and_continuation():
    # Given: change demo、切片 S2、切片包路径；上一个执行体未经收口结束，最近门禁 failed 为 G7 demo#s2
    # When: 分别生成首次与续接的执行体提示词
    # Then: 两者都含切片包路径与「门禁由控制面在你收口时运行」；只有续接的含「未正常收口」与 G7 demo#s2
    assert_ts_passed("prompts-executor-and-continuation")


@pytest.mark.xfail(strict=True, reason="S3：同名 TS 测试尚未实现")
def test_prompts_reviewer_resolver_fixer():
    # Given: S1 合回后的 commit c1、合回 S2 时的冲突文件 a.py、一条 HIGH finding
    # When: 分别生成评审员、解冲突与批量修复提示词
    # Then: 评审员含 c1、S1 切片包路径与 submit_findings；解冲突含 a.py 与 git commit --no-edit；修复含该 finding 的 summary
    assert_ts_passed("prompts-reviewer-resolver-fixer")
