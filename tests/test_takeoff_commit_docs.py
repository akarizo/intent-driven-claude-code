"""命令与 skill 写明「授权提交」（scenario: flight-takeoff-commit#takeoff-commit-documented）。
骨架：strict xfail，断言是真实的；切片 S2 实现后去掉标记即解锁。"""
import pytest

from conftest import ROOT

CMD = ROOT / "template" / ".claude" / "commands"
SKILLS = ROOT / "template" / ".claude" / "skills"


def read(path):
    return path.read_text(encoding="utf-8")


@pytest.mark.xfail(strict=True, reason="S2 未实现：apply 与 propose 文档写明授权提交")
def test_takeoff_commit_documented():
    # Given: opsx-apply.md、openspec-apply-change/SKILL.md、opsx-propose.md、openspec-propose/SKILL.md
    apply_docs = [read(CMD / "opsx-apply.md"), read(SKILLS / "openspec-apply-change" / "SKILL.md")]
    propose_docs = [read(CMD / "opsx-propose.md"), read(SKILLS / "openspec-propose" / "SKILL.md")]

    # When: 取 apply 两份里写到「授权提交」的行
    lines = [[ln for ln in t.splitlines() if "授权提交" in ln] for t in apply_docs]

    # Then: 每份至少有一行同时写到「工件」与「拒绝」；propose 两份都含 /opsx-apply <name> 授权提交
    for found in lines:
        assert any("工件" in ln and "拒绝" in ln for ln in found), found
    for t in propose_docs:
        assert "/opsx-apply <name> 授权提交" in t
