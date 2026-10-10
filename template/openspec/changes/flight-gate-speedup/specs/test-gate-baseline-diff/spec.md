## ADDED Requirements

### Requirement: 全量测试门禁按基线逐条差分
`slice-gate.py baseline` 与 `final` 运行 `gate.test` 时 SHALL 经环境变量 `PYTEST_ADDOPTS` 追加 `--junitxml=<临时文件>`。退出码为 1、junit 文件存在、输出里 pytest 汇总行恰好一行、且 junit 的失败与错误合计等于汇总行的 failed 与 error 合计时，结果视为可度量：baseline SHALL 判 ok，把逐条失败标识记入 `gate-baseline.json` 的 `test.failed`，并在 warnings 写明预存红条数；final SHALL 只对不在基线 `test.failed` 里的失败判红，失败全在基线里时判绿并在 warnings 写明按基线排除的条数。
Feature: afa 每个 change 都要先跑一遍全量收集预存红、手写 deselect 脚本，再跑 baseline

#### Scenario: baseline-records-preexisting-failures
- **GIVEN** `gate.test` 为 `<python> -m pytest -q tests`，tests 里 test_old 失败、其余通过
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 0，gate-baseline.json 的 ok 为 true
- **AND** `test.failed` 恰有 1 条，且含 test_old
- **AND** warnings 含「预存红」

#### Scenario: final-excludes-baseline-failures
- **GIVEN** 上述基线已生成；test_old 仍失败，cap#adds 的测试通过
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 true，warnings 含「按基线排除」

#### Scenario: final-flags-new-failures
- **GIVEN** 上述基线已生成；又新增一个失败的 test_new
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false，failed 有一项以「G2 test」开头、含「新增」与 test_new、不含 test_old

### Requirement: 度量不可信时退回按退出码判
结果不满足上述可度量条件时（`gate.test` 不是 pytest、退出码不是 1、汇总行不是恰好一行、计数对不上），baseline 与 final SHALL 按退出码判：非 0 即红，红的原因 SHALL 写明「按退出码」与无法差分的理由。
Feature: 多次调用 pytest 时 junit 只留下最后一次；崩溃或收集错误时 junit 不完整，都不能当成可差分

#### Scenario: diff-falls-back-when-unmeasurable
- **GIVEN** `gate.test` 先后运行两次 pytest（输出两行汇总），其中有失败
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 1，reasons 有一项含「按退出码」与「汇总行」

#### Scenario: non-pytest-gate-keeps-exit-code
- **GIVEN** `gate.test` 为 `sh -c 'exit 1'`
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 1，reasons 有一项含「exit 1」与「按退出码」
