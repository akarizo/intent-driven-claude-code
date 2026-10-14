## ADDED Requirements

### Requirement: 插件 TS 测试的失败纳入全量 pytest
`tests/test_flight_plugin.py` SHALL 提供 `suite_failures(text)`：返回 `claude plugin test` 输出里每个 `(fail) <名字> [` 行的名字（含文件级的 `the file ran to its end`）。全量 pytest SHALL 有一条断言真实插件测试的 `suite_failures` 为空。

Feature: `assert_ts_passed` 只核对点名用例在通过名单里；main 上插件测试报 1 fail（`orchestrator.test.tsx` 收尾的未处理拒绝 `no implementation for turn.step`），全量 pytest 仍全绿。

#### Scenario: suite-failures-parses-file-level-fail
- **GIVEN** 一段输出：`(pass) a [1.00ms]`、`(fail) b [2.00ms]`、`(fail) the file ran to its end [0.00ms]`、` 1 pass`、` 2 fail`
- **WHEN** 调用 `suite_failures`
- **THEN** 返回恰为 `["b", "the file ran to its end"]`

#### Scenario: plugin-suite-has-no-failures
- **GIVEN** 仓库中的 `template/plugins/flight/`
- **WHEN** 运行一次 `claude plugin test` 并对输出调用 `suite_failures`
- **THEN** 返回空列表
