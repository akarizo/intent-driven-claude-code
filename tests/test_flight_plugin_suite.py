"""插件 TS 测试的失败纳入全量 pytest（scenario: flight-test-suite-hygiene#suite-failures-parses-file-level-fail / plugin-suite-has-no-failures）。
骨架：strict xfail，断言是真实的；切片 S6 实现 suite_failures 并修掉根因后去掉标记。
suite_failures 在函数内 import：S6 实现之前它不存在，放在模块顶部会让整个文件收集失败（全量 pytest 不可度量）。"""
import pytest

SAMPLE = "\n".join([
    "tests/a.test.ts:",
    "(pass) a [1.00ms]",
    "(fail) b [2.00ms]",
    "(fail) the file ran to its end [0.00ms]",
    "  a rejection nothing handled: boom",
    "",
    " 1 pass",
    " 2 fail",
])


@pytest.mark.xfail(strict=True, reason="S6 未实现：suite_failures")
def test_suite_failures_parses_file_level_fail():
    # Given: 一段含 (pass) a、(fail) b、(fail) the file ran to its end 与汇总行的 claude plugin test 输出
    from test_flight_plugin import suite_failures

    # When: 调用 suite_failures
    found = suite_failures(SAMPLE)

    # Then: 恰为 ["b", "the file ran to its end"]
    assert found == ["b", "the file ran to its end"], found


@pytest.mark.xfail(strict=True, reason="S6 未实现：插件测试零失败（orchestrator.test.tsx 收尾的未处理拒绝未修）")
def test_plugin_suite_has_no_failures():
    # Given: 仓库中的 template/plugins/flight/
    from test_flight_plugin import plugin_run, suite_failures

    # When: 运行一次 claude plugin test（plugin_run 缓存），对输出调用 suite_failures
    _validate, test, _passed = plugin_run()
    found = suite_failures(test.stdout + test.stderr)

    # Then: 返回空列表
    assert found == [], "插件测试有失败：%s\n%s" % (found, (test.stdout + test.stderr)[-3000:])
