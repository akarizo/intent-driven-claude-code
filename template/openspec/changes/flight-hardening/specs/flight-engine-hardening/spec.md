## ADDED Requirements

### Requirement: 飞行中算不出计划指纹时，停飞原因如实
drive 每轮计算当前计划指纹时，`plan_fp.py` 非 0 退出或输出不是 64 位十六进制，SHALL 以「计算计划指纹失败：<stderr 首行>」停飞，SHALL NOT 判为「计划指纹已变」。停飞的飞行记录 SHALL 经 `$.ui.log` 进入转录。
Feature: 瞬时故障与计划被改是两回事，原因不能误导人

#### Scenario: drive-reports-fp-failure-distinctly
- **GIVEN** `/opsx-apply demo` 已起飞，之后 `plan_fp.py` 以 1 退出，stderr 为「plan_fp 超时」
- **WHEN** 处理 S1 执行体的结束
- **THEN** 账本末条为 halt，原因含「计算计划指纹失败」与「plan_fp 超时」，不含「计划指纹已变」
- **AND** `$.ui.log` 收到含「停飞 · demo」的文本

### Requirement: 派发执行体前先提交飞行记录
drive 派发执行体时，SHALL 先提交 change 目录内未提交的飞行记录（`land.commitRecords`），再建切片 worktree。提交失败 SHALL 记该切片的 infra 阻断，不派发。
Feature: 下一 wave 的执行体要看到上一 wave 合回后刷新的接口摘要（旧引擎每个 wave 合回后都先提交记录）

#### Scenario: executor-dispatch-commits-records-first
- **GIVEN** `/opsx-apply demo` 已起飞，waves 为 [[S1, S2], [S3]]，S1、S2 门禁绿并已合回，change 目录里 `slices/_interfaces.md` 有未提交改动
- **WHEN** drive 派发 S3 的执行体
- **THEN** 「chore(flight): 记录」的 `git commit` 排在 S3 切片 worktree 的 `git worktree add` 之前

### Requirement: 有 agent 在跑时不重复起飞
起飞时，只要上一次飞行（最新的 takeoff）派出的 agent 在 `$.agent.list()` 里仍是 pending / running / waiting，插件 SHALL 拒绝起飞，回复含「仍在运行」，SHALL NOT 写账本——不论那次飞行是否已经 land 或 halt。
Feature: 插件无法终止已派出的 agent；停飞后立刻重新起飞，会让新旧执行体同写一个切片 worktree

#### Scenario: takeoff-waits-for-live-agents-after-halt
- **GIVEN** demo 的 attempt 1 已 halt，它派出的 agent-1 在 `$.agent.list()` 里仍为 running
- **WHEN** 人再次发出 `/opsx-apply demo`
- **THEN** 回复含「仍在运行」
- **AND** 账本没有新的 takeoff 事件

### Requirement: 读不存在的文件按缺失处理，不让飞行停飞
插件的真实 Io（`ioHere`）读取不存在的文件时 SHALL 返回 undefined（与 `Io.read` 的约定一致），SHALL NOT 抛异常；其他读取错误照常抛出。测试世界的 `fs.read` SHALL 与真实引擎一致：文件不存在时抛 ENOENT。
Feature: 首飞实况——第一片合回后刷新接口摘要时 `slices/_interfaces.md` 尚不存在，`$.fs.read` 抛 ENOENT，飞行停飞；测试世界对缺失文件返回空串，掩盖了这处契约偏差

#### Scenario: merge-survives-missing-interfaces-summary
- **GIVEN** `/opsx-apply demo` 已起飞，测试世界的 `fs.read` 对不存在的文件抛 ENOENT，change 目录还没有 `slices/_interfaces.md`
- **WHEN** S1 执行体以绿门禁结束
- **THEN** 账本有 S1 的 merge 且 ok 为 true，没有 halt
- **AND** `slices/_interfaces.md` 被写出，含 `## S1` 一节
