## ADDED Requirements

### Requirement: 评审回收工具只认本次飞行的评审员
插件 SHALL 注册工具 `submit_findings`（模型看到的名字是 `mcp__flight__submit_findings`），输入为 `{findings: [...]}`。处理规则：
- 调用者的 agentId 在当前飞行的 dispatch 事件中、role 为 reviewer，且 findings 校验通过时：SHALL 追加一条 review 事件（含该评审员的 slice 与 agent），返回一行确认文本。
- 其他任何调用者（主会话、执行体、修复 agent、别的飞行的评审员）：SHALL 拒绝，SHALL NOT 写账本。
- findings 不合法时：SHALL 返回校验错误，SHALL NOT 写账本。

这个工具 SHALL NOT 写 review 以外的任何事件。
Feature: 评审结论结构化进账本；模型可调的工具碰不到批准与门禁

#### Scenario: findings-tool-accepts-flight-reviewer
- **GIVEN** 当前飞行里 agent R 以 role reviewer、slice S1 被派发
- **WHEN** R 调用 submit_findings，findings 含 1 条 HIGH
- **THEN** 账本追加一条 review 事件，slice 为 S1，agent 为 R，findings 即那 1 条
- **AND** 工具返回字符串结果

#### Scenario: findings-tool-denies-others
- **GIVEN** 当前飞行里 agent A 是 S1 的执行体
- **WHEN** 主会话与 A 各调用一次 submit_findings
- **THEN** 两次都被拒绝，理由含「只有本次飞行派发的评审员」
- **AND** 账本没有新增事件

### Requirement: 评审员不提交就收口时提醒一次
评审员收口时，若账本里还没有它的 review 事件，插件 SHALL 回答 block 一次，要求它调用 submit_findings（没有问题就提交空列表）。之后再收口 SHALL 放行。评审员结束时仍没有 review 事件，SHALL 记该切片评审的阻断（kind 为 infra，slice 为 `review:<S>`，原因含「评审未返回」）。
Feature: 评审缺失要留痕，但不拖住飞行；整 PR 评审由 /pr-ship 兜底

#### Scenario: reviewer-stop-without-findings-blocks-once
- **GIVEN** S1 的评审员 R 没有调用过 submit_findings
- **WHEN** R 第一次与第二次收口
- **THEN** 第一次回答 block，文本含 submit_findings 与「空列表」，第二次放行
- **AND** R 结束后，账本追加 blocked：slice 为 review:S1，kind 为 infra

### Requirement: 修复 agent 收口时跑 final，落地后接上 /pr-ship
- **派发修复 agent**：状态机要求批量修复时，插件 SHALL 在基于 change 分支尖端的修复 worktree（分支 `flight/<change>/fix`）里，以 `flight:fixer`（role 为 fixer）、主模型派发。
- **修复 agent 收口**：SHALL 在修复 worktree 里跑 `slice-gate.py final`，记 gate 事件（slice 为 fix）；按状态机的续修上限回答 block 或放行。
- **跑 final**：状态机要求跑 final 时，SHALL 在 change worktree 里运行 `slice-gate.py final` 并记 final 事件。
- **落地**：SHALL 执行落地收口，记 land 事件（verdict 取 ship 裁决），清除状态行，然后用 `$.command.run` 运行 `/pr-ship <change>`。
- **停飞**：SHALL 记 halt 事件并提示原因，SHALL NOT 运行 `/pr-ship`。
Feature: 批准到 PR 之间零问询保持不变；final 红不收口（铁律 5）

#### Scenario: fixer-stop-runs-final
- **GIVEN** 修复 agent F 正在收口
- **AND** 修复 worktree 里的 `slice-gate.py final` 输出 ok 为 false、failed 为 ["G7 demo#s3"]
- **WHEN** 处理 F 的收口
- **THEN** 回答 block，文本含 "G7 demo#s3"
- **AND** 账本追加 slice 为 fix 的 gate 事件（ok 为 false）

#### Scenario: landing-runs-pr-ship
- **GIVEN** 全部切片已合回且评审有结果，没有阻断项，change worktree 里的 final 绿，ship 裁决为 ready
- **WHEN** 推进飞行
- **THEN** 账本依次追加 final（ok 为 true）与 land（verdict 为 ready）
- **AND** 运行了 `/pr-ship demo`

#### Scenario: final-red-halts
- **GIVEN** change worktree 里的 final 输出 ok 为 false、failed 为 ["G2 lint"]
- **WHEN** 推进飞行
- **THEN** 账本追加 final（ok 为 false）与 halt，原因含 "G2 lint"
- **AND** 没有运行 `/pr-ship`

### Requirement: 唯一的模型可调工具写不了批准
插件注册的工具 SHALL 只有 `submit_findings`，且 SHALL NOT 注册任何斜杠命令；`submit_findings` 写入的事件 SHALL 只能是 review。approve 事件仍只由人按批准按钮写入。
Feature: 收窄批准带 change 的「没有任何工具」：多了一个工具，但它碰不到批准

#### Scenario: only-findings-tool-registered
- **GIVEN** 插件已加载、会话已启动
- **WHEN** 列出插件注册的工具与斜杠命令
- **THEN** 工具只有 submit_findings，没有斜杠命令
- **AND** 以任何输入调用 submit_findings，都不会追加 approve 事件
