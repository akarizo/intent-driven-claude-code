## ADDED Requirements

### Requirement: 安装器列出已迁入插件的旧副本
`install.sh` SHALL NOT 再安装 `.claude/commands/pr-ship.md` 与 `.claude/agents/code-reviewer.md`。升级时目标项目里还有这两个旧副本的，SHALL 在输出里列出，标明「已迁入 flight 插件」并给出 `/flight:pr-ship`，SHALL NOT 代删。
Feature: 用户定（2026-10-12）：pr-ship 迁入插件

#### Scenario: install-lists-files-moved-into-plugin
- **GIVEN** 已装旧版模板的目标项目，`.claude/commands/pr-ship.md` 与 `.claude/agents/code-reviewer.md` 仍在
- **WHEN** 以升级方式运行 `install.sh`；另在一个空目录做一次全新安装
- **THEN** 升级的输出列出这两个路径，并含「已迁入 flight 插件」与 `/flight:pr-ship`，且两个文件仍在
- **AND** 全新安装后目标项目里没有这两个文件

### Requirement: 文档改用插件命令
README、`docs/WORKFLOW_zh.md`、legacy 的 `openspec-subagent-apply-change` skill 与仓库 `CLAUDE.md` SHALL 以 `/flight:pr-ship` 指称 pr-ship，SHALL NOT 出现前面不带 `flight:` 的 `/pr-ship`。README、WORKFLOW 与 legacy skill SHALL 以 `flight:code-reviewer` 指称评审员，README 与 WORKFLOW SHALL NOT 再指向 `.claude/agents/code-reviewer.md`。
Feature: 用户定（2026-10-12）：pr-ship 迁入插件

#### Scenario: docs-reference-plugin-ship
- **GIVEN** README.md、docs/WORKFLOW_zh.md、legacy skill 与 CLAUDE.md
- **WHEN** 查找不带 `flight:` 前缀的 `/pr-ship`、`flight:code-reviewer` 与 `.claude/agents/code-reviewer.md`
- **THEN** 四份都没有不带前缀的 `/pr-ship`，都含 `/flight:pr-ship`
- **AND** README、WORKFLOW 与 legacy skill 都含 `flight:code-reviewer`；README 与 WORKFLOW 都不含 `.claude/agents/code-reviewer.md`
