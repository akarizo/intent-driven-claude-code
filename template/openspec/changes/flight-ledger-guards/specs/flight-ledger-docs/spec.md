## ADDED Requirements

### Requirement: /flight:pr-ship 与账本记录一致
`pr-ship.md` SHALL NOT 出现 `timeline.py record`；飞行模式第 7 步 SHALL 写明 origin 为 GitLab 时以 `glab mr create --draft` 建 MR、不调用 ship 工具、MR 保持 draft 交人；Output Summary 的「已自动修复」「评论中列出」两行 SHALL 标明只在飞行外填写，飞行模式写「见 ship 评论」。
Feature: change 1 评审 MEDIUM（S6 pr-ship.md:122、:219）；用户定 D1-A

#### Scenario: pr-ship-docs-follow-ledger
- **GIVEN** `template/plugins/flight/commands/pr-ship.md`
- **WHEN** 读取全文、第 7 步与 Output Summary 段
- **THEN** 全文不含 `timeline.py record`
- **AND** 第 7 步含 `glab mr create --draft` 与「只支持 GitHub」
- **AND** Output Summary 段含「见 ship 评论」，且「已自动修复」所在行含「飞行外」

### Requirement: apply 文档、README、WORKFLOW 与铁律 11 一致
`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` SHALL 都不含 `timeline.py record`，SHALL 写明落地时由插件从账本生成 `timeline.md` 与 `gate-report.md`、意图门禁由插件在 Write / Edit / Bash 上执行且 classic 兜底，SHALL 都不含「起飞只接受人发出的命令」；README 与 `docs/WORKFLOW_zh.md` SHALL 写明记录从账本生成；仓库根 `CLAUDE.md` 铁律 11 SHALL 写明飞行中由插件经 `$.session.model()` 判定 `<main>`。
Feature: 用户定（2026-10-13）：D1-A · D2-A；change 1 评审 LOW（S6 opsx-apply.md:25）

#### Scenario: apply-docs-and-iron-rules
- **GIVEN** `template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`README.md`、`docs/WORKFLOW_zh.md`、`CLAUDE.md`
- **WHEN** 读取全文
- **THEN** 命令与 skill 都不含 `timeline.py record` 与「起飞只接受人发出的命令」，都含「从账本生成」与「Bash」
- **AND** README 与 WORKFLOW 都含「从账本生成」
- **AND** `CLAUDE.md` 铁律 11 那一行含 `$.session.model()` 与 `session-model.py`
