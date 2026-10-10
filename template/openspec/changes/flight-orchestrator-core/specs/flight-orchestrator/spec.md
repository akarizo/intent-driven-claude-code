## ADDED Requirements

### Requirement: 插件接管 /opsx-apply
插件 SHALL 在 `command.run` 上接管 `/opsx-apply`。版本不低于下限、且参数不含 `--engine=workflow` 或 `--gate=per-task` 时，由插件作答，SHALL NOT 交给模型。起飞检查依次为：
1. 定位 change：参数给的 change 名；没有参数时，取会话所在 worktree 的 `worktree-<name>` 分支。
2. `takeoff-gate.py` 以 0 退出。
3. change worktree 干净。
4. `slice-gate.py lint` 与 `preflight` 绿，从 preflight 取 waves。
5. 主模型：`--model=` 优先，否则由 `session-model.py` 判定。

任一项不过 SHALL 回复原因，SHALL NOT 写账本、派发 agent。全部通过后 SHALL：
- 第一次起飞时，用 takeoff-gate 的批准证据记 timeline 的 approve 事件并提交；
- 追加 takeoff 事件（attempt 为已有 takeoff 数加 1）；
- 为可派发的切片准备 worktree、在其中运行 `slice-gate.py start <S> --expect-branch <change 分支>`，再以 `flight:executor`、主模型、cwd 为切片 worktree 派发，每次派发记 dispatch 事件。

参数含 `--engine=workflow` 或 `--gate=per-task` 时，插件 SHALL 原样交给命令文档。
Feature: 起飞是机械检查，零 token；旧引擎只能显式选择

#### Scenario: opsx-apply-taken-over
- **GIVEN** demo 已批准，change worktree 干净，lint 与 preflight 绿，waves 为 [[S1, S2], [S3]]，session-model.py 输出 opus
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 命令由插件作答，模型没有回合
- **AND** 账本依次追加 takeoff（attempt 1、model opus）、S1 与 S2 的 dispatch
- **AND** S1、S2 各以 subagentType flight:executor、model opus、cwd 为各自的切片 worktree 派发

#### Scenario: takeoff-refused-without-approval
- **GIVEN** takeoff-gate.py 以 3 退出，stderr 为「未批准」
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 回复含「未批准」与 demo 的 spec.html 路径
- **AND** 没有追加账本事件，没有派发 agent

#### Scenario: engine-workflow-passes-through
- **WHEN** 人发出 `/opsx-apply demo --engine=workflow`
- **THEN** 插件不作答，命令照旧交给模型
- **AND** 没有追加账本事件

### Requirement: 执行体收口时现跑门禁，结束时兜底
- 本次飞行派发的执行体或解冲突 agent 收口（`classic.SubagentStop`）时，插件 SHALL 在它的 worktree 里跑该切片的门禁，并记 gate 事件；状态机判「续修」时，SHALL 回答 block，文本含 failed 项。
- 这些 agent 结束（`turn.complete`）时，插件 SHALL 记 ended 事件，实际模型取自 usage.model；然后推进状态机。状态机要求补跑门禁时补跑；要求续接重派时，在同一 worktree 上用续接提示词派发。
Feature: 门禁结论来自控制面自己跑的门禁，不来自 agent 的转述

#### Scenario: stop-gate-blocks-red-executor
- **GIVEN** S1 的执行体 A 正在收口，门禁输出 ok 为 false、failed 为 ["G7 demo#s1"]
- **WHEN** 处理 A 的收口
- **THEN** 回答 block，文本含 "G7 demo#s1"
- **AND** 账本追加 S1 的 gate 事件（ok 为 false）

#### Scenario: silent-end-runs-gate-and-respawns
- **GIVEN** S1 的执行体 A 没有经过收口就结束（answer 为空）
- **AND** 补跑的门禁为红
- **WHEN** 处理 A 的结束
- **THEN** 账本依次追加 ended、gate（ok 为 false）
- **AND** 在 S1 原 worktree 上派发新执行体，提示词含「未正常收口」

### Requirement: 门禁绿就合回，冲突派解冲突 agent
切片门禁绿、执行体结束后，插件 SHALL 合回该切片，记 merge 事件。合回冲突时，SHALL 以 `flight:fixer`（role 为 resolver）、主模型、cwd 为解冲突 worktree 派发。它收口时同样现跑该切片门禁；绿且结束后，快进 change 分支并记 merge 事件。
Feature: 合回是机械动作，解冲突交给模型，结果仍由控制面判

#### Scenario: conflict-spawns-resolver
- **GIVEN** S2 门禁绿，合回时冲突，冲突文件为 a.py
- **WHEN** 处理 S2 执行体的结束
- **THEN** 以 flight:fixer 派发解冲突 agent，cwd 为 flight-demo-S2-resolve，提示词含 a.py
- **AND** 它收口时门禁绿、随后结束，change worktree 里运行 `git merge --ff-only flight/demo/S2-resolve`，账本追加 S2 的 merge（ok 为 true）

### Requirement: 飞行进度可见，飞行类型对模型隐藏
- 飞行中，插件 SHALL 用状态行显示 change 名、wave 进度、运行中的切片数与阻断数；落地或停飞时 SHALL 清除状态行。
- `flight:executor`、`flight:reviewer`、`flight:fixer` SHALL 对模型隐藏（`agent.offer` 回答不提供），只由插件派发。
Feature: 人看得到飞行在动；模型派不出飞行角色

#### Scenario: flight-status-line
- **GIVEN** `/opsx-apply demo` 已起飞，waves 为 [[S1, S2], [S3]]
- **WHEN** 派发完第一个 wave
- **THEN** 状态行含 demo、"W1/2" 与「运行 2」

#### Scenario: flight-types-hidden-from-model
- **WHEN** 引擎询问是否向模型提供 flight:executor、flight:reviewer、flight:fixer
- **THEN** 三者都回答不提供
- **AND** 询问 general-purpose 时不干预
