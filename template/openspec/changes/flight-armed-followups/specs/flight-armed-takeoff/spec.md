## ADDED Requirements

### Requirement: 交模型那一轮按提交时刻对准
插件 SHALL 在 `clock.after(0)` 的回调里，先取 T0 = `clock.now()`，再调用 `$.prompt.submit`：
- 成功后，把待命的 `awaitingModel` 置真，并记 `submittedAt = T0`；
- 失败时，放弃待命并通知。

主会话 `turn.complete` 时，插件 SHALL 以 `clock.now() - durationMs` 作为这一轮的开始时刻。只有开始时刻不早于 `submittedAt` 时，才以 `main-turn` 推进；早于时 SHALL 忽略这一轮，不计入预算。

Feature: PR #54 MEDIUM：`awaitingModel` 在提交前就置真，正在进行的无关轮次一结束就触发重试，白耗预算。实测（CLI 2.1.296）：提交的那一轮开始得比 `prompt.submit` 完成还早 7–20 ms，所以必须在调用前记 T0。

#### Scenario: model-turn-aligned
- **GIVEN** demo 因 lint 红进入 model 类待命；插件提交修复请求之前，主会话已有一轮在跑
- **WHEN** 那一轮先结束（开始时刻早于 T0）；之后提交的那一轮结束（开始时刻不早于 T0）
- **THEN** 前一轮结束时不重试，已计入预算的次数不变
- **AND** 后一轮结束时自动重试起飞
- **AND** 另一个世界里 `prompt.submit` 抛错时，待命被放弃，`ui.notify` 收到含「放弃」的通知

### Requirement: 人再次起飞被拒为只能人时清掉旧待命
人发出的起飞被拒、分类为 human 或 human-key 时，插件 SHALL 先清除同一 change 的旧待命，再通知。状态行 SHALL 不再显示该 change 的待命。

Feature: PR #54 LOW：现在旧待命仍留着，之后自动重试又被拒，同一原因通知两次。

#### Scenario: human-refusal-drops-old-arm
- **GIVEN** demo 因「基线仍在跑」处于待命
- **WHEN** 人再发 `/opsx-apply demo`，被拒为「计划已变」；之后推进时钟 60 秒
- **THEN** demo 的待命被清除，状态行不含 demo 的「起飞待命」
- **AND** 推进时钟后没有重试，也没有第二条通知

### Requirement: 放弃或取消待命时不误清别人的状态行
放弃或取消某个待命时，插件 SHALL 按以下顺序处理状态行：
- 还有别的待命：显示其中一个的 `armedLine`；
- 本进程有在飞的 change：重画它的状态；
- 都没有：清空状态行。

Feature: PR #54 LOW：现在无条件清空，会把另一个在飞 change 的状态行一起清掉。

#### Scenario: status-line-kept-for-others
- **GIVEN** 本会话里 e2 正在飞（状态行显示 e2 的进度），demo 处于 model 类待命，重试已用尽
- **WHEN** demo 的待命再次被拒而放弃
- **THEN** 状态行仍显示 e2 的进度，不为空

### Requirement: 放弃待命的做法保留原参数
`armed.ts` 的 `giveUpText` 给出的做法 SHALL 保留原起飞参数里 change 之外的参数（如 `--takeover`）：resume 类为 `/flight resume <change> <其余参数>`，其余为 `/opsx-apply <原参数>`。

Feature: PR #54 LOW：resume 分支只给出 `/flight resume <change>`，丢了 `--takeover`，照做可能又因跨会话被拒。

#### Scenario: relaunch-keeps-args
- **GIVEN** resume 类待命，args 为 `[demo, --takeover]`；非 resume 待命，args 为 `[demo, 授权提交]`
- **WHEN** 分别生成 `giveUpText`
- **THEN** 前者含 `/flight resume demo --takeover`
- **AND** 后者含 `/opsx-apply demo 授权提交`
