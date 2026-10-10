## ADDED Requirements

### Requirement: 落地与停飞时打印飞行记录
落地逻辑 SHALL 在落地与停飞时，经 `Ctx.log` 打印一段飞行记录（铁律 8）：
- **首行**：落地时为「飞行记录 · <change>」；停飞时为「停飞 · <change>：<原因>」。
- **正文**：`timeline.py report --change-dir <changeDir>` 的输出。
- **末行**：路由对账。各 agent 实际模型都与起飞时的主模型一致时，写「路由对账：一致」；否则写「路由对账：N 条不符」，并逐条列出角色、期望与实际。

落地时，打印 SHALL 发生在运行 `/pr-ship` 之前。
Feature: 新引擎落地也要打印飞行记录，无数据不得声称提速

#### Scenario: landing-prints-flight-record
- **GIVEN** 全部切片已合回、评审有结果、final 绿，`timeline.py report` 输出「批准 → apply 完成：12.0 min」，各 agent 实际模型都是 claude-opus-5-5、主模型为 opus
- **WHEN** 执行落地动作
- **THEN** `Ctx.log` 收到的文本含「飞行记录 · demo」、「批准 → apply 完成：12.0 min」与「路由对账：一致」
- **AND** 这次 `Ctx.log` 发生在运行 `/pr-ship` 之前

#### Scenario: halt-prints-flight-record
- **GIVEN** `timeline.py report` 输出「门禁红次数：2」
- **WHEN** 执行停飞动作，原因为「final 红：G2 lint」
- **THEN** `Ctx.log` 收到的文本含「停飞 · demo：final 红：G2 lint」与「门禁红次数：2」

### Requirement: 派发修复 agent 前先提交飞行记录
落地逻辑派发修复 agent 时，SHALL 先提交 change 目录内未提交的飞行记录（`land.commitRecords`），再建修复 worktree，使修复 agent 看得到最新的接口摘要。
Feature: worktree 从已提交的尖端建出，未提交的记录它看不到

#### Scenario: fixer-dispatch-commits-records-first
- **GIVEN** change 目录里 `slices/_interfaces.md` 有未提交改动
- **WHEN** 派发修复 agent
- **THEN** 「chore(flight): 记录」的 `git commit` 排在修复 worktree 的 `git worktree add` 之前

### Requirement: 事件校验只认字段表自己的键
写账本前的事件校验 SHALL 只在 `ev` 是字符串、且是字段表**自己的**键（不含原型链上的 `toString`、`constructor`、`__proto__` 等）时，才取该类字段表；否则 SHALL 判不合规，不写任何 git 对象。
Feature: 写入方不能比读取方（ledger.py）更宽

#### Scenario: io-refuses-prototype-ev
- **GIVEN** 两条事件的 `ev` 分别为 "toString" 与 "constructor"，其余公共字段合法
- **WHEN** 分别追加
- **THEN** 都返回 false
- **AND** 没有任何 git 调用
