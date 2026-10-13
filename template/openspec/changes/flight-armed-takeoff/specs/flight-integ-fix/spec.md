## ADDED Requirements

### Requirement: 整合修复提示词逐条完整列出多行失败项
`integFixerPrompt` SHALL 把 failed 的每一项完整列出：多行项的后续行缩进后保留，不只取首行。

Feature: PR #53 MEDIUM：原用例 `integ-prompts-state-guards` 的 Given 用的是单行 `G7 tests/test_x.py::test_y`，偏离了 spec `flight-integ-fix#integ-prompts-state-guards` 的多行项。这里按 spec 原样补一个子用例。行为在 base 上已经成立，属于护栏。

#### Scenario: integ-prompts-spec-given
- **GIVEN** change demo、changeDir `template/openspec/changes/demo`、failed `['G2 test: exit 1（新增 1 条失败）\ntests/test_x.py::test_y']`、base `c9`
- **WHEN** 生成 `integFixerPrompt`
- **THEN** 提示词含「G2 test: exit 1（新增 1 条失败）」与 `tests/test_x.py::test_y`
- **AND** 含「scenario」「xfail」「owns」「先有失败测试」
