"""flight 控制面插件（scenario: approval-band#*）。
`claude plugin test` 没有 xfail 等价物，故每个 scenario 在这里有一个 pytest 骨架，断言插件里同名的 TS 测试通过
（design D10）。S3 实现插件与 TS 测试后逐条去掉 xfail 标记。需要本机 claude CLI ≥ 2.1.295；缺 CLI 时断言失败，不静默跳过。"""
import functools
import re
import shutil
import subprocess

import pytest

from conftest import ROOT

PLUGIN = ROOT / "template" / "plugins" / "flight"


@functools.lru_cache(maxsize=1)
def plugin_run():
    """跑一次 validate 与 test，返回 (validate 结果, test 结果, 通过的 TS 测试名集合)。"""
    if shutil.which("claude") is None:
        raise AssertionError("本仓库测试需要 claude CLI（≥ 2.1.295）：未在 PATH 上找到")
    validate = subprocess.run(["claude", "plugin", "validate", str(PLUGIN)], capture_output=True, text=True, timeout=300)
    test = subprocess.run(["claude", "plugin", "test", str(PLUGIN)], capture_output=True, text=True, timeout=600)
    passed = set(re.findall(r"^\(pass\) (.+?) \[", test.stdout + test.stderr, re.MULTILINE))
    return validate, test, passed


def assert_ts_passed(name):
    _validate, test, passed = plugin_run()
    assert name in passed, "TS 测试「%s」未通过。claude plugin test 原始输出：\n%s%s" % (name, test.stdout, test.stderr)


def test_plugin_manifest_validates():
    # Given: 仓库中的 template/plugins/flight/
    # When: 运行 claude plugin validate
    validate, _test, _passed = plugin_run()

    # Then: 校验通过
    assert validate.returncode == 0, validate.stdout + validate.stderr


def test_band_shows_pending_plan():
    # Given: 有待批准 change demo（指纹 3f9a1c07、tasks 未完成、账本无批准）
    # When: 会话启动后绘制输入框上方区域
    # Then: 批准带显示 demo、3f9a1c07、spec.html 绝对路径与「批准起飞」按钮
    assert_ts_passed("band-shows-pending-plan")


def test_band_ignores_finished_and_foreign_copies():
    # Given: 主 worktree 有已完成的 old；worktree-demo 与 wf_x 两个 worktree 都有未完成的 demo
    # When: 刷新待批准列表
    # Then: 只有一项 demo，路径在 worktree-demo 内；old 不在列表中
    assert_ts_passed("band-ignores-finished-and-foreign-copies")


def test_approve_press_appends_ledger_event():
    # Given: 批准带显示 demo 与指纹 F，按下时重算仍是 F
    # When: 人按下「批准起飞」
    # Then: 依次 hash-object → mktree → commit-tree → update-ref refs/flight/demo/ledger，事件 ev=approve、fp=F、by.plugin=flight；输入框预填 /opsx-apply demo
    assert_ts_passed("approve-press-appends-ledger-event")
    assert_ts_passed("approve-press-approves-the-drawn-item")


def test_approve_press_refuses_changed_plan():
    # Given: 批准带显示指纹 F，按下时重算为 G
    # When: 人按下「批准起飞」
    # Then: 不执行写账本的 git 命令、不预填输入框，出现「计划已变化」提示
    assert_ts_passed("approve-press-refuses-changed-plan")


def test_ledger_append_retries_on_conflict():
    # Given: update-ref 第一次旧值不符、第二次成功；另一情形三次都失败
    # When: 人按下「批准起飞」
    # Then: 前者重读链尾后成功并预填；后者第三次失败后停止、提示错误、不预填
    assert_ts_passed("ledger-append-retries-on-conflict")
    assert_ts_passed("ledger-append-gives-up-after-three-conflicts")


def test_bash_guard_denies_ledger_writes():
    # Given: 插件已加载
    # When: 模型发起 `git update-ref refs/flight/demo/ledger abc` 与 `git status`
    # Then: 前者被拒、理由含 ledger.py show；后者照常执行
    assert_ts_passed("bash-guard-denies-ledger-writes")
    assert_ts_passed("bash-guard-passes-other-commands")
    assert_ts_passed("file-write-guard-denies-ledger-ref")
    assert_ts_passed("monitor-guard-denies-ledger-writes")


def test_no_model_callable_approval_path():
    # Given: 插件已加载、会话已启动
    # When: 列出插件注册的工具与斜杠命令
    # Then: 工具恰为 submit_findings（只能写 review 事件），没有斜杠命令
    assert_ts_passed("no-model-callable-approval-path")


def test_version_floor_disables_band():
    # Given: 会话版本 2.1.200，仓库里有待批准的 change
    # When: 会话启动后绘制输入框上方区域
    # Then: 批准带不显示，出现含 2.1.295 的版本提示
    assert_ts_passed("version-floor-disables-band")
    assert_ts_passed("version-unreadable-disables-band")


# ---------------------------------------------------------------- flight-integrity-fixes（scenario: approval-chain-hardening#band-* / version-* / guard-*）
# 骨架：S5 在插件里写同名 TS 测试并实现后逐条去掉 xfail 标记。

def test_band_prefers_approvable_item():
    # Given: demo 可批准（spec.html 较早修改），zeta 所在 worktree 找不到 plan_fp.py（spec.html 较晚修改）
    # When: 会话启动后绘制批准带
    # Then: 显示 demo 与它的批准按钮，并注明另有 1 个无法批准
    assert_ts_passed("band-prefers-approvable-item")


def test_version_unreadable_shows_notice():
    # Given: 读会话版本的调用失败
    # When: 会话启动
    # Then: 出现含「无法确认 Claude Code 版本」的提示，且批准带不显示
    assert_ts_passed("version-unreadable-shows-notice")


def test_guard_normalizes_ledger_paths():
    # Given: 插件已加载
    # When: 模型对反斜杠路径、含 // 的路径、含 /./ 的账本 ref 路径各发起一次 Write
    # Then: 三次都被拒绝，理由含 ledger.py show
    assert_ts_passed("guard-normalizes-ledger-paths")


def test_guard_denies_gate_record_writes():
    # Given: 插件已加载
    # When: 模型发起 Bash `git update-ref refs/flight/demo/gate-S1 abc`，再发起 slice-gate.py gate 命令
    # Then: 前者被拒绝、理由含 ledger.py show，后者照常执行
    assert_ts_passed("guard-denies-gate-record-writes")


# ---------------------------------------------------------------- flight-orchestrator-core（scenario: flight-findings-intake#only-findings-tool-registered）
# orchestrator.tsx 注册 submit_findings 并收窄 no-model-callable-approval-path；同名 TS 测试在 tests/flight.test.tsx。

def test_only_findings_tool_registered():
    # Given: 插件已加载、会话已启动
    # When: 列出插件注册的工具与斜杠命令，并以各种输入调用 submit_findings
    # Then: 工具只有 submit_findings、没有斜杠命令；任何调用都不追加 approve 事件
    assert_ts_passed("only-findings-tool-registered")

# ---------------------------------------------------------------- flight-envelope-tightening S5


def test_approve_press_dedupes_same_fingerprint():
    # Given: demo 账本最后一条是指纹 F 的 approve 且之后没有 takeoff，当前计划指纹仍为 F
    # When: 人再按一次 demo 的「批准起飞」
    # Then: 账本没有新增事件，toast 含「已批准」
    assert_ts_passed("approve-press-dedupes-same-fingerprint")


# ---------------------------------------------------------------- flight-approve-prefill S1
# 骨架：S1 实现后去掉 xfail 标记。


@pytest.mark.xfail(strict=True, reason="S1：同名 TS 测试尚未实现")
def test_approve_dedupe_prefills_command():
    # Given: demo 账本最后一条是指纹 F 的 approve 且之后没有 takeoff，当前计划指纹仍为 F
    # When: 人再按一次 demo 的「批准起飞」
    # Then: 账本没有新增事件、toast 含「已批准」；$.prompt.fill 收到 /opsx-apply demo
    assert_ts_passed("approve-dedupe-prefills-command")
