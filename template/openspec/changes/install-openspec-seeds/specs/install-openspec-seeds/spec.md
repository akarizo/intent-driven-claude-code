## ADDED Requirements

### Requirement: openspec 只下发种子
安装与升级时，安装器对目标项目的 `openspec/` SHALL 只下发以下种子：
- `.gitignore`、`config.yaml`
- `changes/.gitkeep`、`adr/.gitkeep`、`superpower/.gitkeep`
- `schemas/` 下的全部文件

已存在的种子 SHALL NOT 被覆盖。`schemas/` 例外：升级时照旧刷新为模板原文。

模板 `openspec/changes/` 下的 change 目录与 `openspec/adr/` 下的 ADR 文件是本仓自己的开发工件，SHALL NOT 被拷进目标项目。
Feature: 用户项目里只有自己的 change 与 ADR

#### Scenario: fresh-install-ships-only-seeds
- **GIVEN** 一个空目录
- **WHEN** 运行 `install.sh <目录>`
- **THEN** 以 0 退出
- **AND** 目录下 `openspec/` 里的文件恰为种子清单，加上模板 `openspec/schemas/` 下的全部文件

#### Scenario: upgrade-adds-no-dev-artifacts
- **GIVEN** 用 `install.sh` 装好的项目
- **AND** 用户自己建了 change `my-change`（含 `proposal.md`）与 ADR `0001-mine.md`
- **WHEN** 运行 `install.sh --upgrade <项目>`
- **THEN** 以 0 退出
- **AND** `openspec/changes/` 下只有 `.gitkeep` 与 `my-change`
- **AND** `openspec/adr/` 下只有 `.gitkeep` 与 `0001-mine.md`
- **AND** 输出不含「旧版安装器」提示

#### Scenario: upgrade-keeps-user-seed-edits
- **GIVEN** 用 `install.sh` 装好的项目
- **AND** 用户改过 `openspec/config.yaml`
- **AND** `openspec/schemas/intent-driven/schema.yaml` 被本地改坏
- **WHEN** 运行 `install.sh --upgrade <项目>`
- **THEN** 以 0 退出
- **AND** `config.yaml` 仍是用户的内容
- **AND** `schema.yaml` 恢复为模板原文

### Requirement: 列出疑似误拷的开发工件
安装或升级结束时，下面两类已有条目如果与模板中的条目同名，安装器 SHALL 用 `[info]` 逐条列出：
- 目标项目 `openspec/changes/` 下的条目，与模板 `openspec/changes/` 中的条目同名；
- 目标项目 `openspec/adr/` 下的条目，与模板 `openspec/adr/` 中的条目同名。

`.gitkeep` 除外。提示 SHALL 说明这些条目多半是旧版安装器误拷进来的，并写明「安装器不代删」。安装器 SHALL NOT 删除或改动这些条目。不同名的用户条目 SHALL NOT 出现在清单里。没有同名条目时 SHALL NOT 输出这段提示。
Feature: 已被旧版安装器污染的项目，升级时能知道该清理什么

#### Scenario: upgrade-lists-suspected-dev-artifacts
- **GIVEN** 已装项目的 `openspec/changes/` 下有一个与模板 change 目录同名的目录
- **AND** `openspec/adr/` 下有一份与模板 DRAFT ADR 同名的文件
- **AND** 另有用户自己的 change `my-change`
- **WHEN** 运行 `install.sh --upgrade <项目>`
- **THEN** 以 0 退出
- **AND** 输出含「旧版安装器」与「安装器不代删」
- **AND** 这段提示列出那个 change 目录与那份 ADR 的路径，不列 `my-change`
- **AND** 三者都仍在原处
