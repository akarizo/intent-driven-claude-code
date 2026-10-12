"""flight-retire-workflow-engine 的旧引擎删除（scenario: flight-retire-engine#old-engine-files-removed）。骨架：S6 实现后去掉 xfail 标记。"""
from conftest import ROOT

OLD = (
    "template/.claude/workflows/opsx-apply.js",
    "template/.claude/agents/integrator.md",
    "template/.claude/agents/slice-executor.md",
)


def test_old_engine_files_removed():
    # Given: 本 change 合入后的模板
    paths = [ROOT / rel for rel in OLD]

    # When: 检查三个旧引擎文件
    left = [str(p.relative_to(ROOT)) for p in paths if p.exists()]

    # Then: 都不存在
    assert left == [], left
