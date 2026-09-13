## MODIFIED Requirements

### Requirement: 起飞需要人类批准的机械证据
起飞 SHALL 以会话转录里**人类自己发出**的批准消息为证据，MUST NOT 以模型自己记录的 `approve` 事件为准；批准 SHALL 晚于计划工件的最后一次改动。**起飞指令本身只构成发起，不构成批准**——批准是发起之后另一条人类短确认（两段式握手的完整判据见 `takeoff-model-confirm`）。
Feature: 批准是人给的事实，不是模型的叙述
Rule: 人类消息 + 新鲜度，两者缺一即不起飞；且发起与批准必须是两条消息

#### Scenario: approval-gate-accepts-human-command
- **GIVEN** 一份转录，其中有一条人类消息调用了 `/opsx-apply <change>`（`<command-name>` 形式），时间晚于计划工件的最大 mtime
- **WHEN** 运行 `python3 .claude/hooks/takeoff-gate.py --change-dir <dir> --session <转录>`
- **THEN** 退出码非 0——该命令调用只算**发起**，不再单独构成批准
- **AND** 其后再有一条人类短确认（≤ 40 字、整条即批准词、不含 change 名与 worktree 路径）时退出码为 0，stdout 打印批准证据（时间戳 + 人类原话摘要），且证据取**确认**那一刻而非发起那一刻

#### Scenario: approval-gate-rejects-self-start
- **GIVEN** 一份转录，最近的人类消息只是继续规划类指令（如 `继续上述任务的规划`），既无 `/opsx-apply` 调用也无批准词
- **WHEN** 运行判定
- **THEN** 退出码非 0，stdout 不输出任何"已批准"结论
- **AND** stderr 说明需要人类显式批准，并给出 `spec.html` 路径与补救方式

#### Scenario: approval-gate-requires-fresh-approval
- **GIVEN** 两段式握手（发起 + 短确认）已完成，但计划工件（`proposal.md` · `design.md` · `slices.json` · `specs/**/spec.md`；`tasks.md` 的勾选是执行记账，不算计划改动）在**确认之后**又被改过
- **WHEN** 运行判定
- **THEN** 退出码非 0，stderr 点名"计划在批准之后改过，需重新批准"
