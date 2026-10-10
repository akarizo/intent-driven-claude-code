## ADDED Requirements

### Requirement: 账本模式下 G5 只认控制面的测量
`slice-gate.py gate <S> --evidence ledger` SHALL 按以下规则判定 G5。记 M 为账本中本片、指定 base 的全部 measure 事件（不分 attempt；指定 base 默认取门禁的 base，`--measure-base` 可覆盖），T 为本片 scenario 映射中以 `.py` 结尾的目标：
1. M 中没有 `changed` 为空的起点测量 → SHALL 判红，失败项含「缺少本片起点测量」。
2. 起点测量里 PASSED 的目标免于先红 → SHALL 记警告，警告含该目标与「起点已通过」。
3. 其余每个目标都必须在 M 的某次测量里为 FAILED 或 ERROR，否则 SHALL 判红，失败项含该目标与「从未在控制面测量中红过」。
4. 需要先红的目标不为空时，M 中 SHALL 至少有一次「某个需要先红的目标为 FAILED 或 ERROR，且 `source` 为空」，否则 SHALL 判红，失败项含「每次见红时都已改动生产代码」。

账本读取失败 SHALL 判红。非 `.py` 目标 SHALL 记警告「无法测量」。账本模式下 SHALL NOT 读取 evidence.log。
Feature: 铁律 3 · 用户定：不满足即判红

#### Scenario: g5-ledger-requires-red-per-target
- **GIVEN** S1 映射两个目标 t1、t2；账本里有本片 base B 的起点测量（t1、t2 均为 XFAIL、`changed` 为空），以及一次 t1 为 FAILED、t2 为 XFAIL、`source` 为空的测量；t1、t2 都已实现并通过
- **WHEN** 运行 `slice-gate.py gate S1 --change-dir D --base B --evidence ledger`
- **THEN** 门禁红，失败项含 t2 与「从未在控制面测量中红过」
- **AND** 失败项不含 t1

#### Scenario: g5-ledger-requires-red-before-source
- **GIVEN** S1 映射一个目标 t1；账本里有起点测量（t1 为 XFAIL），之后只有一次 t1 为 FAILED 的测量，但那次的 `source` 为 `["src/a.py"]`；t1 已通过
- **WHEN** 以 `--evidence ledger --base B` 运行 gate
- **THEN** 门禁红，失败项含「每次见红时都已改动生产代码」

#### Scenario: g5-ledger-exempts-targets-passing-at-start
- **GIVEN** S1 映射两个目标：t0 在起点测量里已为 PASSED，t1 在起点测量里为 XFAIL、后来在一次 `source` 为空的测量里为 FAILED；两者现在都通过
- **WHEN** 以 `--evidence ledger --base B` 运行 gate
- **THEN** G5 不出失败项，门禁绿
- **AND** 警告含 t0 与「起点已通过」

#### Scenario: g5-ledger-needs-start-measure
- **GIVEN** S1 的账本里只有 `changed` 非空的测量（t1 为 FAILED、`source` 为空），没有起点测量
- **WHEN** 以 `--evidence ledger --base B` 运行 gate
- **THEN** 门禁红，失败项含「缺少本片起点测量」

#### Scenario: g5-ledger-uses-measure-base
- **GIVEN** 账本里本片的起点测量与见红测量都记在 base B0 上；解冲突 worktree 的门禁 base 为 B1
- **WHEN** 分别以 `--evidence ledger --base B1` 与 `--evidence ledger --base B1 --measure-base B0` 运行 gate
- **THEN** 前者门禁红，失败项含「缺少本片起点测量」
- **AND** 后者 G5 不出失败项

### Requirement: 不带账本模式时 G5 行为不变
不带 `--evidence ledger` 的 gate SHALL 沿用 evidence.log 判据：无文件记警告，有文件但无本片记录判红，未见 RED 先于 GREEN 记警告。
Feature: 铁律 10：Workflow 回退路径语义一致，3c 删除前不改

#### Scenario: g5-legacy-path-unchanged
- **GIVEN** evidence.log 存在但没有本切片的记录
- **WHEN** 不带 `--evidence` 运行 gate
- **THEN** 门禁红，失败项含「evidence.log 无本切片」

### Requirement: start 记下证据模式
`slice-gate.py start <S> --evidence ledger` SHALL 在切片标记中写入 `"evidence": "ledger"`，打印的 JSON SHALL 含 `base`。账本模式的 gate SHALL NOT 产生 evidence.log 相关的警告，`hooks_missing` SHALL 为 false。
Feature: test-evidence 据此让位；门禁 base 由控制面取得

#### Scenario: start-tags-ledger-evidence
- **GIVEN** 一个没有 evidence.log 的切片 worktree
- **WHEN** 运行 `slice-gate.py start S1 --change-dir D --evidence ledger`，再写一次满足 G5 的测量记录后以 `--evidence ledger` 运行 gate
- **THEN** 切片标记含 `"evidence": "ledger"`，start 打印的 JSON 含 `base`
- **AND** gate 的警告里没有「evidence.log」，`hooks_missing` 为 false

### Requirement: 控制面给出门禁的证据模式与 base
插件派发执行体时 SHALL 以 `start <S> --evidence ledger` 起跑，并把 start 打印的 base 记进 dispatch 事件。执行体的门禁（收口、结束后补跑、续飞 regate）SHALL 带 `--evidence ledger --base <该执行体 dispatch 的 base>`。解冲突 agent 的门禁 SHALL 另带 `--measure-base <本片最后一个执行体 dispatch 的 base>`。dispatch 事件没有 base 时（旧账本），门禁 SHALL 不带 `--base`。
Feature: 门禁区间不读执行体可写的标记

#### Scenario: gate-runs-with-ledger-evidence
- **GIVEN** demo 起飞，S1 的 start 打印 base B
- **WHEN** S1 的执行体收口；另一次飞行中 S2 合回冲突、解冲突 agent 收口（S2 执行体的 base 为 B2，解冲突 start 打印 base R）
- **THEN** S1 的 start 参数含 `--evidence ledger`，S1 收口门禁的参数含 `--evidence ledger --base B`
- **AND** 解冲突收口门禁的参数含 `--evidence ledger --base R --measure-base B2`

### Requirement: 门禁红次数与测量统计取自账本
`timeline.py report` SHALL 在能读到本 change 的账本且其中有 takeoff 时按账本统计：
- 「门禁红次数」SHALL 为全部 attempt 中 `ok` 为 false 的 gate 事件数加 final 事件数，并注明两者各几次；
- SHALL 另打印「测量：n 次（见红 m 次）」，其中「见红」指 outcomes 里有 FAILED 或 ERROR。

没有账本时 SHALL 按 timeline 行统计（与现状一致）；账本读取失败时 SHALL 按 timeline 统计并注明「账本读取失败」。
Feature: #40 实测：timeline 报 0，账本实为 7

#### Scenario: red-count-from-ledger
- **GIVEN** timeline.md 没有任何 red 行；账本含 takeoff、2 条 ok=false 的 gate、1 条 ok=true 的 gate、1 条 ok=false 的 final、3 条 measure（其中 2 条有 FAILED 目标）
- **WHEN** 运行 `timeline.py report`
- **THEN** 输出含「门禁红次数：3」以及「切片门禁 2」「final 1」
- **AND** 输出含「测量：3 次（见红 2 次）」

### Requirement: 账本模式的切片不再写 evidence.log
切片标记的 `evidence` 为 `ledger` 时，`test-evidence.py` SHALL NOT 写 evidence.log；标记没有该字段时行为不变。
Feature: 删除 test-evidence 的飞行职责（路线页 3b-3）

#### Scenario: test-evidence-skips-ledger-slices
- **GIVEN** 仓库根有切片标记 `{"slice": "S1", "change_dir": <D>, "evidence": "ledger"}`
- **WHEN** 以 PostToolUse 事件喂给 test-evidence.py 一条 `pytest -q` 的 Bash 调用
- **THEN** `<D>/evidence.log` 不存在
- **AND** 把标记里的 `evidence` 字段去掉再喂一次，evidence.log 新增一行 S1 的记录
