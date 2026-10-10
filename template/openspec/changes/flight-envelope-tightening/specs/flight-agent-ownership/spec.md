## ADDED Requirements

### Requirement: 派发后到 dispatch 写入前，agent 处于「登记中」
`io.ts` SHALL 提供 `markPending(agentId, change)`；归属查询对登记中的 agent SHALL 返回「登记中」而不是 undefined；该 agent 的 dispatch 事件写入后 SHALL 转为正式归属（含切片与 worktree）。
Feature: #41 评审 LOW：先 spawn 后登记，窗口内包络放行

#### Scenario: owner-pending-until-dispatch
- **GIVEN** `markPending('agent-9', 'demo')`
- **WHEN** 查询 agent-9 的归属，然后写入 agent-9 的 dispatch 事件（S2、worktree W2）后再查询
- **THEN** 第一次结果为登记中（change 为 demo）
- **AND** 第二次结果为 `{ change: 'demo', role: 'executor', slice: 'S2', worktree: W2 }`

### Requirement: 未命中归属的 agent 不再反复扫账本
归属查询扫完账本仍未命中时 SHALL 缓存未命中，之后对同一 agentId SHALL NOT 再读账本；任一 dispatch 事件写入时 SHALL 清空未命中缓存。
Feature: #41 评审 MEDIUM：飞行期间非飞行 subagent 的每次工具调用都扫账本

#### Scenario: owner-miss-cached-until-dispatch
- **GIVEN** 账本里没有 agent-x 的 dispatch
- **WHEN** 连续两次查询 agent-x 的归属，然后写入任一 dispatch 事件，再查询一次
- **THEN** 第二次查询没有读账本（git 调用数不变）
- **AND** dispatch 写入后的那次查询重新读了账本
