## ADDED Requirements

### Requirement: slice-gate lint 校验 guards
`slice-gate.py lint` SHALL 对切片 `guards` 报错：护栏 scenario 不在本片 `scenarios` 里；护栏没有 `scenario_tests` 映射；护栏映射的 Python 测试函数仍带 xfail 标记（含别名装饰器）。错误行以 `guards:` 开头并点名切片与 scenario。
Feature: 护栏须在规划时写完整、base 上已通过

#### Scenario: lint-checks-guards
- **GIVEN** 三份计划：
  - 切片 S1 的 `guards` 含不在其 `scenarios` 里的 cap#other；
  - 切片 S1 的护栏 cap#one 没有 `scenario_tests` 映射；
  - 切片 S1 的护栏 cap#one 映射的测试函数带 `@pytest.mark.xfail(strict=True)`
- **WHEN** 分别运行 `slice-gate.py lint`
- **THEN** 三次都以非 0 退出，输出含 `guards:`、`S1` 与对应的 scenario id
- **AND** 第三次的输出含「xfail」

### Requirement: 测量输出列出护栏目标
`slice-gate.py measure` 输出的 JSON SHALL 含 `guards`：本片护栏 scenario 映射的目标列表，无护栏时为空列表。
Feature: 测量回复据此区分护栏

#### Scenario: measure-lists-guard-targets
- **GIVEN** 切片 S1 映射 T1、T2，`guards` 为 [cap#one]（T1）
- **WHEN** 运行 `slice-gate.py measure S1`
- **THEN** 输出 JSON 的 `guards` 为 [T1]

### Requirement: 测量回复提示非护栏目标提前通过
测量工具的回复 SHALL 对每个 PASSED、不在 `guards` 里、且本次 `source` 为空的目标追加提示，提示含「在改生产代码之前就已通过」「护栏」与「不要改坏生产代码造红」；护栏目标 SHALL NOT 带这条提示。
Feature: 工具当场提示与 G5 判据一致

#### Scenario: measure-hints-unguarded-pass
- **GIVEN** demo 在飞，agent-1 是 S1 的执行体
- **AND** 测量应答：`tests/test_demo.py::test_a` 为 PASSED、`tests/test_demo.py::test_b` 为 FAILED、`source` 为空、`guards` 为空
- **AND** 另一次应答相同，但 `guards` 为 [`tests/test_demo.py::test_a`]
- **WHEN** agent-1 分别调用 `mcp__flight__measure`
- **THEN** 第一次结果含 test_a、「在改生产代码之前就已通过」「护栏」「不要改坏生产代码造红」
- **AND** 第二次结果不含「在改生产代码之前就已通过」

### Requirement: 执行体提示词禁止造红
执行体提示词 SHALL 写明：某个目标在改生产代码前测量就已通过（且不是护栏）时，不得改坏生产代码来造红，应照实收口并写明是哪个 scenario。
Feature: #47 S5 的重派执行体自行判断对了，规则写进提示词

#### Scenario: prompt-forbids-fabricated-red
- **GIVEN** 一份普通的执行体提示词输入
- **WHEN** 生成执行体提示词
- **THEN** 含「护栏」「不得改坏生产代码」与「照实收口」

### Requirement: 审批页标出护栏
`spec_html.py` 渲染的 Scenario 状态表 SHALL 在护栏 scenario 的行里显示「护栏」标签；非护栏行 SHALL NOT 显示。
Feature: 免于先红的目标须经人批准，审批页要看得见

#### Scenario: approval-page-marks-guards
- **GIVEN** 一个 change 的 `slices.json`：切片 S1 有 scenarios cap#one、cap#two，`guards` 为 [cap#one]
- **WHEN** 渲染 spec.html
- **THEN** cap#one 的行含「护栏」
- **AND** cap#two 的行不含「护栏」

### Requirement: 规划文档与执行体定义写明护栏规则
schema 的 tasks instruction、`/opsx-propose` 与 `openspec-propose` skill、`/opsx-continue` 与 `openspec-continue-change` skill SHALL 写明 `guards` 字段与护栏写法：行为在 base 上已成立的 scenario 列入 `guards`，测试在规划时写完整、不带 xfail。执行体定义 SHALL 写明 G5 逐目标判、改源码后的红不算、不得造红。`DRAFT-flight-measure-protocol.md` SHALL 把豁免规则改为只豁免 `guards`。
Feature: 命令与同名 skill 同改，禁漂移

#### Scenario: docs-state-guard-rule
- **GIVEN** 本 change 合入后的上述文档
- **WHEN** 逐份读取
- **THEN** schema.yaml、两个命令与两个 skill 都含 `guards` 与「护栏」
- **AND** `agents/executor.md` 含「护栏」与「改源码后的红不算」
- **AND** ADR 含 `guards`
