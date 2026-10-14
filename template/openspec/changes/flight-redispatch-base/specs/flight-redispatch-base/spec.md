## ADDED Requirements

### Requirement: 同一 attempt 内续派执行体沿用首个执行体的起点
执行体收口门禁红、或未正常收口后补跑门禁仍红，控制面在同一 attempt 内续派执行体时，续派动作 SHALL 带上本片最后一次执行体派发记录的 base；该派发没有 base 时 SHALL 不带（行为同旧版）。编排层复用原 worktree 续派时，SHALL 以该 base 调用 `slice-gate base`（`--base <原起点>`），续派的 dispatch 事件 SHALL 记原起点，且 SHALL NOT 在原起点之外再做一次起点测量。

Feature: 起点是「改生产代码之前」的快照；续派者接着前一个执行体的提交干活，G5 仍须以最初的起点判「先红后绿」。

#### Scenario: redispatch-carries-dispatch-base
- **GIVEN** 两份账本，waves 只有 [S1]：
  - 甲：S1 执行体 A 的派发记 base `b0`，A 收口门禁红（failed `G4 GWT`）后结束，结束后补跑门禁仍红（`G4 GWT`）
  - 乙：S1 执行体 A 的派发记 base `b0`，A 无收口结论就结束，补跑门禁红（failed `G3 test`）
- **WHEN** 对两份账本各求下一批动作
- **THEN** 甲为续派 S1 执行体，续接原因「执行体未正常收口」、失败项 `G4 GWT`、base 为 `b0`
- **AND** 乙为续派 S1 执行体，续接原因「执行体未正常收口」、失败项 `G3 test`、base 为 `b0`

#### Scenario: redispatch-without-dispatch-base-unchanged
- **GIVEN** waves 只有 [S1]；S1 执行体 A 的派发没有 base 字段，A 收口门禁红（failed `G4 GWT`）后结束，结束后补跑门禁仍红（`G4 GWT`）
- **WHEN** 求下一批动作
- **THEN** 为续派 S1 执行体，续接原因「执行体未正常收口」、失败项 `G4 GWT`，动作不含 base

#### Scenario: redispatch-pins-original-base
- **GIVEN** `/opsx-apply demo` 已起飞，waves 只有 [S1]；S1 的执行体 A 在 S1 worktree 派发，起点为 `base-flight-demo-S1`；A 收口门禁红（`G4 GWT`）
- **WHEN** A 结束，控制面续派 S1 的执行体
- **THEN** 第二次 `slice-gate base S1` 带 `--base base-flight-demo-S1`，在 S1 worktree 运行
- **AND** 续派的执行体在 S1 worktree 派发，其 dispatch 事件的 base 为 `base-flight-demo-S1`
- **AND** 账本里 agent 为 dispatch 的起点测量恰一次，base 为 `base-flight-demo-S1`

### Requirement: 插件版本
插件清单 SHALL 声明不低于 0.13.1 的版本。

#### Scenario: plugin-version-0-13-1
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 按数字逐段比较不低于 0.13.1
