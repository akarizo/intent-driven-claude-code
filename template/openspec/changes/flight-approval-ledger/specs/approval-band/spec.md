## ADDED Requirements

### Requirement: 批准带展示待批准的飞行计划
flight 插件 SHALL 在会话启动、主会话每轮结束与每次批准后刷新「待批准计划」列表：遍历会话所在仓库的全部 worktree（`git worktree list --porcelain`），在每个 worktree 的 `openspec/changes/*` 与 `template/openspec/changes/*` 下找出**含 `spec.html` 且 `tasks.md` 仍有未勾选项（`- [ ]`）**的 change。同名 change 出现在多个 worktree 时 SHALL 只取分支为 `worktree-<name>` 的那个 worktree，没有则取主 worktree，二者都没有则忽略（其余 worktree 里的同名目录是别的分支的快照）。对每个候选，用其 worktree 的 `plan_fp.py`（依次探测 `.claude/hooks/` 与 `template/.claude/hooks/`）算当前指纹、用 `ledger.py approved` 取已批准指纹，两者不等即为待批准。存在待批准计划时，输入框上方的批准带 SHALL 显示最近修改的那个 change 的名字、指纹前 8 位、`spec.html` 绝对路径与「批准起飞」按钮，并注明另有几个待批准；没有待批准计划时批准带 SHALL 不显示。
Feature: 人在同一处看到「批什么」与「指纹是多少」

#### Scenario: band-shows-pending-plan
- **GIVEN** 会话仓库里有 change `demo`，其指纹前 8 位为 `3f9a1c07`，`tasks.md` 有未勾选项，账本无批准记录
- **WHEN** 会话启动后绘制输入框上方区域
- **THEN** 批准带显示 `demo`、`3f9a1c07`、`demo` 的 `spec.html` 绝对路径与「批准起飞」按钮

#### Scenario: band-ignores-finished-and-foreign-copies
- **GIVEN** 主 worktree 里有已全部勾选的 change `old`；分支 `worktree-demo` 的 worktree 与另一个分支 `wf_x` 的 worktree 里都有未完成的 `demo`
- **WHEN** 会话启动后刷新待批准列表
- **THEN** 列表只有一项 `demo`，其 `spec.html` 路径位于分支 `worktree-demo` 的 worktree 内
- **AND** `old` 不在列表中

### Requirement: 按下批准在进程内写账本
批准按钮的地址 SHALL 携带它所显示的 change 与指纹（`approve:<change>:<指纹>`），按下时以该按钮代表的项为准，不取按下时刻的最新一项；列表刷新后旧按钮的按压不得落到新显示的项上。人按下「批准起飞」时，插件 SHALL 先重新计算该 change 的指纹；与批准带上显示的不一致 SHALL 不写账本、提示「计划已变化」并刷新。一致时 SHALL 在插件进程内用 git 底层命令（`hash-object -w --stdin` → `mktree` → `commit-tree` → 带旧值的 `update-ref`）把 `approve` 事件追加到 `refs/flight/<change>/ledger`，事件的 `by` 含 `plugin`、`surface` 与会话 id；所有追加经同一个队列串行执行；`update-ref` 因旧值不符失败时 SHALL 重读链尾后重试，最多 3 次，仍失败则提示错误且不视为批准。写入成功后 SHALL 把 `/opsx-apply <change>` 预填进输入框（不代为提交）。
Feature: 批准只能来自人的按压，写入由控制面完成

#### Scenario: approve-press-appends-ledger-event
- **GIVEN** 批准带显示 `demo` 与指纹 F，按下时重算的指纹仍是 F
- **WHEN** 人按下「批准起飞」
- **THEN** 插件按 `hash-object`、`mktree`、`commit-tree`、`update-ref refs/flight/demo/ledger` 的顺序执行 git 命令，写入的事件 `ev` 为 `approve`、`fp` 为 F、`by.plugin` 为 `flight`
- **AND** 输入框被预填为 `/opsx-apply demo`
- **AND** 绘制后列表刷新、另一个 change 成为显示项时，按下当初显示 `demo` 的按钮不会批准新显示的项

#### Scenario: approve-press-refuses-changed-plan
- **GIVEN** 批准带显示 `demo` 与指纹 F，但按下时重算的指纹为 G
- **WHEN** 人按下「批准起飞」
- **THEN** 不执行任何写账本的 git 命令，输入框不被预填
- **AND** 出现含「计划已变化」的提示

#### Scenario: ledger-append-retries-on-conflict
- **GIVEN** 第一次 `update-ref` 因旧值不符失败、第二次成功；另一种情形下三次都失败
- **WHEN** 人按下「批准起飞」
- **THEN** 前一种情形重读链尾后再追加，最终成功并预填输入框
- **AND** 后一种情形在第三次失败后停止，出现错误提示，输入框不被预填

### Requirement: 模型侧没有写账本的路径
插件 SHALL NOT 注册任何模型可调用的工具，也 SHALL NOT 注册会写账本的斜杠命令。插件 SHALL 拦截命令文本中出现 `refs/flight/<任意>/ledger` 的 Bash / Monitor 调用，以及目标路径含 `refs/flight/` 或为 `packed-refs` 的 Write / Edit / NotebookEdit 调用（不论主会话还是子 agent），拒绝理由指向只读的 `ledger.py show`；该守卫出错时 SHALL 对命中模式的调用仍然拒绝。
Feature: 历史教训——模型曾自己跑命令记下「批准」

#### Scenario: bash-guard-denies-ledger-writes
- **GIVEN** 插件已加载
- **WHEN** 模型发起 Bash 命令 `git update-ref refs/flight/demo/ledger abc` 与 `git status`
- **THEN** 前者被拒绝，拒绝理由含 `ledger.py show`
- **AND** 后者照常执行
- **AND** Monitor 跑同样的命令、Write / Edit / NotebookEdit 写 `.git/refs/flight/demo/ledger` 或 `.git/packed-refs` 同样被拒绝，写其他文件照常执行

#### Scenario: no-model-callable-approval-path
- **GIVEN** 插件已加载、会话已启动
- **WHEN** 列出插件注册的工具与斜杠命令
- **THEN** 没有任何工具
- **AND** 没有任何会写账本的命令

#### Scenario: plugin-manifest-validates
- **GIVEN** 仓库中的 `template/plugins/flight/`
- **WHEN** 运行 `claude plugin validate`
- **THEN** 校验通过

### Requirement: 版本下限
会话启动时，Claude Code 版本低于 2.1.295（本设计实测所用版本）时，插件 SHALL 停用批准带与账本写入，并提示版本要求；守卫仍然生效。
Feature: 未实测的引擎版本上不提供批准

#### Scenario: version-floor-disables-band
- **GIVEN** 会话报告的 Claude Code 版本为 2.1.200，仓库里有待批准的 change
- **WHEN** 会话启动后绘制输入框上方区域
- **THEN** 批准带不显示
- **AND** 出现含 2.1.295 的版本提示
