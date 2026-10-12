"""code-reviewer 与插件执行体定义的静态契约。flight-retire-workflow-engine 的 S6 把 tests/test_agents_workflow.py 里仍有对象的用例迁到这里。"""
import re

import pytest

from conftest import ROOT

AGENTS = ROOT / "template" / ".claude" / "agents"
PLUGIN_AGENTS = ROOT / "template" / "plugins" / "flight" / "agents"


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


def test_executor_carries_subtractive_rules():
    # Given: template/plugins/flight/agents/executor.md 这份插件执行体契约文件
    # When: 读它的 frontmatter 与正文
    fm, body = frontmatter(PLUGIN_AGENTS / "executor.md")

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

# ---------------------------------------------------------------- flight-entry-handoff
# 骨架：S4 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S4：pr-ship 与 code-reviewer 尚未迁入插件")
def test_pr_ship_and_reviewer_live_in_plugin():
    # Given: 本 change 合入后的仓库
    plugin = ROOT / "template" / "plugins" / "flight"
    ship, reviewer = plugin / "commands" / "pr-ship.md", plugin / "agents" / "code-reviewer.md"

    # When: 检查插件与模板下的 pr-ship.md 与 code-reviewer.md
    in_plugin = [ship.exists(), reviewer.exists()]
    in_template = [(ROOT / "template" / ".claude" / "commands" / "pr-ship.md").exists(), (AGENTS / "code-reviewer.md").exists()]

    # Then: 只在插件下存在；插件的 pr-ship.md 含 flight:code-reviewer、三个参数与缺省判定器目录，不再派 code-reviewer
    assert in_plugin == [True, True] and in_template == [False, False], (in_plugin, in_template)
    text = ship.read_text(encoding="utf-8")
    for key in ("flight:code-reviewer", "--worktree", "--change-dir", "--judges", ".claude/hooks"):
        assert key in text, key
    assert "subagent_type=code-reviewer" not in text
