## ADDED Requirements

### Requirement: 铁律 10 改为失效即停飞
仓库根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet` 的铁律第 10 条 SHALL 规定：飞行控制面缺席或失效即不起飞或停飞，不回退到第二套飞行实现；与飞行无关的机制按各自约定降级。SHALL NOT 再出现「Workflow → Agent 派发」。
Feature: 用户定 D7：插件不在就停飞，铁律 10 改写

#### Scenario: iron-rule-10-no-second-implementation
- **GIVEN** 本 change 合入后的 CLAUDE.md 与 template/CLAUDE.md.snippet
- **WHEN** 各取第 10 条
- **THEN** 都含「停飞」与「不回退」
- **AND** 都不含「Workflow → Agent」

### Requirement: 铁律 3、11 不再指向旧引擎
铁律第 3 条的留痕括号 SHALL 写「飞行中 = 控制面测量写入账本；飞行外 = hook 写 evidence.log」（snippet 用同义短句），SHALL NOT 出现「回退路径」；仓库根 CLAUDE.md 第 11 条 SHALL 写「收口从账本机械对账各角色实际模型」，SHALL NOT 出现 `--expect-models`。
Feature: 铁律条文随机制落地改写（DRAFT-flight-control-plane-in-mod 第 5 条）

#### Scenario: iron-rules-3-and-11-updated
- **GIVEN** 本 change 合入后的 CLAUDE.md 与 template/CLAUDE.md.snippet
- **WHEN** 各取第 3 条与第 11 条
- **THEN** 第 3 条都含「飞行外」与「evidence.log」、不含「回退路径」
- **AND** CLAUDE.md 第 11 条含「账本」、不含 `--expect-models`

### Requirement: ADR 记录删除与改写
`template/openspec/adr/DRAFT-flight-single-implementation.md` SHALL 存在，Status 为 accepted，SHALL 写明它取代 `DRAFT-flight-orchestrator-state-machine` 第 7 条、`DRAFT-flight-measure-protocol` 的 evidence.log 回退条目与铁律 10 原文的飞行部分。
Feature: ADR 不可改只 supersede（铁律 6）

#### Scenario: adr-records-retirement
- **GIVEN** 本 change 合入后的 template/openspec/adr/
- **WHEN** 读取 DRAFT-flight-single-implementation.md
- **THEN** 含「Status: accepted」、`DRAFT-flight-orchestrator-state-machine`、`DRAFT-flight-measure-protocol` 与「铁律 10」
- **AND** 含 `--engine=workflow` 与「停飞」

### Requirement: README 与 WORKFLOW 文档只讲插件路径
`README.md` 与 `docs/WORKFLOW_zh.md` SHALL NOT 出现 `opsx-apply.js`、`integrator`、`slice-executor`、`session-decompose`、「Workflow 前置条件」；SHALL 描述插件的飞行流程。
Feature: 与实际做法一致

#### Scenario: readme-and-workflow-doc-plugin-only
- **GIVEN** 本 change 合入后的 README.md 与 docs/WORKFLOW_zh.md
- **WHEN** 逐份读取
- **THEN** 都不含 `opsx-apply.js`、`integrator`、`slice-executor`、`session-decompose`、「Workflow 前置条件」
- **AND** 都含 `flight@intent-driven` 与「停飞」
