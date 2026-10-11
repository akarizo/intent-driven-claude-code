## ADDED Requirements

### Requirement: 读账本失败不当作「不是飞行 agent」
归属查询扫描本进程登记的在飞飞行（`flights` 中、且在 `active` 里）的账本时，若读取失败且没有在别处找到该 agent，查询 SHALL 返回「判不出」并带原因，SHALL NOT 写入未命中缓存；之后对同一 agentId 的查询 SHALL 重新读账本。其他 change 的账本读取失败照旧跳过（一条损坏的旧账本不得让所有非飞行 agent 判不出）。`flightOfAgent` 的对外返回不变。
Feature: #42 评审 MEDIUM：misses 把读失败也缓存成未命中，包络对飞行 agent 放行（fail-open）

#### Scenario: ledger-read-failure-not-cached
- **GIVEN** demo 是本进程登记的在飞飞行；`ledger.py show` 第一次退出 5，之后正常返回含 agent-7 dispatch（S1、worktree W1）的账本
- **WHEN** 连续两次查询 agent-7 的归属
- **THEN** 第一次结果为「判不出」，原因非空
- **AND** 第二次结果为 `{ change: 'demo', role: 'executor', slice: 'S1', worktree: W1 }`

### Requirement: 在飞期间归属判不出的 agent 不得写入或运行 Bash
有在飞飞行时，归属查询结果为「判不出」的 agent 的 Write / Edit / NotebookEdit / Bash SHALL 被拒绝，理由含「归属判定失败」；`tool.check` SHALL NOT 升级其判定。
Feature: fail-closed（DRAFT-gate-evidence-not-self-reported 第 3 条）

#### Scenario: unknown-owner-fails-closed
- **GIVEN** demo 在飞；对 agent-7 的账本读取失败（`ledger.py show` 退出 5）
- **WHEN** agent-7 调用 Write 与 Bash，引擎对它的 Bash 判定为 ask
- **THEN** Write 与 Bash 都被拒绝，理由含「归属判定失败」
- **AND** `tool.check` 对它的判定仍为 ask
