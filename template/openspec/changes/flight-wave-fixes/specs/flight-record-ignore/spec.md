## ADDED Requirements

### Requirement: 起飞记录 .flight 不作为未跟踪文件出现
模板 `openspec/.gitignore` SHALL 忽略 `changes/*/.flight`，并保留既有的 `.mini-active` 规则。`install.sh` 在安装与 `--upgrade` 时 SHALL 确保目标项目的 `openspec/.gitignore` 含整行 `changes/*/.flight`：缺则追加，已有则不重复。
Feature: `.flight` 是 apply 起飞到收口之间的每机瞬态文件，收口即删
Rule: `install.sh` 对 openspec/ 从不覆盖，已安装的项目只能靠追加得到新规则

#### Scenario: template-ignores-flight-marker
- **GIVEN** 一个 git 仓库，`openspec/.gitignore` 是本模板的原文；某个 change 目录下有 `.flight`，`openspec/` 下有 `.mini-active`
- **WHEN** 用 `git check-ignore` 询问这两个文件
- **THEN** 两者都被忽略

#### Scenario: upgrade-appends-flight-ignore-once
- **GIVEN** 一个已安装的项目，其 `openspec/.gitignore` 是老版本（只有 `.mini-active` 一条规则）
- **WHEN** 连续两次运行 `install.sh --upgrade <项目>`
- **THEN** 两次都以 0 退出
- **AND** `openspec/.gitignore` 里整行 `changes/*/.flight` 恰好出现一次，`.mini-active` 仍在
