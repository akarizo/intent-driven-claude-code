## ADDED Requirements

### Requirement: G7 以 scenario 测试的实际运行结果为准
slice-gate 判定 scenario 状态时（切片 gate 只查本片的 scenario，final 查全部），对映射到 `.py` 文件的 scenario 测试 SHALL 单独运行一次 pytest，并逐个取得实际结果。只有实际结果为 PASSED 才算通过。以下情形 SHALL 各记一条 G7 失败，写明 scenario、测试与实际结果：
- XFAIL、XPASS、SKIPPED、FAILED、ERROR；
- 未被收集运行。

原有的源码文本检查（文件存在、函数已定义、装饰器无 xfail/skip）保留。映射到非 `.py` 文件的 scenario 仍只做文本检查。
Feature: 判据看结果，不看写法
Rule: 别名装饰器、模块级 pytestmark、测试体内的 pytest.xfail()/skip()、conftest 动态加的标记，实际运行时都表现为非 PASSED

#### Scenario: g7-rejects-aliased-xfail
- **GIVEN** scenario `cap#adds` 映射的测试用别名装饰器 `XF = pytest.mark.xfail(strict=True)` 标记，断言尚未满足
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false
- **AND** failed 里有一条 G7，点名 `cap#adds` 并含实际结果 XFAIL

#### Scenario: g7-rejects-imperative-skip
- **GIVEN** scenario `cap#adds` 映射的测试在测试体内调用 `pytest.skip()`
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false
- **AND** failed 里有一条 G7，点名 `cap#adds` 并含实际结果 SKIPPED

#### Scenario: g7-gate-checks-own-slice-outcome
- **GIVEN** 切片 S1 的 scenario 测试用别名装饰器标成 xfail，断言尚未满足
- **WHEN** 运行 `slice-gate.py gate S1`
- **THEN** ok 为 false
- **AND** failed 里有一条 G7 含实际结果 XFAIL
