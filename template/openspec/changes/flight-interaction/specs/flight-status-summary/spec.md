## ADDED Requirements

### Requirement: 从账本归约飞行进度
`core.summarize(state)` SHALL 从账本归约出本次 attempt 的进度：当前 wave、每片的阶段（待派 / 执行中 / 门禁红 / 已合回 / 阻断）、本 attempt 门禁红次数、测量见红、评审、修复、final 与落地或停飞；`summaryLines` SHALL 渲染为首行（含 change、attempt、W<i>/<n>）、每片一行、末行（修复与 final）。
Feature: `/flight status` 与飞行面板共用同一份归约，状态唯一来源是账本（DRAFT-flight-orchestrator-state-machine）

#### Scenario: summary-from-ledger
- **GIVEN** demo 的账本：
  - attempt 1，waves [[S1, S2], [S3]]；
  - S1 门禁绿、已合回、评审 1 条 HIGH；
  - S2 的执行体门禁红 1 次后仍在执行；
  - S3 未派
- **WHEN** 求 `summaryLines(summarize(state))`
- **THEN** 首行含 `demo`、`attempt 1`、`W1/2`
- **AND** S1 一行含「已合回」与评审的 HIGH，S2 一行含「门禁红」与 `1`，S3 一行含「待派」；末行含「修复」与「final」
