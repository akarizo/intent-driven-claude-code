## ADDED Requirements

### Requirement: 起飞拒绝按回复文本分为六类
纯模块 `template/plugins/flight/hooks/armed.ts` 的 `classifyRefusal(text)` SHALL 按起飞回复文本里的固定字样分类，自上而下取第一条命中：

| 类 | 回复文本（`flight：` 之后） |
|---|---|
| `wait-baseline` | 以「slice-gate preflight 未通过」开头且含「基线仍在跑」 |
| `wait-agents` | 含「上一次飞行派出的 agent 仍在运行」 |
| `transient` | 以「起飞异常」「账本读取失败」「提交遗留飞行记录失败」「计算计划指纹失败」「写 takeoff 事件失败」之一开头；或为「工作区不干净，不起飞：」紧跟换行（git status 本身失败） |
| `model` | 以「提交工件失败」「slice-gate lint 未通过」「slice-gate preflight 未通过」之一开头（且不属上面的 wait-baseline） |
| `human-key` | 含「未提交的只有本 change 的工件」；或以「起飞守卫未通过」开头且含「未批准」或「计划已变」 |
| `human` | 其余全部，包括认不出的文本 |

Feature: 用户定（Q1–Q8 全按推荐）：被拒后不丢掉起飞意图，按「谁能解决」分别处理。认不出的归 human：只会退化成通知人，不会误重试。

#### Scenario: refusals-classified
- **GIVEN** 下列起飞回复：
  - 「flight：slice-gate preflight 未通过：基线仍在跑（已 1 分钟，上次全量约 2 分钟）：等它结束再起飞」
  - 「flight：demo 上一次飞行派出的 agent 仍在运行（attempt 2），等它们结束再起飞」
  - 「flight：起飞异常，不起飞（flight: $.process.run(python3) aborted）」
  - 「flight：工作区不干净，不起飞：\nfatal: Unable to create index.lock」
  - 「flight：slice-gate lint 未通过：overlap: 同一 wave 的 S1 与 S2 都覆盖 a.ts」
  - 「flight：slice-gate preflight 未通过：基线中断（进程 123 已不在）：重跑 slice-gate.py baseline」
  - 「flight：起飞守卫未通过：takeoff-gate: 未批准：账本里没有这个 change 的批准记录。」
  - 「flight：起飞守卫未通过：takeoff-gate: 账本损坏：abcd1234 坏事件。」
  - 「flight：工作区不干净，不起飞：未提交的只有本 change 的工件（2 个）。」
  - 「flight：demo 的 attempt 2 由另一个会话（abcd1234）起飞，尚未落地或停飞」
  - 「一句认不出的话」
- **WHEN** 逐个调用 `classifyRefusal`
- **THEN** 依次得到 wait-baseline、wait-agents、transient、transient、model、model、human-key、human、human-key、human、human

### Requirement: 待命的预算与过期
`armed.ts` 的 `nextStep(arm, event, now)` SHALL 先按以下规则判断是否放弃：
- `now - arm.since` 超过 30 分钟（`ARM_TTL_MS = 1800000`）→ `give-up`，原因含「已过期」；
- `human-key`、`human` 类 → 立即 `give-up`，原因含拒绝原文首行；
- `transient`、`model` 类在 `refused` 事件上：已计入预算的重试满 3 次（`ARM_BUDGET = 3`）→ `give-up`，原因含「重试已用尽」；
- `transient` 类在 `refused` 事件上，若上一次自动重试的结果也是 transient（`transientAgain`）→ `give-up`。

`wait-baseline`、`wait-agents` 的重试 SHALL NOT 计入预算，只受 30 分钟约束。

Feature: 用户定 Q6：最多 3 次、30 分钟内有效；Q8：偶发只重试一次。

#### Scenario: armed-budget-and-expiry
- **GIVEN** 四个待命：
  - 甲：model 类，已计入预算的重试 3 次；
  - 乙：wait-baseline 类，已因「基线仍在跑」重试 5 次，待命 10 分钟；
  - 丙：wait-baseline 类，待命 31 分钟；
  - 丁：transient 类，上一次自动重试的结果仍是 transient
- **WHEN** 甲、丁遇 `refused` 事件，乙、丙遇 `tick` 事件，分别求 `nextStep`
- **THEN** 甲为 give-up，原因含「重试已用尽」
- **AND** 乙为 retry
- **AND** 丙为 give-up，原因含「已过期」
- **AND** 丁为 give-up

### Requirement: 各类待命在什么事件上推进
未放弃时，`nextStep` SHALL 按事件给出下一步：
- `wait-baseline`：`tick` → `retry`；
- `wait-agents`：`agent-ended` 或 `tick` → `retry`；
- `transient`：`refused` → `wait`，`ms` 为 10000（`TRANSIENT_DELAY_MS`）；`timer` → `retry`；
- `model`：`refused` → `submit`，正文由 `modelPrompt(arm)` 给出；`main-turn` 且 `awaitingModel` 为真 → `retry`；
- 其余组合 → `wait`（不带 ms）。

`modelPrompt(arm)` SHALL 含：拒绝原文；「只修工作区与本 change 工件」；「改了计划需要人在批准带重新批准」；「不要发 /opsx-apply」。

Feature: 用户定 Q5：交给模型修；Q7：事件驱动 + 60 秒兜底。

#### Scenario: armed-decides-next-step
- **GIVEN** wait-agents、transient、model 三类待命各一个，都未用过预算；model 那个的拒绝原文为「flight：slice-gate lint 未通过：overlap …」
- **WHEN**：
  - wait-agents 遇 `agent-ended`；
  - transient 先遇 `refused`，再遇 `timer`；
  - model 先遇 `refused`；标为 `awaitingModel` 后遇 `main-turn`；另遇 `tick`
- **THEN** 依次为：retry；wait（ms 10000）与 retry；submit、retry 与 wait
- **AND** submit 的正文含「slice-gate lint 未通过：overlap」「只修工作区与本 change 工件」「改了计划需要人在批准带重新批准」「不要发 /opsx-apply」

### Requirement: 起飞被拒即进入待命
人发出的起飞被拒时，插件 SHALL 用 `classifyRefusal` 分类。人发出的起飞包括：`/opsx-apply`、`/flight resume`，以及经 `takeoffNow` 的批准带按键。
- **human、human-key 类**：SHALL NOT 进入待命，经 `ctx.notify` 发出原因首行与做法。human-key 的做法为「在批准带按『批准起飞』或『起飞』」。
- **其余类**：
  - SHALL 把待命写进会话状态 `flight.armed.items[<change>]`；
  - 命令回复为原拒绝文本，之后另起一行「已进入起飞待命：<原因首行>」；
  - 状态行显示 `armedLine(arm, now)`（含「起飞待命」）；
  - 通知一次。
- 同一 change 再次由人发出起飞时，SHALL 以新待命替换旧的，预算重新计算。

Feature: 用户定 Q4：待命状态放会话内，不进账本。

#### Scenario: refused-takeoff-arms
- **GIVEN** 测试世界里 demo 已批准；slice-gate preflight 以 1 退出，stderr「基线仍在跑（已 1 分钟，上次全量约 2 分钟）：等它结束再起飞」
- **WHEN** 发 `/opsx-apply demo`
- **THEN** 回复首行与原拒绝文本相同，其后一行含「已进入起飞待命」与「基线仍在跑」
- **AND** 状态行含「起飞待命」与 demo
- **AND** `ui.notify` 收到一次含 demo 与「起飞待命」的通知
- **AND** 账本没有追加 takeoff

### Requirement: 待命按事件自动推进
插件 SHALL 在以下事件上对每个待命求 `nextStep` 并执行：
- 60 秒兜底 tick（复用看门狗计时器）；
- 本 change 的飞行 agent 结束（`turn.complete` 带 agentId）；
- 主会话一轮结束（`turn.complete` 不带 agentId，由带 `{ turnId: /./ }` matcher 的 hook 接收）；
- `clock.after` 计时到。

执行规则：
- `retry`：以原参数重新起飞；transient、model 类先把已计入预算的次数加一。又被拒时按新原文更新待命并以 `refused` 再求一次。
- `submit`：经 `$.clock.after(0, …)` 调用 `$.prompt.submit`，并把 `awaitingModel` 置真。SHALL NOT 在 `command.run` 的处理中调用 `$.prompt.submit`（引擎会拒绝）。
- `wait`：给出 `ms` 时起 `$.clock.after(ms)`，到点产生 `timer`。
- `give-up`：清除待命，并通知原因与做法。
- 重试成功（账本追加了 takeoff）时，SHALL 清除待命并通知「已起飞」。

Feature: 实测（CLI 2.1.296）：本地命令返回后用 clock.after(0) 提交，会起一轮模型对话，插件能看到它的 turn.complete；同一事件上第三个带 matcher 的 hook 可以共存。

#### Scenario: wait-retries-takeoff
- **GIVEN** demo 因「基线仍在跑」进入待命；之后 preflight 改为通过
- **WHEN** 时钟推进 60 秒（看门狗计时器 tick）
- **THEN** 插件自动重试起飞，账本追加 takeoff
- **AND** demo 的待命被清除，状态行不再含「起飞待命」，`ui.notify` 收到含「已起飞」的通知
- **AND** 另一个世界里 demo 因「上一次飞行派出的 agent 仍在运行」进入待命，该 agent 结束（`turn.complete` 带其 agentId）后自动重试，账本追加 takeoff

#### Scenario: model-fix-submits-then-retries
- **GIVEN** demo 已批准；slice-gate lint 第一次以 1 退出、stderr「overlap: 同一 wave 的 S1 与 S2 都覆盖 a.ts」，之后通过
- **WHEN** 发 `/opsx-apply demo`；推进时钟让 `clock.after(0)` 到点；随后主会话一轮结束（`turn.complete` 不带 agentId）
- **THEN** 测试世界收到一次 `prompt.submit`，正文含「overlap: 同一 wave 的 S1 与 S2 都覆盖 a.ts」「只修工作区与本 change 工件」「不要发 /opsx-apply」
- **AND** 那一轮结束后插件自动重试起飞，账本追加 takeoff

### Requirement: 偶发失败留证据并只重试一次
transient 类被拒时，插件 SHALL 在 change 账本可读的前提下追加 `diag {where: 'takeoff', error: <原因首行>}`，并在 10 秒后重试一次。重试仍为 transient 时 SHALL 放弃待命并通知。

Feature: 用户定 Q8：`python3 aborted` 成因未明，先按偶发处理并留证据。

#### Scenario: transient-retries-once-with-diag
- **GIVEN** demo 已批准；plan_fp.py 前两次都以 1 退出、stderr「plan_fp 超时」
- **WHEN** 发 `/opsx-apply demo`，时钟推进 10 秒，再推进 10 秒
- **THEN** 第一次被拒后进入待命，账本追加一条 diag，where 为 takeoff
- **AND** 10 秒后自动重试恰好一次；仍失败则放弃待命，`ui.notify` 收到含「放弃」的通知
- **AND** 第二个 10 秒后没有再重试

### Requirement: 放弃与取消
- 预算用尽、过期，或分类为 human、human-key 时，插件 SHALL 不再重试，并通知原因与做法。
- `/flight abort <change>` 在该 change 处于待命时，SHALL 清除待命，回复「已取消起飞待命」，之后不再重试。
- 该 change 没有在飞飞行时，`/flight abort` SHALL NOT 因「没有在飞」而拒绝这次取消。

Feature: 人随时可以收回起飞意图。

#### Scenario: armed-gives-up-and-cancels
- **GIVEN** 三个情形：
  - 甲：demo 的 attempt 由另一个会话起飞、尚未落地；
  - 乙：demo 因 lint 红进入 model 类待命，已自动重试 3 次，每次重试后 lint 仍红；
  - 丙：demo 因「基线仍在跑」处于待命
- **WHEN** 甲发 `/opsx-apply demo`；乙的第 3 次重试又被拒；对丙发 `/flight abort demo`，再推进时钟 60 秒
- **THEN** 甲不进入待命，`ui.notify` 收到含原因与「--takeover」的通知
- **AND** 乙放弃待命，通知含「重试已用尽」，没有再提交新的一轮
- **AND** 丙的回复含「已取消起飞待命」，推进时钟后没有重试
