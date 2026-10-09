## ADDED Requirements

### Requirement: G7 沿用项目的 pytest 运行方式
G7 实跑映射到 `.py` 的 scenario 测试时，SHALL 按以下顺序取 pytest 的运行方式（命令前缀），再在其后追加记录结果的插件参数与 nodeid：
1. `slices.json` 中 `gate.pytest` 非空时，按 shell 规则拆分后原样使用；
2. 否则从 `gate.test` 推导：按 shell 规则拆分，取到第一个 pytest 为止的前缀（`pytest` / `py.test` 可执行文件，或 `-m pytest`）；
3. 推导不出时（找不到 pytest，或前缀里含 `&&`、`||`、`;`、`|`、`cd`、`VAR=值` 这类 shell 语法），退回会话的 `python3 -m pytest`，并在门禁 warnings 里加一条以 `G7` 开头、点名 `gate.pytest` 的说明。

记录结果用的临时插件经 `PYTHONPATH` 加载，SHALL 在追加而不覆盖已有 `PYTHONPATH` 的前提下传给该运行方式。
Feature: 判据看结果，结果要在项目自己的环境里跑出来

#### Scenario: g7-uses-runner-from-gate-test
- **GIVEN** scenario 测试导入的模块只在项目的测试环境里可用，`gate.test` 是该环境的 pytest 可执行文件加 `-q tests`
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 true，scenarios.passed 为 1

#### Scenario: g7-prefers-explicit-pytest-config
- **GIVEN** `gate.pytest` 指向一个会留下调用记录的 pytest 包装脚本，`gate.test` 是 `python3 -m pytest -q tests`
- **WHEN** 运行 `slice-gate.py final`
- **THEN** 包装脚本被调用过
- **AND** ok 为 true

#### Scenario: g7-falls-back-with-warning
- **GIVEN** `gate.test` 是 `cd . && python3 -m pytest -q tests`，没有 `gate.pytest`
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 true
- **AND** warnings 里有一条以 G7 开头、含 `gate.pytest` 的说明

### Requirement: G7 实跑有超时与诊断
G7 的实跑 SHALL 设超时：
- 环境变量 `FLIGHT_G7_TIMEOUT`（秒）存在时取它；
- 否则取 `gate.full_suite_sec` 的 3 倍，且不少于 120 秒；
- 没有耗时记录时取 600 秒。

超时 SHALL 对每个参与实跑的 scenario 记一条 G7 失败，写明「运行超时」与秒数。某个目标没有收到任何结果时，失败文案 SHALL 附上 pytest 的退出码（`rc=<N>`），以及输出中第一条含 `Error` 的行（没有则取末行），截断到 200 字符。
Feature: 门禁卡住要能停下，判红要能看出原因

#### Scenario: g7-times-out
- **GIVEN** `gate.pytest` 指向一个先睡 5 秒再运行的 pytest 包装脚本，环境变量 `FLIGHT_G7_TIMEOUT` 为 1
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false
- **AND** failed 里有一条 G7 含「运行超时」

#### Scenario: g7-reports-collection-failure-detail
- **GIVEN** scenario 测试所在文件在模块级抛出 `RuntimeError`，收集即失败
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false
- **AND** failed 里有一条 G7 含「未被收集运行」、`rc=` 与 `RuntimeError`
