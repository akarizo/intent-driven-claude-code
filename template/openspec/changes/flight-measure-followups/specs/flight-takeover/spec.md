## ADDED Requirements

### Requirement: 跨会话起飞默认拒飞，--takeover 显式接管
起飞 SHALL 在读到账本之后、写任何事件或记录之前检查：最新 takeoff 的 `by.session` 不是本会话，且该 attempt 没有 land / halt 时，不带 `--takeover` SHALL 拒飞，回复含原会话 id 的前 8 位、「另一个会话」与「--takeover」，账本 SHALL NOT 新增事件；带 `--takeover` 时 SHALL 照常起飞，takeoff 事件 SHALL 带 `takeover` 字段记原会话 id。最新 attempt 已 land / halt 时，跨会话起飞不受影响。`--takeover` SHALL NOT 被当作 change 名或透传参数。
Feature: flight-measure attempt 2 与 3 由两个会话相隔 1 分钟起飞，两个 S7 执行体并发改同一棵 worktree · 用户定：拒飞 + --takeover

#### Scenario: cross-session-takeoff-refused
- **GIVEN** demo 已批准；账本最新 takeoff（attempt 1）的 `by.session` 为 `other-session-1234`，没有 land / halt
- **WHEN** 本会话发出 `/opsx-apply demo`，再发出 `/opsx-apply demo --takeover`
- **THEN** 第一次回复含「另一个会话」「other-se」与「--takeover」，账本没有新增事件
- **AND** 第二次回复含「✈ 起飞」，账本新增 attempt 2 的 takeoff，其 `takeover` 为 `other-session-1234`

#### Scenario: halted-attempt-from-other-session-resumes
- **GIVEN** demo 账本最新 takeoff（attempt 1）来自 `other-session-1234`，且 attempt 1 已 halt
- **WHEN** 本会话发出 `/opsx-apply demo`
- **THEN** 回复含「✈ 起飞」，账本新增 attempt 2 的 takeoff，且没有 `takeover` 字段

### Requirement: 文档写明 --takeover 与另起 worktree
`template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md` SHALL 同步写明：`--takeover` 的含义与适用场合（原会话已结束才用）；续飞时新派发遇到同名 worktree 另起一棵、旧现场保留、清理交给人。
Feature: 命令与同名 skill 同改，禁漂移

#### Scenario: docs-state-takeover-and-fresh-worktrees
- **GIVEN** 本 change 合入后的 opsx-apply.md 与 openspec-apply-change/SKILL.md
- **WHEN** 读取两份文档
- **THEN** 两份都含「--takeover」「另一个会话」与「另起」
- **AND** 两份都写明旧 worktree 保留、由人清理
