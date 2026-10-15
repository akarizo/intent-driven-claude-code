"""timeline 标出增量基线、propose 文档写明增量基线（scenario: baseline-incremental-reuse#timeline-marks-incremental-baseline、
#propose-docs-describe-incremental）。骨架：每个 scenario 一个 strict xfail，断言是真实的；切片 S3 实现后去掉标记即解锁。"""
import json
import pathlib

from conftest import git, make_change, run_hook, write

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ("template/.claude/commands/opsx-propose.md", "template/.claude/skills/openspec-propose/SKILL.md")


def _read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def test_timeline_marks_incremental_baseline(tmp_path):
    # Given: gate-baseline.json 为 mode incremental，incremental.from.change 为 c，incremental.files 有 1 个文件
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "t@example.com")
    git(repo, "config", "user.name", "t")
    (repo / "README.md").write_text("# t\n", encoding="utf-8")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    d = make_change(repo)
    write(d / "gate-baseline.json", json.dumps({
        "at": "2026-10-14T10:00:00Z", "ok": True, "mode": "incremental",
        "test": {"exit": 1, "sec": 447.0, "failed": ["tests.test_old::test_old_red"]},
        "incremental": {"from": {"change": "c", "commit": "a" * 40, "at": "2026-10-14T09:00:00Z"},
                        "files": ["tests/test_cap.py"], "sec": 3.2},
    }))

    # When: 运行 timeline.py render
    p = run_hook("timeline", "render", "--change-dir", str(d), cwd=repo)

    # Then: timeline.md 的 baseline 行同时含「增量」与 c
    assert p.returncode == 0, p.stdout + p.stderr
    lines = [l for l in (d / "timeline.md").read_text(encoding="utf-8").splitlines() if "baseline" in l]
    assert any("增量" in l and "c" in l.split("baseline", 1)[1] for l in lines), lines


def test_propose_docs_describe_incremental():
    # Given: opsx-propose.md、openspec-propose/SKILL.md 与 README.md
    # When: 读取全文
    texts = {rel: _read(rel) for rel in DOCS}
    readme = _read("README.md")

    # Then: 前两份都含 --full、「增量」与「跨 change」；各有一行同时含「改完计划」与 baseline；README 有一行同时含「基线」与「增量」
    for rel, text in texts.items():
        assert "--full" in text and "增量" in text and "跨 change" in text, rel
        assert any("改完计划" in ln and "baseline" in ln for ln in text.splitlines()), rel
    assert any("基线" in ln and "增量" in ln for ln in readme.splitlines())
