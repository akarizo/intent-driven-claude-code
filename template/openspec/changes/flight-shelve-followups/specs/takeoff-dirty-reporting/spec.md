## ADDED Requirements

### Requirement: porcelain 改名行归为工件之外
插件对 change worktree 未提交路径分类时，路径含 ` -> `（porcelain 的改名行，X 位与 Y 位改名都是这个形状）SHALL 归为工件之外，即使源或目标路径在 change 目录内。起飞因此 SHALL 按「工件之外」拒绝，SHALL NOT 提交任何文件（含遗留飞行记录）。

Feature: #44 评审 MEDIUM：改名行被当成工件，`git add` 失败后报「提交工件失败」，之前可能已单独提交了记录；`flight-dispatch-followups` backlog 的「Y 位改名」同属此类。

#### Scenario: rename-refused-before-any-commit
- **GIVEN** demo 已批准、账本为空；`git status --porcelain` 有三行：`R  <change 目录>/a.md -> <change 目录>/b.md`、` R <change 目录>/c.md -> <change 目录>/d.md`、`?? <change 目录>/proposal.md`
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 回复含「工作区不干净」「工件之外」与这两条改名行（去掉 XY 两列后的原文）
- **AND** 没有任何 git add 或 git commit；账本没有 takeoff

### Requirement: 拒绝信息与起飞回复逐行列出工件路径
未提交改动只有工件、且没有「授权提交」而拒绝起飞时，回复 SHALL 逐行列出这些工件路径。经「授权提交」提交工件后起飞时，回复 SHALL 写明已提交的工件个数，并逐行列出这些路径。有工件之外改动时，拒绝信息仍只列工件之外的路径。

Feature: #44 评审 MEDIUM：插件让人「确认无误」，却只给个数，人无法核对。

#### Scenario: refusal-lists-artifact-paths
- **GIVEN** demo 已批准、账本为空；未提交的只有 `<change 目录>/proposal.md`、`template/openspec/adr/DRAFT-x.md` 与 scenario 测试文件 `tests/test_s1.py`
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 回复含「工作区不干净」、`/opsx-apply demo 授权提交`，并且这三个路径各占一行
- **AND** 没有提交，账本没有新的 takeoff

#### Scenario: takeoff-reply-lists-committed-artifacts
- **GIVEN** 同上
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 回复含「✈ 起飞」、「已提交工件 3 个文件」，并且这三个路径各占一行

### Requirement: 批准带逐行列出将被提交的工件
批准带显示「批准起飞」「起飞」或「批准修订并续飞」且有未提交工件时，说明行「按下会提交本 change 的 N 个工件…」之下 SHALL 逐行列出工件路径，至多 5 行；超过 5 个时，第 6 行 SHALL 为「…另 K 个」（K = N − 5）。

#### Scenario: band-lists-artifact-paths
- **GIVEN** demo 未批准；`git status` 列出 demo 的 7 个未提交工件 `<change 目录>/f1.md` … `<change 目录>/f7.md`
- **WHEN** 批准带刷新并绘制
- **THEN** 有含「提交本 change 的 7 个工件」的说明行；f1.md 至 f5.md 各有一行文字
- **AND** 有一行文字为「…另 2 个」；没有含 f6.md 或 f7.md 的文字
