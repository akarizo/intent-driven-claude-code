## ADDED Requirements

### Requirement: 覆盖率未达标时全量测试不可度量
`gate.test` 的输出（去掉 ANSI 后）任一行含 pytest-cov 的覆盖率失败标记（`Coverage failure: total of` 或 `FAIL Required test coverage of`）时，本次全量测试结果 SHALL 判为不可度量、按退出码判。理由 SHALL 写明「覆盖率」，并提示门禁不判覆盖率时在 `gate.test` 加 `--no-cov`。

Feature: pytest-cov（7.1.0 源码核实）在 fail-under 未达标时把 `session.testsfailed` 加 1、退出码变 1，失败用例计数不变；基线有预存红时，原先会被当成「失败全是预存红」判绿（#45 评审 MEDIUM）。

#### Scenario: final-red-on-coverage-failure
- **GIVEN** `gate.test` 为 pytest；基线已生成：`test_old` 失败（预存红），其余通过
- **AND** 之后提交了 `tests/conftest.py`：按 pytest-cov 的做法，在测试跑完后打印两行覆盖率失败标记，并把 `session.testsfailed` 加 1
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false
- **AND** failed 有一项以「G2 test」开头，含「按退出码判」与「覆盖率」

#### Scenario: baseline-red-on-coverage-failure
- **GIVEN** `gate.test` 为 pytest；`test_old` 失败，且 `tests/conftest.py` 同上
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 1
- **AND** reasons 有一项含「覆盖率」与 `--no-cov`
