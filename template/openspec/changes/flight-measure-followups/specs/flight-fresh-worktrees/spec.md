## ADDED Requirements

### Requirement: 新派发遇到同名 worktree 时另起一棵
`io.freshWorktree(io, f, name, attempt)` SHALL：
- `flight-<change>-<name>` 不存在时，基于 change 分支尖端以 `name` 建 worktree（分支 `flight/<change>/<name>`）；
- 已存在时，改建 `<name>-a<attempt>`（分支 `flight/<change>/<name>-a<attempt>`），SHALL NOT 改动已存在的 worktree；
- 两者都已存在时返回错误；
- 返回 `{ path, branch }`。
Feature: flight-measure attempt 2/3：S7 被派进计划修订前的旧 worktree，按旧 owns 判门禁

#### Scenario: fresh-worktree-never-reuses-old
- **GIVEN** 主 worktree M、change demo；`M/.claude/worktrees/flight-demo-S1` 已存在
- **WHEN** 分别以 `name='S2', attempt=2` 与 `name='S1', attempt=2` 调用 `freshWorktree`，再在 `flight-demo-S1-a2` 也已存在时以 `name='S1', attempt=2` 调用
- **THEN** 第一次执行 `git worktree add -b flight/demo/S2 <M>/.claude/worktrees/flight-demo-S2 worktree-demo`，返回该路径与分支
- **AND** 第二次执行 `git worktree add -b flight/demo/S1-a2 <M>/.claude/worktrees/flight-demo-S1-a2 worktree-demo`，没有任何作用于 `flight-demo-S1` 的 git 命令
- **AND** 第三次返回错误，没有执行 `git worktree add`

### Requirement: 合回、解冲突、修复合回按记下的分支
`land.mergeSlice`、`prepareResolve`、`finishResolve`、`mergeFix` SHALL 接受调用方给出的分支（解冲突另给 worktree 与分支），并对该分支做合并、已合回判定、越界与空合回检查；不给时沿用旧的分支拼法。解冲突 worktree SHALL 按「新派发另起」的规则命名。
Feature: 另起的 worktree 用的是新分支名，写死的拼法会合错分支

#### Scenario: merges-use-recorded-branch
- **GIVEN** change demo 的切片 S1 在分支 `flight/demo/S1-a2` 上有提交；修复体在分支 `flight/demo/fix-a2` 上
- **WHEN** 以 `branch='flight/demo/S1-a2'` 调用 `mergeSlice`；以该分支、`attempt=2` 调用 `prepareResolve`（`flight-demo-S1-resolve` 已存在）；以 `branch='flight/demo/fix-a2'` 调用 `mergeFix`
- **THEN** `mergeSlice` 的 `git merge --no-ff` 合并的是 `flight/demo/S1-a2`，不出现 `flight/demo/S1` 这个分支名
- **AND** `prepareResolve` 新建 `flight-demo-S1-resolve-a2`（分支 `flight/demo/S1-resolve-a2`），在其中合并 `flight/demo/S1-a2`
- **AND** `mergeFix` 合并的是 `flight/demo/fix-a2`

### Requirement: 续接只限同一份计划
`core.next` 在本 attempt 首次派发某片时，若上一个执行体 dispatch 所在 attempt 的 takeoff 指纹与本次 takeoff 不同，SHALL 给出不带续接说明、不带 base 的新派发，SHALL NOT 给出 regate；指纹相同时行为不变。
Feature: 计划修订后续接旧现场 = 按旧切片包继续做

#### Scenario: plan-change-forces-fresh-dispatch
- **GIVEN** attempt 1（指纹 A）派发过 S1 的执行体，S1 的门禁已绿但未合回；另一份账本的 S2 在 attempt 1 中断（门禁红）
- **WHEN** attempt 2 以指纹 B 起飞后求下一批动作；再把 attempt 2 的指纹改为 A 求一次
- **THEN** 指纹 B 时 S1 与 S2 都是不带 `continuation`、不带 `base` 的执行体派发
- **AND** 指纹 A 时 S1 为 regate、S2 为带续接说明的派发（与现状相同）

### Requirement: dispatch 事件记下分支
`ev.dispatch` SHALL 接受可选的 `branch` 并写入事件；`agentOf` SHALL 返回该 dispatch 的 `branch`。旧事件没有 `branch` 时，SHALL 由 worktree 路径（`…/flight-<change>-<name>`）推出 `flight/<change>/<name>`。
Feature: 合回与续接都要知道该片实际所在的分支

#### Scenario: dispatch-records-branch
- **GIVEN** 一条带 `branch: 'flight/demo/S1-a2'` 的 dispatch 事件，以及一条不带 `branch`、worktree 为 `/m/.claude/worktrees/flight-demo-S3` 的 dispatch 事件
- **WHEN** 对两个 agent 分别调用 `agentOf`
- **THEN** 前者的 `branch` 为 `flight/demo/S1-a2`
- **AND** 后者的 `branch` 为 `flight/demo/S3`

### Requirement: 另起 worktree 时提示上一次的分支
执行体提示词 SHALL 支持可选的 `previous: { branch, attempt }`；给出时 SHALL 写明「上一次（attempt k）的分支 <branch> 留作参考：可 git show / git diff 读取，不得 cherry-pick 或 merge；以当前切片包为准」。
Feature: 旧现场里的成果可以参考，但不能合并（D4）

#### Scenario: prompt-names-previous-branch
- **GIVEN** `executorPrompt` 的输入带 `previous: { branch: 'flight/demo/S1', attempt: 1 }`
- **WHEN** 生成执行体提示词，并另生成一份不带 `previous` 的
- **THEN** 前者含 `flight/demo/S1`、「git show」与「不得 cherry-pick」
- **AND** 后者不含「上一次」

### Requirement: 控制面派发时另起 worktree 并按记下的分支合回
控制面 SHALL：
- 对新派发的执行体、每个 attempt 首次派发的修复体、每次派发的解冲突 agent，用 `freshWorktree` 取得 worktree；
- 把分支记进 dispatch 事件；
- 续接时复用上一个执行体 dispatch 的 worktree 与分支（该 worktree 已不存在时按新派发处理）；
- 合回时使用本片最后一次门禁绿的 agent 的分支，修复合回使用修复体 dispatch 的分支；
- 另起 worktree 且本片先前有过执行体 dispatch 时，在提示词中给出上一次的分支。
Feature: flight-measure attempt 2/3 与修复体复用旧现场

#### Scenario: fresh-dispatch-gets-new-worktree
- **GIVEN** demo 的 S1 在 attempt 1 中被 blocked，其 worktree `flight-demo-S1` 仍在；attempt 2 起飞
- **WHEN** 控制面派发 S1 的执行体，执行体收口门禁绿后合回
- **THEN** 执行端收到 `git worktree add -b flight/demo/S1-a2 …/flight-demo-S1-a2`，dispatch 事件的 worktree 与 branch 都指向它
- **AND** 执行体提示词含 `flight/demo/S1`（上一次的分支）
- **AND** 合回的 `git merge --no-ff` 合并 `flight/demo/S1-a2`

#### Scenario: continuation-reuses-same-plan-worktree
- **GIVEN** demo 的 S1 在 attempt 1（指纹 A）中断，worktree `flight-demo-S1` 仍在；attempt 2 以同一指纹 A 起飞
- **WHEN** 控制面派发 S1 的执行体
- **THEN** 没有新的 `git worktree add`，执行体在 `flight-demo-S1` 里续接
- **AND** dispatch 事件的 branch 为 `flight/demo/S1`，提示词含续接说明

#### Scenario: fixer-gets-new-worktree
- **GIVEN** demo 在 attempt 1 派过修复体，`flight-demo-fix` 仍在；attempt 2 的切片都已合回，评审有 HIGH
- **WHEN** 控制面派发修复体，修复体收口绿后合回
- **THEN** 执行端收到 `git worktree add -b flight/demo/fix-a2 …/flight-demo-fix-a2`，修复体 dispatch 事件的 branch 为 `flight/demo/fix-a2`
- **AND** 修复合回的 `git merge --no-ff` 合并 `flight/demo/fix-a2`
