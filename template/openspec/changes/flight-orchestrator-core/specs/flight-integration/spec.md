## ADDED Requirements

### Requirement: 合回由控制面执行
合回门禁绿的切片 S 时，控制面 SHALL 在 change worktree 里依次执行：
1. change 目录内有未提交的飞行记录（timeline.md、gate-report.md、evidence.log、slices/_interfaces.md）时，只 add 这些文件并提交 `chore(flight): 记录`；
2. `git merge --no-ff flight/<change>/<S> -m "integrate: <S>"`；
3. `slice-gate.py record --change-dir <dir> --json <S 的门禁 JSON>`；
4. 刷新 `slices/_interfaces.md` 中 S 的一节：对 S 的 owns 里存在的源文件，取匹配 `^(def |class |export |func |pub )` 的行，只要签名、不要函数体。

成功时 SHALL 返回 ok 与合并后的 commit。
Feature: integrator 的四件机械活变成代码，零 token

#### Scenario: land-merges-green-slice
- **GIVEN** S1 门禁绿，change 目录里有未提交的 gate-report.md，S1 的 owns 含 `src/a.py`，其中有一行 `def run(x):`
- **WHEN** 合回 S1
- **THEN** 依次运行：只 add 飞行记录的提交、`git merge --no-ff flight/demo/S1 -m "integrate: S1"`、`slice-gate.py record … --json <S1 门禁 JSON>`
- **AND** `slices/_interfaces.md` 的 S1 一节含 `def run(x):`
- **AND** 返回 ok 与合并后的 commit

### Requirement: 合回冲突交给解冲突 agent
`git merge` 因冲突失败时，控制面 SHALL：
1. 在 change worktree 里 `git merge --abort`，change 分支保持原样；
2. 基于 change 分支尖端，建解冲突 worktree `<主 worktree>/.claude/worktrees/flight-<change>-<S>-resolve`（分支 `flight/<change>/<S>-resolve`）；
3. 在其中重做同一合并，留下冲突；
4. 返回冲突文件列表。

解冲突完成时，SHALL 先确认解冲突 worktree 里没有未合并的文件、HEAD 是合并提交，再在 change worktree 里 `git merge --ff-only flight/<change>/<S>-resolve`；任一条件不满足 SHALL 返回失败，不动 change 分支。
Feature: 解冲突是创造性工作交给模型；冲突现场不放在人所在的 worktree

#### Scenario: land-aborts-conflict-and-prepares-resolver
- **GIVEN** 合回 S2 时 `git merge` 退出非 0，未合并文件为 a.py
- **WHEN** 合回 S2
- **THEN** change worktree 里运行了 `git merge --abort`
- **AND** 建了 flight-demo-S2-resolve worktree，并在其中运行 `git merge --no-ff flight/demo/S2`
- **AND** 返回冲突文件 [a.py]

#### Scenario: land-fast-forwards-after-resolution
- **GIVEN** 解冲突 worktree 里没有未合并文件，HEAD 有两个父提交
- **WHEN** 完成 S2 的合回
- **THEN** change worktree 里运行 `git merge --ff-only flight/demo/S2-resolve`
- **AND** 若仍有未合并文件，则返回失败，且没有运行 `--ff-only`

### Requirement: findings 校验
评审回收的输入 SHALL 是 `{findings: [...]}`，每项：
- `severity` ∈ CRITICAL / HIGH / MEDIUM / LOW；
- `file` 为非空字符串；
- `line` 为整数；
- `summary`、`fix` 为字符串。

不合法 SHALL 拒绝并点名第几项的哪个字段；空列表合法。
Feature: findings 进账本之前必须是结构化的

#### Scenario: land-validates-findings
- **GIVEN** 一份 findings，第 2 项的 severity 为 "SEVERE"
- **WHEN** 校验
- **THEN** 拒绝，理由含「第 2 项」与 severity
- **AND** 校验 `{findings: []}` 时接受

### Requirement: 落地收口
final 绿之后，控制面 SHALL 在 change worktree 里：
1. 写 `review-findings.json`，内容为 `{blocked, blocking, deferred, fix}`。blocking 含 CRITICAL / HIGH 与路由对账的 HIGH；deferred 含 MEDIUM / LOW。
2. 在 tasks.md 里把已合回切片的 `- [ ] <S> ` 行勾为 `- [x] <S> `，被阻断的切片不勾。
3. `timeline.py record apply-done`。
4. 提交飞行记录与 review-findings.json、tasks.md（`chore(flight): 收口`）。
5. 运行 `slice-gate.py ship`，返回裁决（退出 0 为 ready，1 为 draft）。
Feature: 原来由主会话手做的收口变成代码

#### Scenario: land-closeout-writes-records
- **GIVEN** S1、S2 已合回，S3 被阻断（gate），阻断项为 0，deferred 有 1 条 LOW，没有修复
- **WHEN** 落地收口
- **THEN** review-findings.json 的 blocked 含 S3，blocking 为空，deferred 含那条 LOW，fix 为 null
- **AND** tasks.md 里 S1、S2 的行已勾选，S3 未勾选
- **AND** 运行了 `timeline.py record apply-done`、收口提交与 `slice-gate.py ship`，返回 ship 的裁决
