## ADDED Requirements

### Requirement: 账本是 git 引用上的线性提交链
一个 change 的账本 SHALL 位于其所在仓库的引用 `refs/flight/<change>/ledger`（`<change>` 为 change 目录名）。每个事件 SHALL 是链上一个提交：至多一个父提交，树中恰有一个文件 `event.json`，内容为 JSON 对象，字段 `v`（整数 1）、`ev`（本 change 中只有 `approve`）、`change`（等于 `<change>`）、`fp`（64 位小写十六进制）、`at`（ISO-8601 UTC 时间）、`by`（对象，至少含 `plugin`）。账本 SHALL NOT 存放在工作区文件中。
Feature: 证据不在模型能用 Write / Edit 改到的地方

#### Scenario: ledger-shared-across-worktrees
- **GIVEN** 主仓库的 `refs/flight/demo/ledger` 上有一条批准指纹为 F 的事件，并从主仓库建出一个 worktree，其中也有 `openspec/changes/demo`
- **WHEN** 以 worktree 里的 change 目录运行 `ledger.py approved`
- **THEN** 输出 F

### Requirement: 只读读取与结构校验
`ledger.py` SHALL 只读，提供子命令：`show --change-dir DIR`（按时间顺序每行打印一个事件 JSON）、`approved --change-dir DIR`（打印最新一条 `approve` 事件的 `fp`；无账本时什么都不打印并以 0 退出）、`verify --change-dir DIR`（结构合法以 0 退出）。任一提交违反上一条要求时，三个子命令 SHALL 以 4 退出，stderr 写明违规提交的前 8 位与原因。仓库目录与 change 名 SHALL 由 `--change-dir` 推出（`git -C <dir>` 与目录名），不读环境变量、不猜。
Feature: 判定器只读，格式坏了就判坏，不猜

#### Scenario: ledger-approved-returns-latest-fp
- **GIVEN** `refs/flight/demo/ledger` 上依次有批准指纹为 F1、F2 的两条事件
- **WHEN** 运行 `ledger.py approved --change-dir <…>/openspec/changes/demo`
- **THEN** 以 0 退出并只打印 F2

#### Scenario: ledger-absent-means-unapproved
- **GIVEN** 仓库里没有 `refs/flight/demo/ledger`
- **WHEN** 分别运行 `approved` 与 `show`
- **THEN** 两者都以 0 退出且 stdout 为空

#### Scenario: ledger-show-lists-events
- **GIVEN** 账本上依次有两条事件
- **WHEN** 运行 `ledger.py show`
- **THEN** stdout 恰两行，各是一个 JSON 对象，顺序与写入顺序一致

#### Scenario: ledger-rejects-tampered-chain
- **GIVEN** 五个各自只有一处违规的账本：树里多了一个文件、`event.json` 不是 JSON、`change` 字段不等于目录名、某提交有两个父提交、`v` 不是 1
- **WHEN** 对每个账本运行 `ledger.py verify` 与 `ledger.py approved`
- **THEN** 都以 4 退出
- **AND** stderr 含违规提交 sha 的前 8 位
