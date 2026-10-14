## ADDED Requirements

### Requirement: 搁置撤销批准，起飞守卫拒飞「已搁置」
账本 SHALL 认识 `shelve` 事件（必需字段 `fp`，64 位十六进制）。起飞批准的判据 SHALL 为：账本里最后一条 `approve` 或 `shelve`（「最新决定」）是 `approve`，且其 fp 等于当前计划指纹。最新决定是 `shelve` 时，`takeoff-gate.py` SHALL 以 3 退出，stderr 含「已搁置」与搁置的指纹前 8 位，SHALL NOT 含「未批准」或「计划已变」；`ledger.py approved` SHALL 不输出指纹。

Feature: 2026-10-14 人反馈批准带一直挂着已批准、从未起飞的 change，没有撤下入口；撤下必须让此前的批准作废，否则手打 `/opsx-apply` 仍会起飞。起飞待命（`armed.ts` `classifyRefusal`）把含「未批准」「计划已变」的拒绝归为「等人按批准带」，而搁置后批准带不显示该项，所以提示文字须避开这两个词，归为「只能人处理」、只通知。

#### Scenario: shelve-revokes-approval
- **GIVEN** demo 的账本依次有 approve（当前计划指纹 F）与 shelve（指纹 F）
- **WHEN** 运行 `takeoff-gate.py --change-dir <demo>` 与 `ledger.py approved --change-dir <demo>`
- **THEN** takeoff-gate 以 3 退出，stderr 含「已搁置」与 F 的前 8 位，不含「未批准」与「计划已变」
- **AND** `ledger.py approved` 以 0 退出、stdout 为空

#### Scenario: later-approve-after-shelve-passes
- **GIVEN** demo 的账本依次有 approve（指纹 F）、shelve（指纹 F）；之后计划改动、当前指纹为 G，账本再追加 approve（指纹 G）
- **WHEN** 运行 `takeoff-gate.py --change-dir <demo>`
- **THEN** 以 0 退出，stdout 含 G 的前 8 位

### Requirement: 批准带「搁置」按钮
批准带顶部那一项可操作（没有问题、不在进行中）时，SHALL 在主按钮之后显示次要按钮「搁置」，其 key 为 `shelve:<change>:<指纹>`。按下且核对通过后，插件 SHALL 在账本追加一条 shelve 事件（fp 为当前指纹，`by.plugin` 为 flight，`by.surface` 为按下的绘制面），toast 含「已搁置」，并刷新批准带。账本里最新决定是 shelve、且其指纹等于当前指纹的 change，SHALL NOT 出现在批准带上。

Feature: 搁置适用于全部四种模式（批准起飞、起飞、批准修订并续飞、续飞）。

#### Scenario: shelve-press-writes-event-and-hides
- **GIVEN** demo 已批准（最近 approve 晚于最近 takeoff，指纹 F），批准带显示 demo 的「起飞」
- **WHEN** 按下 key 为 `shelve:demo:<F>` 的按钮
- **THEN** 账本追加了一条 ev 为 shelve、fp 为 F、`by.surface` 为 terminal 的事件；有一条 toast 含「已搁置」
- **AND** 刷新后批准带上没有任何按钮；起飞守卫没有因这次按键运行

#### Scenario: shelve-hides-halted-flight
- **GIVEN** gamma 的最新 attempt 以 kind 为 blocked 的 halt 结束，计划未改，批准带显示 gamma 的「续飞」
- **WHEN** 按下 key 为 `shelve:gamma:<F>` 的按钮
- **THEN** 账本追加了一条 fp 为 F 的 shelve 事件
- **AND** 刷新后批准带上没有 gamma；没有发生续飞（没有跑基线、起飞守卫没有运行）

### Requirement: 改动计划后重新出现
最新决定是 shelve 但其指纹不等于当前计划指纹时，批准带 SHALL 按现有规则显示该 change：未停飞时为「批准起飞」，已停飞时为「批准修订并续飞」。

#### Scenario: replanned-shelved-change-reappears
- **GIVEN** demo 的账本依次有 approve（指纹 F）与 shelve（指纹 F）；计划改动后当前指纹为 G
- **WHEN** 批准带刷新并绘制
- **THEN** 出现 key 为 `approve:demo:<G>`、label 为「批准起飞」的按钮

### Requirement: 判定器不认识 shelve 时拒绝搁置
按下「搁置」时，插件 SHALL 先用批准带读账本所用的判定器运行 `ledger.py events`。退出非 0 或输出里没有 `shelve` 时，SHALL toast 含「不认识 shelve」与「未搁置」，SHALL NOT 写账本。

Feature: 读取方不认识的事件写进账本，会让整条账本判损坏、起飞被永久拒绝（PR #39 评审 HIGH 的同类问题）。

#### Scenario: shelve-refused-when-judges-unaware
- **GIVEN** demo 未批准（指纹 F），批准带显示 demo 的「批准起飞」与「搁置」；`ledger.py events` 的输出不含 shelve
- **WHEN** 按下 key 为 `shelve:demo:<F>` 的按钮
- **THEN** 有一条 toast 含「不认识 shelve」与「未搁置」
- **AND** 没有任何写账本的 git 调用；批准带仍显示 `approve:demo:<F>`

### Requirement: 批准带读账本用主检出的判定器
批准带对 `ledger.py` 的全部调用（`approved`、`show`、`events`）SHALL 使用主 worktree 的判定器目录（有 `plan_fp.py` 的 `.claude/hooks` 或 `template/.claude/hooks`）；主 worktree 没有判定器时，SHALL 回退到该 change 所在 worktree 的目录。`plan_fp.py` 与 `slice-gate.py baseline` 的来源不变。

Feature: 账本是共享的 git 引用；起飞已用主检出的判定器读它。基于旧 main 的 worktree 自带的旧 `ledger.py` 不认识 shelve，会把搁置后的账本判成损坏。

#### Scenario: band-reads-ledger-with-main-judges
- **GIVEN** 主 worktree /repo 的判定器在 `/repo/template/.claude/hooks`；/repo/.worktrees/demo（分支 worktree-demo）里有未完成的 demo，也自带一份 `template/.claude/hooks`
- **WHEN** 会话启动、批准带刷新
- **THEN** 每次 `ledger.py` 调用的脚本路径都是 `/repo/template/.claude/hooks/ledger.py`
- **AND** `plan_fp.py` 的调用仍是 `/repo/.worktrees/demo/template/.claude/hooks/plan_fp.py`
