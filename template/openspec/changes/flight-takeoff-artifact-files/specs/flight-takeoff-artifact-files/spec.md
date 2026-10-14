## ADDED Requirements

### Requirement: 计划声明的周边文件按工件起飞提交
插件 SHALL 把 `slices.json` 的 `artifact_files` 列出的路径（相对 change worktree 根、精确匹配）在起飞时与 change 目录、DRAFT ADR、scenario 测试文件同等算作本 change 的工件；未声明的路径 SHALL 仍归为工件之外。批准带的工件计数 SHALL 用同一口径。

#### Scenario: classify-declared-artifact-files
- **GIVEN** change 目录 `template/openspec/changes/demo`、声明文件 `tests/helpers.py` 与 `openspec/adr/INDEX.md`
- **AND** 未提交的路径为 `tests/helpers.py`、`openspec/adr/INDEX.md`、`tests/helpers.py.bak`、`src/x.py`
- **WHEN** 对这些路径分类
- **THEN** 工件恰为 `tests/helpers.py` 与 `openspec/adr/INDEX.md`
- **AND** 工件之外恰为 `tests/helpers.py.bak` 与 `src/x.py`

#### Scenario: takeoff-commits-declared-artifacts
- **GIVEN** demo 已批准，`slices.json` 的 `artifact_files` 为 `tests/helpers.py` 与 `openspec/adr/INDEX.md`
- **AND** 未提交的有 change 目录与 DRAFT 工件、scenario 测试文件，还有这两个声明文件
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 起飞前有一次提交，加入的路径恰为这些工件与两个声明文件
- **AND** 回复含「✈ 起飞」

#### Scenario: band-counts-declared-artifacts
- **GIVEN** demo 已批准且从未起飞，未提交的有 change 目录下 2 个文件与 `artifact_files` 声明的 `tests/helpers.py`
- **WHEN** 读出批准带上 demo 的说明行
- **THEN** 说明行含「提交本 change 的 3 个工件」

### Requirement: 工件之外的拒绝给出可照做的出路
有未声明的工件之外改动时插件 SHALL 拒绝起飞（带不带「授权提交」都一样）。拒绝信息 SHALL 只列工件之外的路径，并说明「授权提交」不覆盖它们与两种处理办法；起飞待命 SHALL 仍把它归为只能人处理。

#### Scenario: foreign-dirt-refusal-explains-way-out
- **GIVEN** demo 已批准，未提交的有工件，还有未声明的 `src/x.py`
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 回复含「工作区不干净」与 `src/x.py`，不含任何工件路径
- **AND** 回复说明「授权提交」不覆盖这些文件，并写到自行提交或撤销、以及 `artifact_files`
- **AND** 没有提交，账本没有 takeoff
- **AND** 起飞待命对这条回复的分类为只能人处理

### Requirement: lint 校验 artifact_files
`artifact_files` 缺省时 lint 行为 SHALL 不变；存在时 lint SHALL 要求它是路径数组，每项非空、相对、不含 `..` 段与通配符、不是已编号 ADR，否则判红。

#### Scenario: lint-accepts-plan-with-or-without-artifact-files
- **GIVEN** 两份合法计划：一份没有 `artifact_files`，一份为 `["tests/helpers.py", "openspec/adr/INDEX.md", "openspec/adr/DRAFT-x.md"]`
- **WHEN** 分别运行 `slice-gate.py lint`
- **THEN** 两次都退出 0

#### Scenario: lint-rejects-bad-artifact-files
- **GIVEN** `artifact_files` 依次为：字符串 `"tests/a.py"`；数组含数字 `1`；数组含空串；数组含 `/abs/a.py`；数组含 `tests/../a.py`；数组含 `tests/*.py`；数组含 `openspec/adr/0007-x.md`
- **WHEN** 对每份计划运行 `slice-gate.py lint`
- **THEN** 每次都非 0 退出，stderr 含 `artifact_files:`
- **AND** 逐项的情形 stderr 含该项原值

### Requirement: 审批面板列出 artifact_files
spec.html SHALL 在 `artifact_files` 非空时单列这些路径，让人批准时看得到哪些工件之外的文件会被一并提交。

#### Scenario: approval-page-lists-artifact-files
- **GIVEN** 一份 `slices.json` 的 `artifact_files` 为 `tests/helpers.py` 与 `openspec/adr/INDEX.md`，另一份没有该字段
- **WHEN** 分别渲染 spec.html
- **THEN** 前者含「起飞时一并提交的周边文件」与这两个路径
- **AND** 后者不含「起飞时一并提交的周边文件」

### Requirement: 文档写明 artifact_files 与插件版本
apply 与 propose 的命令及同名 skill SHALL 同改写明 `artifact_files`；schema 的 tasks instruction SHALL 写明字段用途；插件补丁版本 SHALL +1。

#### Scenario: artifact-files-documented
- **GIVEN** `opsx-apply.md`、`openspec-apply-change/SKILL.md`、`opsx-propose.md`、`openspec-propose/SKILL.md`、`schema.yaml`
- **WHEN** 读取这些文件
- **THEN** 每份都含 `artifact_files`
- **AND** apply 两份写到 `artifact_files` 的行同时写到「授权提交」

#### Scenario: plugin-version-0-10-4
- **GIVEN** 插件清单 `template/plugins/flight/.claude-plugin/plugin.json`
- **WHEN** 解析其 JSON
- **THEN** version 为 0.10.4
