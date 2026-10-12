## ADDED Requirements

### Requirement: /flight:pr-ship 与 flight:code-reviewer 由插件提供
`pr-ship.md` SHALL 位于 `template/plugins/flight/commands/`，`code-reviewer.md` SHALL 位于 `template/plugins/flight/agents/`，模板 `template/.claude/` 下 SHALL NOT 再有这两个文件。`pr-ship.md` SHALL 接受 `--worktree`、`--change-dir`、`--judges` 三个参数，并写明缺省值（当前目录、`openspec/changes/<name>`、`.claude/hooks`）。评审员派发 SHALL 用 `subagent_type=flight:code-reviewer` 并显式带 `model`。
Feature: 用户定（2026-10-12）：pr-ship 迁入插件，单一来源

#### Scenario: pr-ship-and-reviewer-live-in-plugin
- **GIVEN** 本 change 合入后的仓库
- **WHEN** 检查插件与模板下的 `pr-ship.md`、`code-reviewer.md`
- **THEN** 两个文件只在插件下存在
- **AND** 插件的 `pr-ship.md` 含 `flight:code-reviewer`、`--worktree`、`--change-dir`、`--judges` 与 `.claude/hooks`，不含 `subagent_type=code-reviewer`

### Requirement: apply 文档指向 /flight:pr-ship 并写明来源规则
`/opsx-apply` 命令与 `openspec-apply-change` skill SHALL 以 `/flight:pr-ship` 指称落地交接，SHALL NOT 出现前面不带 `flight:` 的 `/pr-ship`。两份文档 SHALL 写明起飞、abort、resume 只接受终端、Remote Control 或 SDK 宿主发出。
Feature: 命令与同名 skill 同改；补 #50 的文档遗留

#### Scenario: apply-docs-point-to-flight-pr-ship
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 查找不带 `flight:` 前缀的 `/pr-ship`，以及来源规则
- **THEN** 两份都没有不带前缀的 `/pr-ship`，都含 `/flight:pr-ship`
- **AND** 两份都含「Remote Control」与「SDK」
