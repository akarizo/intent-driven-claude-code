## ADDED Requirements

### Requirement: 未提交改动按工件机械分类
插件 SHALL 把 change worktree 的未提交路径分为三类：飞行记录（change 目录下的记录文件）、工件、工件之外。工件 SHALL 恰为：change 目录下的其余文件；同一 openspec 根下 `adr/` 里文件名以 `DRAFT-` 开头的 `.md`；`slices.json` 的 `scenario_tests` 映射到的测试文件。其余路径（包括已编号的 ADR、porcelain 的改名行）SHALL 归为工件之外。
Feature: 哪些文件可以由插件代为提交，必须由规则判定，不由模型判断

#### Scenario: classify-dirty-paths
- **GIVEN** change 目录为 `template/openspec/changes/demo`，scenario 测试文件为 `tests/test_a.py`
- **AND** 未提交路径为：change 目录下的 `timeline.md` 与 `proposal.md`、`template/openspec/adr/DRAFT-x.md`、`template/openspec/adr/0001-y.md`、`tests/test_a.py`、`src/x.py`
- **WHEN** 分类
- **THEN** 飞行记录恰为 `timeline.md` 那一条
- **AND** 工件恰为 `proposal.md`、`DRAFT-x.md`、`tests/test_a.py` 三条
- **AND** 工件之外恰为 `0001-y.md` 与 `src/x.py`

### Requirement: 授权提交时起飞前只提交本 change 的工件
`/opsx-apply` 的参数里有单独的「授权提交」，或者 change 名以「授权提交」结尾（去掉后缀后作为 change 名），插件 SHALL 视为人授权提交工件。起飞守卫（批准与指纹）通过之后、写 takeoff 事件之前，未提交改动只含飞行记录与工件时，插件 SHALL 只 `git add` 并提交这些路径（提交说明含「工件」），然后照常起飞，回复里写明已提交工件。起飞守卫未通过时 SHALL NOT 提交任何文件。
Feature: 2026-10-11 起飞 flight-gate-speedup 时，人写了「授权提交」，仍因工件未提交被拒三次

#### Scenario: takeoff-commits-artifacts-when-authorized
- **GIVEN** demo 已批准；未提交的只有 change 目录下的 `proposal.md`、`template/openspec/adr/DRAFT-x.md` 与 scenario 测试文件
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 有一次提交，说明含「工件」，发生在 takeoff 事件写入之前
- **AND** `git add` 的路径恰为这三个文件
- **AND** 回复含「✈ 起飞」

#### Scenario: takeoff-accepts-glued-authorization
- **GIVEN** 同上
- **WHEN** 人发出 `/opsx-apply demo授权提交`
- **THEN** 按 change demo 起飞：有一次说明含「工件」的提交，回复含「✈ 起飞」

#### Scenario: takeoff-never-commits-before-approval
- **GIVEN** demo 未批准（起飞守卫退出非 0）；未提交的只有工件
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 回复含「起飞守卫未通过」，没有任何提交，账本没有 takeoff

### Requirement: 未授权或有工件之外的改动时拒绝起飞
未提交改动含工件、但没有「授权提交」时，插件 SHALL 拒绝起飞，回复 SHALL 含「工作区不干净」与可直接复制的 `/opsx-apply <change> 授权提交`。未提交改动含工件之外的路径时，不论有无「授权提交」，插件 SHALL 拒绝起飞且不提交任何文件，回复 SHALL 只列出工件之外的路径。只剩飞行记录时，沿用现有行为（提交记录后起飞）。
Feature: 授权只覆盖工件；其余改动必须由人自己处理

#### Scenario: takeoff-hints-authorization-for-artifacts
- **GIVEN** demo 已批准；未提交的只有工件
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 回复含「工作区不干净」与 `/opsx-apply demo 授权提交`
- **AND** 没有提交，账本没有新的 takeoff

#### Scenario: takeoff-refuses-foreign-dirt-even-authorized
- **GIVEN** demo 已批准；未提交的有工件，还有 `src/x.py`
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 回复含「工作区不干净」与 `src/x.py`，不含工件路径
- **AND** 没有提交，账本没有新的 takeoff

### Requirement: 文档写明「授权提交」
`opsx-apply` 命令与 `openspec-apply-change` skill 的 Input 段 SHALL 写明「授权提交」：插件只提交本 change 的工件（change 目录、ADR 草稿、scenario 测试文件），有工件之外的未提交改动仍拒绝起飞。`opsx-propose` 命令与 `openspec-propose` skill 的硬交接 SHALL 写明可以直接发 `/opsx-apply <name> 授权提交`。
Feature: 命令与同名 skill 同改，禁漂移

#### Scenario: takeoff-commit-documented
- **GIVEN** 上述四个文件
- **WHEN** 读取
- **THEN** apply 的两份里，写到「授权提交」的那一行同时写到「工件」与「拒绝」
- **AND** propose 的两份都含 `/opsx-apply <name> 授权提交`
