## ADDED Requirements

### Requirement: 诊断员的只读操作与评审员同样升 allow
`tool.check` 对诊断员 SHALL 与评审员同规则，把引擎的 ask 改答 allow：
- 主 worktree 内的 Read / Grep / Glob；
- 只读 git；
- 两条查看命令：`python3 <hooksDir>/ledger.py show --change-dir <D>` 与 `python3 <hooksDir>/timeline.py report --change-dir <D>`。

诊断员的写入 SHALL NOT 升级。

Feature: PR #53 MEDIUM：诊断员在 inEnvelope 里一律不升级，人不在终端时会卡在权限询问上，与「无人值守」相悖。

#### Scenario: diagnostician-reads-auto-allowed
- **GIVEN** demo 停飞后派出诊断员 d1；引擎对 d1 的工具检查都答 ask
- **WHEN** 分别检查 d1 的四个调用：
  - Read change worktree 内的 `proposal.md`；
  - Bash `python3 <hooksDir>/ledger.py show --change-dir <D>`；
  - Bash `git -C <change worktree> log --oneline -3`；
  - Write change worktree 内的 `x.md`
- **THEN** 前三个改答 allow，理由含「flight 包络内」
- **AND** Write 仍答 ask

### Requirement: 诊断员纳入看门狗
看门狗 SHALL 跟踪在诊断中的 change 的诊断员的模型请求。超时时 SHALL 对它调用 TaskStop，SHALL NOT 记 heal 或 halt。

Feature: PR #53 MEDIUM：`inFlight` 只认在飞的 change，诊断员的请求从不计时，卡住的诊断员会一直挂着。

#### Scenario: watchdog-stops-stalled-diagnostician
- **GIVEN** demo 已停飞并派出诊断员 d1；d1 的一个模型请求已开始、从未结束
- **WHEN** 时钟推进到该请求开始后 10 分钟零 1 秒，看门狗 tick
- **THEN** 对 d1 恰好调用一次 TaskStop
- **AND** 账本没有追加 heal，也没有追加新的 halt

### Requirement: 看门狗停飞后补停中途派出的 agent
看门狗因预算用尽而停飞时，插件 SHALL 先停本 attempt 在跑的 agent，再等手上这一轮 drive 做完，补停其间派出的 agent（与 `/flight abort` 同法）。

Feature: PR #53 MEDIUM：看门狗停飞不经 drive 队列，停飞时 drive 正在派发的 agent 会在已停飞的 attempt 里继续跑。

#### Scenario: watchdog-halt-drains-queue
- **GIVEN** 在飞的 demo 本 attempt 已有 3 条 heal；执行体 a1 的请求已等待超过 10 分钟；同时 drive 正在派发 S2 的执行体 a2（spawn 已返回，dispatch 尚未写入账本）
- **WHEN** 看门狗 tick
- **THEN** 账本追加 halt，kind 为 watchdog
- **AND** a1 与 a2 都被 TaskStop，a2 是在 drive 这一轮做完之后补停的

### Requirement: 计时器不重复处理
同一时刻只有最新起的那个看门狗计时器 SHALL 处理超时。同一个超时的 agent SHALL 只被处理一次：一条 heal、一次 TaskStop。

Feature: PR #53 MEDIUM：「两个周期没 tick 即视为已停」在机器休眠后会多起一个计时器，旧计时器之后一直存在，同一 agent 可能被处理两次。

#### Scenario: ticker-not-duplicated
- **GIVEN** 看门狗计时器因两个周期没有 tick 被判为已停，又起了第二个，而第一个其实仍在；执行体 a1 的请求已等待超过 10 分钟，自愈预算未用尽
- **WHEN** 时钟推进，两个计时器各 tick 一次
- **THEN** 账本恰好有一条 heal（agent a1）
- **AND** 对 a1 恰好调用一次 TaskStop
