"""跨 change 复用全量（scenario: baseline-incremental-reuse#cross-change-reuse-same-tree、#cross-change-reuse-after-test-only-commit、
#cross-change-ignores-sourced-files）。骨架：每个 scenario 一个 strict xfail，断言是真实的；切片 S2 实现后去掉标记即解锁。
#cross-change-refused-when-script-differs 在 S1 之后即成立，放在 test_baseline_incremental.py（S1）。"""
import pytest

from conftest import git, write
from test_baseline_incremental import baseline, full_c, marker, read_bl, read_plan, two_changes


@pytest.mark.xfail(strict=True, reason="待 S2 实现基线池")
def test_cross_change_reuse_same_tree(git_repo):
    # Given: change c 跑过一次全量绿基线（预存红 1 条）；change d 的全量脚本与 c 内容相同、命令只差 change 目录名，还没有基线；
    #        c 的工件与门禁脚本都没有提交
    c, d = two_changes(git_repo)
    bc = full_c(git_repo, c)

    # When: 对 d 运行 slice-gate.py baseline
    p = baseline(git_repo, d)

    # Then: 退出 0；gate.test 没有运行；d 的 mode 为 incremental、from.change 为 c；test.failed 与 c 相同；
    #       d 的 gate.full_suite_sec 等于 c 基线的 test.sec
    assert p.returncode == 0, p.stdout + p.stderr
    assert not marker(git_repo, "ran-full").exists()
    bd = read_bl(d)
    assert bd["mode"] == "incremental" and bd["incremental"]["from"]["change"] == "c", bd
    assert bd["test"]["failed"] == bc["test"]["failed"] and bc["test"]["failed"], (bd["test"], bc["test"])
    assert read_plan(d)["gate"]["full_suite_sec"] == bc["test"]["sec"]


@pytest.mark.xfail(strict=True, reason="待 S2 实现基线池")
def test_cross_change_reuse_after_test_only_commit(git_repo):
    # Given: change c 跑过一次全量绿基线；之后提交了一个只新增 tests/test_more.py（用例通过）的 commit；d 的全量脚本与 c 内容相同
    c, d = two_changes(git_repo)
    full_c(git_repo, c)
    write(git_repo / "tests" / "test_more.py", "def test_more():\n    assert True\n")
    git(git_repo, "add", "tests/test_more.py")
    git(git_repo, "commit", "-q", "-m", "more tests")

    # When: 对 d 运行 slice-gate.py baseline
    p = baseline(git_repo, d)

    # Then: gate.test 没有运行；mode 为 incremental，incremental.files 为 ["tests/test_more.py"]
    assert p.returncode == 0, p.stdout + p.stderr
    assert not marker(git_repo, "ran-full").exists()
    bd = read_bl(d)
    assert bd["mode"] == "incremental" and bd["incremental"]["files"] == ["tests/test_more.py"], bd


@pytest.mark.xfail(strict=True, reason="待 S2 实现基线池")
def test_cross_change_ignores_sourced_files(git_repo):
    # Given: change c 跑过一次全量绿基线；d 的全量脚本与 c 内容相同，但两者各自 source 的 verify/_env.sh 内容不同
    c, d = two_changes(git_repo, c_env="OWNED_PY=(a.py)\n", d_env="OWNED_PY=(b.py)\n")
    full_c(git_repo, c)

    # When: 对 d 运行 slice-gate.py baseline
    p = baseline(git_repo, d)

    # Then: gate.test 没有运行；mode 为 incremental，from.change 为 c
    assert p.returncode == 0, p.stdout + p.stderr
    assert not marker(git_repo, "ran-full").exists()
    bd = read_bl(d)
    assert bd["mode"] == "incremental" and bd["incremental"]["from"]["change"] == "c", bd
