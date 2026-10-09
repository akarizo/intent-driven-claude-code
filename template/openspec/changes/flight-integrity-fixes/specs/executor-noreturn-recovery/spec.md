## ADDED Requirements

### Requirement: 门禁通过的结论留存到 git ref
切片门禁通过时，slice-gate SHALL 把本次门禁输出的 JSON 写进 `refs/flight/<change>/gate-<S>`：提交树里只有一个 `gate.json`，父提交是该切片的 commit（同时让这个 commit 不被回收）。写入失败不改变门禁结论，只在 warnings 里加一条说明。
Feature: 门禁结论由脚本产出，执行体没交回也能找回

#### Scenario: gate-ok-records-result-ref
- **GIVEN** 已 start 且实现完整的切片 S1
- **WHEN** 运行 `slice-gate.py gate S1` 且门禁通过
- **THEN** `refs/flight/<change>/gate-S1` 存在，其父提交是门禁输出里的 commit
- **AND** 其 `gate.json` 的 slice、ok、commit、base 与门禁输出一致

### Requirement: 重派起跑优先找回已留存的门禁结论
`start <S> --resume-checkpoint` SHALL 先查 `refs/flight/<change>/gate-<S>`。满足以下全部条件时，SHALL 以 3 退出，stdout 为留存的门禁 JSON 加 `"recovered": true`，不写切片标记，不恢复快照：
- 记录 ok 为 true；
- 记录的 slice 为 S；
- 当前 HEAD 等于记录的 base 或记录的 commit。

不满足时 SHALL 忽略这条记录，保持原样，按原有逻辑恢复快照起跑。
Feature: 门禁已过、只是没交回结论的执行体，重派约 2 轮即可交回

#### Scenario: resume-start-returns-recorded-gate
- **GIVEN** 切片 S1 在基点 X 上提交并门禁通过，结论已留存
- **AND** 从 X 新开一个干净 worktree
- **WHEN** 在新 worktree 里运行 `start S1 --resume-checkpoint`
- **THEN** 以 3 退出，stdout 是留存的门禁结论，ok 为 true、commit 为原切片 commit、recovered 为 true
- **AND** 新 worktree 里没有切片标记

#### Scenario: resume-start-ignores-foreign-gate-record
- **GIVEN** 切片 S1 的门禁结论已留存（base X、commit C）
- **AND** C 之后又有一个提交 Y，在 Y 上新开 worktree
- **WHEN** 在 Y 上运行 `start S1 --resume-checkpoint`
- **THEN** 以 0 退出并按原有逻辑起跑（输出含 checkpoint、不含 recovered）
- **AND** 留存的门禁结论引用保持不变

### Requirement: 门禁结论引用的生命周期
`record` 写回切片 S 的门禁结论后（包括「已记录过」的情形），SHALL 删除 `refs/flight/<change>/gate-<S>`。首轮 `start <S>`（不带 `--resume-checkpoint`）SHALL 清掉残留的同名引用，以免误找回上一次飞行的结论。
Feature: 结论只活到被合回为止

#### Scenario: record-and-fresh-start-clear-gate-ref
- **GIVEN** 切片 S1 门禁通过、结论已留存
- **WHEN** integrator 以 `record` 写回该结论
- **AND** 之后人为放回一份旧结论，再首轮 `start S1`
- **THEN** 写回后引用已不存在
- **AND** 首轮 start 后旧结论也被清掉

### Requirement: 工作流把执行体调用抛错当作未返回
执行体的 `agent()` 调用抛错（例如没调用结构化输出）时，工作流 SHALL 与「返回空」同样处理：带 `--resume-checkpoint` 重派一次。重派仍抛错或仍无结论时，SHALL 记 blocked，kind 为 infra，原因写明未返回且已重派。依赖它的切片 SHALL 记 blocked、不派发。
Feature: 历史教训——S3 撞轮次上限，重派被抛错跳过，原因却写「已重派一次」

#### Scenario: workflow-retries-when-executor-throws
- **GIVEN** waves 为 [[S1, S2], [S3]]
- **AND** S1 首轮的 agent 调用抛错，重派后门禁绿；S2、S3 一次绿
- **WHEN** 跑完整个工作流
- **THEN** 派发了 S1:retry，其 start 带 `--resume-checkpoint`
- **AND** blocked 为空

#### Scenario: workflow-blocks-after-retry-throws
- **GIVEN** waves 为 [[S1, S2], [S3]]，S3 依赖 S1
- **AND** S1 首轮与重派的 agent 调用都抛错
- **WHEN** 跑完整个工作流
- **THEN** S1 与 S1:retry 各派发一次
- **AND** blocked 中 S1 的 kind 为 infra、原因含「未返回」与「已重派」
- **AND** S3 记 blocked 且未派发

### Requirement: 执行体契约与回退路径同步
`slice-executor.md` 的开工段 SHALL 写明：start 以 3 退出时，stdout 是被找回的已留存门禁结论，原样作为最终输出、不做任何改动。`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` 的回退路径 SHALL 同改，写明 agent 调用抛错与未返回同样重派一次。
Feature: 命令与同名 skill 同改，禁漂移

#### Scenario: apply-docs-describe-recovered-gate
- **GIVEN** slice-executor.md、opsx-apply.md 与 openspec-apply-change/SKILL.md
- **WHEN** 读执行体开工段与两份回退路径段
- **THEN** 开工段写明「以 3 退出」时打印的是已留存的门禁结论、原样返回
- **AND** 两份回退路径都写明 agent 调用抛错与未返回同样重派
