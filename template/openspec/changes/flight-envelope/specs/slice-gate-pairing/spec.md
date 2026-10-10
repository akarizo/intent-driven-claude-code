## ADDED Requirements

### Requirement: G3 配对检查不把切片标记当源码
`slice-gate.py gate` 构造 G3 的源码列表时 SHALL 排除切片标记文件 `.openspec-slice`，与所有权检查、快照恢复、未提交改动检查一致；区间内除标记外没有改动时 SHALL NOT 报 G3 pairing。
Feature: 首飞续飞时区间为空，只剩未跟踪的 `.openspec-slice`，被 G3 判为「改了源码没改测试」

#### Scenario: gate-pairing-ignores-marker
- **GIVEN** 切片 S1 已 start，区间内没有任何提交，工作树里只有未提交的 `.openspec-slice` 标记
- **WHEN** 运行 `slice-gate.py gate S1`
- **THEN** 输出 JSON 的 failed 里没有以「G3」开头的项
