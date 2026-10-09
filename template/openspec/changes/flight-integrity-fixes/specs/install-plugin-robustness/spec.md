## ADDED Requirements

### Requirement: 插件安装两步互不阻断
`install.sh` 安装 flight 插件时 SHALL 让两步互不阻断：
- `claude plugin marketplace add` 失败 SHALL 只告警，仍执行 `claude plugin install`（marketplace 可能早已声明过）。
- install 失败 SHALL 打印两条完整的手动命令。
- 任何情形都 SHALL NOT 改变 install.sh 的退出码。
Feature: 一步失败不吞掉下一步

#### Scenario: plugin-install-continues-after-marketplace-failure
- **GIVEN** 目标仓库未启用 flight 插件
- **AND** claude 桩对 `plugin marketplace add` 返回 1、对 `plugin install` 返回 0
- **WHEN** 运行 install.sh
- **THEN** 以 0 退出，`plugin install flight@intent-driven -s project` 仍被调用
- **AND** 输出里没有手动执行的指引

#### Scenario: plugin-install-failure-keeps-exit-zero
- **GIVEN** 目标仓库未启用 flight 插件
- **AND** claude 桩对 `plugin marketplace add` 与 `plugin install` 都返回 1
- **WHEN** 运行 install.sh
- **THEN** 以 0 退出，两条命令都被调用
- **AND** 输出含两条完整的手动命令

### Requirement: 升级时 settings.json 只补缺失的顶层键
settings.json 属用户数据，install.sh 文件头的「用户数据」清单 SHALL 列入它。`--upgrade` 时，对模板 `.claude/settings.json` 中除 hooks 以外、用户 settings.json 里缺失的顶层键，SHALL 原样补上。用户已有的顶层键（含其全部嵌套内容）SHALL NOT 被改动。hooks 仍按原有规则合并。
Feature: 不覆盖用户配置，也不让模板新增的配置永远到不了已安装的项目

#### Scenario: upgrade-adds-missing-template-settings-keys
- **GIVEN** 已安装的目标仓库，用户把 `.claude/settings.json` 改成 `{"env": {"MY_KEY": "1"}, "custom": true}`
- **WHEN** 运行 `install.sh --upgrade`
- **THEN** settings.json 的 env 仍恰为 `{"MY_KEY": "1"}`，custom 仍为 true
- **AND** 补上了模板的 `worktree` 键（`{"baseRef": "head"}`）
