## ADDED Requirements

### Requirement: pipe 模式按分支或 tag 取归档
`IDT_BRANCH` SHALL 接受分支名或 tag 名，缺省 `main`。pipe 模式 SHALL 先取 `<IDT_REPO_URL>/archive/refs/heads/<ref>.tar.gz`，失败再取 `<IDT_REPO_URL>/archive/refs/tags/<ref>.tar.gz`。两者都失败时 SHALL 以 4 退出，`[err]` 输出 SHALL 列出尝试过的两个地址，且 SHALL NOT 创建目标目录。
Feature: 历史版本只以 tag 存在，也要能用 pipe 模式装上

#### Scenario: pipe-installs-tag-only-ref
- **GIVEN** 源里只有 tag `stable-v9.9` 的归档（在 `archive/refs/tags/` 下），没有同名分支
- **AND** 归档里是记录调用的桩 install.sh 与 `template/VERSION`（内容 `v9.9`）
- **WHEN** 以 `IDT_BRANCH=stable-v9.9` 用管道运行 install.sh
- **THEN** 以 0 退出
- **AND** 归档里的 install.sh 被执行，读到的 VERSION 是 `v9.9`

#### Scenario: pipe-default-ref-is-main-branch
- **GIVEN** 源里只有分支 `main` 的归档（在 `archive/refs/heads/` 下）
- **WHEN** 不设 `IDT_BRANCH`，用管道运行 install.sh
- **THEN** 以 0 退出
- **AND** 归档里的 install.sh 被执行，读到的 VERSION 是 `main`

#### Scenario: pipe-missing-ref-lists-both-urls
- **GIVEN** 源里只有分支 `main` 的归档
- **WHEN** 以 `IDT_BRANCH=nope` 用管道运行 install.sh
- **THEN** 以 4 退出
- **AND** `[err]` 行里同时出现 `refs/heads/nope` 与 `refs/tags/nope`
- **AND** 目标目录没有被创建

### Requirement: pipe 模式交给该版本自带的 install.sh
解压后 pipe 模式 SHALL 以 `bash <解压目录>/install.sh [--upgrade] <TARGET>` 运行归档自带的 install.sh，stdin 接 `/dev/null`，自身 SHALL NOT 复制模板。整体退出码 SHALL 等于被交接脚本的退出码，临时目录 SHALL 在退出时删除。被交接的脚本旁边有 `template/`，SHALL 按本地模式运行，不再下载。
Feature: 安装器与模板永远来自同一个版本

#### Scenario: pipe-delegates-args-to-archived-installer
- **GIVEN** 源里有 tag `stable-v9.9` 的归档，其 install.sh 是记录参数的桩
- **WHEN** 以 `IDT_BRANCH=stable-v9.9` 用管道运行 `install.sh --upgrade <target>`
- **THEN** 以 0 退出，桩收到的参数恰为 `--upgrade <target>`
- **AND** 目标目录里没有 `.claude/`（引导器自身没有复制模板）

#### Scenario: pipe-propagates-exit-and-cleans-temp
- **GIVEN** 源里有 tag `stable-v9.9` 的归档，其 install.sh 是以 3 退出的桩
- **AND** `TMPDIR` 指向一个空目录
- **WHEN** 以 `IDT_BRANCH=stable-v9.9` 用管道运行 install.sh
- **THEN** 以 3 退出
- **AND** `TMPDIR` 目录仍为空

#### Scenario: pipe-real-installer-runs-local-mode
- **GIVEN** 源里分支 `main` 的归档由本仓库当前的 install.sh 与 `template/` 打成
- **AND** PATH 上有 openspec 桩，没有 claude
- **WHEN** 用管道运行 `install.sh <target>`
- **THEN** 以 0 退出，目标含 `.claude/hooks/intent-gate.py`，CLAUDE.md 含 `intent-driven:begin` 段
- **AND** 输出里「pipe 模式：下载」恰好出现一次，且含「模式: local」

### Requirement: 文档说明如何安装指定版本
README SHALL 有 `### 安装指定版本` 一节，内容包括：用 main 的 install.sh 加 `IDT_BRANCH=<tag>` 的 pipe 写法；`git clone --depth 1 --branch <tag>` 的 clone 写法；不要从 tag 路径取 install.sh 走管道的警示；不支持用 `--upgrade` 降级的说明。`install.sh --help` 对 `IDT_BRANCH` 的说明 SHALL 写明「分支或 tag」。
Feature: 装老版本的正确姿势写在用户看得到的地方

#### Scenario: readme-documents-pinned-install
- **GIVEN** README.md 与 `install.sh --help` 的输出
- **WHEN** 取 README 中 `### 安装指定版本` 到下一个二级或三级标题之间的内容
- **THEN** 这段内容含 `raw.githubusercontent.com/akarizo/intent-driven-claude-code/main/install.sh`、`IDT_BRANCH=stable-v2.0`、`--branch stable-v2.0` 与「降级」
- **AND** `--help` 输出含「分支或 tag」
