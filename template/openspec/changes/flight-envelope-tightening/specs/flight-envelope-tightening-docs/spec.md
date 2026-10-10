## ADDED Requirements

### Requirement: agent 定义、命令、skill 与 ADR 写明收紧后的包络
`agents/executor.md`、`agents/fixer.md` 正文 SHALL 写明 git 一律作用于自己的 worktree，并禁止 heredoc 与读标准输入的解释器；`agents/reviewer.md` SHALL 写明禁止 heredoc 与读标准输入的解释器。`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` 在第一个步骤之前的部分 SHALL 都写明 Bash 固定在自己的 worktree、读取免询问限于主仓库内、heredoc 与读标准输入的解释器被拒。仓库 SHALL 有 ADR `DRAFT-flight-envelope-tightening`，其 Status 行 SHALL 为 accepted 且写明 supersedes `DRAFT-flight-capability-envelope`；旧 ADR 原文 SHALL NOT 被修改。
Feature: 命令与同名 skill 同改，禁漂移；修订已接受的决策要用新 ADR 取代

#### Scenario: docs-state-tightened-envelope
- **GIVEN** 三份 agent 定义、`opsx-apply.md`、`openspec-apply-change/SKILL.md` 与 `template/openspec/adr/`
- **WHEN** 读 agent 正文、两份文档第一个步骤之前的部分，以及 ADR 目录
- **THEN** executor 与 fixer 正文含「worktree」与「heredoc」；reviewer 正文含「heredoc」
- **AND** 两份文档都含「heredoc」「主仓库」「自己的 worktree」；`DRAFT-flight-envelope-tightening.md` 存在，Status 行含「accepted」与「supersedes DRAFT-flight-capability-envelope」
