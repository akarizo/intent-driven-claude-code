## ADDED Requirements

### Requirement: 仓库即 marketplace
仓库根 SHALL 有 `.claude-plugin/marketplace.json`：`name` 为 `intent-driven`，`plugins` 中有一项 `name` 为 `flight`、`source` 指向 `./template/plugins/flight`；该目录 SHALL 含 `.claude-plugin/plugin.json`，其 `name` 为 `flight`。
Feature: 一行命令安装控制面插件

#### Scenario: marketplace-lists-flight-plugin
- **GIVEN** 仓库根的 `.claude-plugin/marketplace.json`
- **WHEN** 读取它并解析 `flight` 一项的 `source`
- **THEN** marketplace 名为 `intent-driven`
- **AND** `source` 目录下的 `.claude-plugin/plugin.json` 的 `name` 为 `flight`

### Requirement: install.sh 按项目作用域安装插件
`install.sh`（安装与升级两种模式）在 PATH 上有 `claude` 时 SHALL 在目标目录内依次执行 `claude plugin marketplace add <owner/repo> --scope project` 与 `claude plugin install flight@intent-driven -s project`，其中 `<owner/repo>` 由 `REPO_URL`（可被 `IDT_REPO_URL` 覆盖）解析得出；目标 `.claude/settings.json` 的 `enabledPlugins` 已含 `flight@intent-driven: true` 时 SHALL 跳过这两步并打印「flight@intent-driven 已启用」。PATH 上没有 `claude` 时 SHALL 不失败，并原样打印这两条命令供人手动执行。插件步骤失败 SHALL 只告警、不改变安装的退出码。安装结束的摘要 SHALL 说明起飞批准需要该插件。
Feature: 下游仓库装模板时一并装上控制面
Rule: 缺 CLI 不阻断安装，但要把缺口说清楚

#### Scenario: install-registers-plugin-at-project-scope
- **GIVEN** PATH 上有一个记录参数与工作目录的 `claude` 桩
- **WHEN** 对一个新目录运行 `install.sh`
- **THEN** 桩在目标目录内先收到 `plugin marketplace add akarizo/intent-driven-claude-code --scope project`，再收到 `plugin install flight@intent-driven -s project`
- **AND** 安装以 0 退出

#### Scenario: install-without-claude-prints-manual-steps
- **GIVEN** PATH 上没有 `claude`
- **WHEN** 对一个新目录运行 `install.sh`
- **THEN** 安装以 0 退出
- **AND** 输出含 `claude plugin marketplace add akarizo/intent-driven-claude-code --scope project` 与 `claude plugin install flight@intent-driven -s project`

#### Scenario: install-skips-enabled-plugin
- **GIVEN** 目标目录的 `.claude/settings.json` 的 `enabledPlugins` 已含 `flight@intent-driven: true`，PATH 上有记录参数的 `claude` 桩
- **WHEN** 运行 `install.sh --upgrade`
- **THEN** 桩没有收到任何 `plugin` 子命令
- **AND** 输出含「flight@intent-driven 已启用」
