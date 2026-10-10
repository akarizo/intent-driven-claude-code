## ADDED Requirements

### Requirement: 账本接受飞行事件并逐类校验
`ledger.py` SHALL 接受下表的事件类型，并按类型校验必需字段。公共字段不变：`v` 为 1、`ev`、`change` 与目录名一致、`at` 为字符串、`by` 含 `plugin`。允许出现表外的额外字段。

| ev | 必需字段（除公共字段外） |
|---|---|
| approve | `fp`：64 位十六进制 |
| takeoff | `attempt`：正整数；`fp`：64 位十六进制；`branch`：非空字符串；`waves`：字符串数组的数组；`model`：非空字符串 |
| dispatch | `attempt`；`slice`：非空字符串；`role`：executor / reviewer / fixer / resolver；`agent`：非空字符串；`model`：非空字符串；`worktree`：非空字符串 |
| gate | `attempt`；`slice`；`ok`：布尔；`commit`：字符串；`failed`：字符串数组 |
| ended | `attempt`；`agent`；`reason`：字符串；`model`：字符串或 null |
| merge | `attempt`；`slice`；`ok`：布尔；`commit`：字符串；`failed`：字符串数组 |
| review | `attempt`；`slice`；`agent`；`findings`：数组，每项 `severity` ∈ CRITICAL / HIGH / MEDIUM / LOW，`file` 字符串，`line` 整数，`summary` 与 `fix` 字符串 |
| blocked | `attempt`；`slice`；`kind`：gate / infra；`reason`：字符串 |
| final | `attempt`；`ok`：布尔；`commit`：字符串；`failed`：字符串数组 |
| land | `attempt`；`verdict`：ready / draft |
| halt | `attempt`；`reason`：字符串 |

未知的 `ev`，或任一必需字段缺失、类型不符，SHALL 判为账本损坏（exit 4），stderr 点名该提交的前 8 位与原因。
Feature: 账本是飞行状态的唯一来源，坏事件必须被挡在读取端

#### Scenario: ledger-accepts-flight-events
- **GIVEN** change demo 的账本依次有 approve、takeoff、dispatch、gate、ended、merge、review、blocked、final、land 十条字段合法的事件
- **WHEN** 分别运行 `ledger.py verify` 与 `ledger.py show`
- **THEN** 两者都以 0 退出
- **AND** show 恰打印十行 JSON，`ev` 的顺序与写入顺序一致

#### Scenario: ledger-rejects-malformed-flight-event
- **GIVEN** 两个账本：一个的链尾是 `ok` 为字符串 "yes" 的 gate 事件，另一个的链尾是 `ev` 为 "teleport" 的事件
- **WHEN** 对两者分别运行 `ledger.py verify`
- **THEN** 都以 4 退出
- **AND** stderr 含「账本损坏」与链尾提交的前 8 位
- **BUT** 链尾换成字段合法的 gate 事件时，verify 以 0 退出

### Requirement: 批准判定只看 approve 事件
`ledger.py approved` 与 `takeoff-gate.py` SHALL 只以最新一条 approve 事件的 `fp` 为批准判据；其后追加的飞行事件 SHALL NOT 改变判定结果。
Feature: 飞行中写账本不会让批准失效，也不会凭空产生批准

#### Scenario: approved-ignores-flight-events
- **GIVEN** 账本上 approve（指纹 F）之后又有 takeoff、dispatch、gate 三条事件，当前计划指纹也是 F
- **WHEN** 运行 `ledger.py approved` 与 `takeoff-gate.py --change-dir <demo>`
- **THEN** approved 只打印 F
- **AND** takeoff-gate 以 0 退出
