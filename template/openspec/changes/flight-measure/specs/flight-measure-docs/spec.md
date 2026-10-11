## ADDED Requirements

### Requirement: 铁律 3 写明测试由可信方运行
根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet` 的铁律 3 SHALL 含「可信方」，并写明飞行中由控制面测量写入账本、回退路径由 hook 写 evidence.log，仍含「不接受自述」；SHALL NOT 再写「测试运行由 hook 留痕」。`README.md` 与 `docs/WORKFLOW_zh.md` 描述留痕时 SHALL 提到控制面测量与账本。
Feature: 评审页 D3-A：铁律 3 从「hook 留痕」升级为「可信方执行」

#### Scenario: iron-rule-3-trusted-runner
- **GIVEN** 本 change 合入后的根 CLAUDE.md、template/CLAUDE.md.snippet、README.md、docs/WORKFLOW_zh.md
- **WHEN** 读取铁律 3 与 README、WORKFLOW 中关于测试留痕的段落
- **THEN** 两处铁律 3 都含「可信方」「账本」「不接受自述」，都不含「测试运行由 hook 留痕」
- **AND** README 与 WORKFLOW 都含「measure」或「测量」，且都含「账本」

### Requirement: 执行体知道测量协议
`template/plugins/flight/agents/executor.md` 的 tools SHALL 含 `mcp__flight__measure`，正文 SHALL 写明「去掉骨架标记、把断言写实 → 调用 measure 看它红 → 再写实现」，SHALL NOT 含「不加 `cd && ` 前缀」与「由 hook 自动留痕」。`prompts.ts` 的执行体提示词 SHALL 写明同一协议，并说明执行体自己跑的测试不算证据。
Feature: 协议靠提示与工具白名单落到执行体（X3：工具须在白名单里）

#### Scenario: executor-follows-measure-protocol
- **GIVEN** 本 change 合入后的 executor.md 与 `executorPrompt` 的输出
- **WHEN** 读取 executor.md 的 frontmatter 与正文，并生成一份执行体提示词
- **THEN** tools 含 `mcp__flight__measure`，正文含「measure」与「看它红」，不含「不加 `cd && ` 前缀」与「自动留痕」
- **AND** 提示词含「measure」与「不算证据」（TS 测试 `executor-prompt-states-measure-protocol` 通过）

### Requirement: 新 ADR 与评审参考材料
SHALL 新增 `template/openspec/adr/DRAFT-flight-measure-protocol.md`：`Status: accepted`，写明细化 `DRAFT-gate-evidence-not-self-reported`、在飞行路径取代 `DRAFT-apply-as-flight` 第 4 条「测试运行由 hook 留痕」（两份旧 ADR 原文不动）。`template/.claude/commands/pr-ship.md` 与 `template/.claude/agents/code-reviewer.md` 的评审参考材料 SHALL 写明飞行模式看账本的测量统计（`timeline.py report`），evidence.log 只属于回退路径。
Feature: ADR 不可改只 supersede（铁律 6）

#### Scenario: measure-adr-and-review-refs
- **GIVEN** 本 change 合入后的 ADR 目录、pr-ship.md 与 code-reviewer.md
- **WHEN** 读取 `DRAFT-flight-measure-protocol.md` 与两份文档的评审参考段
- **THEN** ADR 含「Status: accepted」「DRAFT-gate-evidence-not-self-reported」「DRAFT-apply-as-flight」
- **AND** pr-ship.md 与 code-reviewer.md 都含「timeline.py report」或「测量」，且仍提到 evidence.log 属于回退路径
