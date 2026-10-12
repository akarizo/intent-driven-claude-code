## ADDED Requirements

### Requirement: 插件提供 /opsx-apply 入口
插件 SHALL 在会话开始时注册 `flight` 与 `opsx-apply` 两个命令。项目或用户已有同名命令文件导致 `opsx-apply` 注册被拒时，插件 SHALL 忽略该错误、会话照常开始，并 SHALL 继续经 `command.run` 拦截该文件命令起飞。没有同名命令文件时，插件注册的斜杠命令 SHALL 恰为 `flight` 与 `opsx-apply`；模型可调用的工具 SHALL 恰为 `submit_findings` 与 `measure`；任何工具或命令在任何输入下都 SHALL NOT 追加 approve 事件。本要求取代 flight-interaction 中「插件注册的命令恰为 flight」的约束。
Feature: 用户定（2026-10-12）：注册加拦截两手

#### Scenario: opsx-apply-registered-or-intercepted
- **GIVEN** 两个世界，demo 都已批准、工作区干净：
  - 世界甲：`command.register` 照常应答；
  - 世界乙：`command.register` 对 `opsx-apply` 抛出「`$.command.register: "/opsx-apply" refused: it is the user's /opsx-apply`」
- **WHEN** 各自开始会话，再由人在终端发出 `/opsx-apply demo`
- **THEN** 世界甲登记的命令按名排序恰为 `flight`、`opsx-apply`；世界乙只登记了 `flight`，且会话开始没有抛错
- **AND** 两个世界的回复都含「✈ 起飞 demo」

### Requirement: 写账本的入口只认人或宿主程序
`/opsx-apply` 起飞、`/flight abort`、`/flight resume` 会写账本，插件 SHALL 只在 `command.run` 的 `e.origin.kind` 为 `composer`、`bridge` 或 `sdk` 时执行。来源为其他或未标明时，插件 SHALL 回复含「只接受人或宿主程序发出」与所见来源（未标明时写「未标明」）的拒绝，且 SHALL NOT 写事件、SHALL NOT 停任何 agent。`--engine=workflow` 的拒绝与 `--gate=per-task` 透传不写账本，不受此限；`/flight status` 与 `/flight panel` 不查来源。本要求取代 flight-interaction 中「只接受人在终端发出」的约束。
Feature: 用户定（2026-10-12）：认 composer、bridge、sdk

#### Scenario: ledger-entries-accept-host-origins
- **GIVEN** demo 已批准、工作区干净
- **WHEN** 依次发出：
  - 以 `scheduled-trigger` 来源发出 `/opsx-apply demo`；
  - 不带来源发出 `/opsx-apply demo`；
  - 以 `sdk` 来源发出 `/opsx-apply demo`；
  - 以 `sdk` 来源发出 `/flight abort demo`
- **THEN** 前两次回复含「只接受人或宿主程序发出」，分别含 `scheduled-trigger` 与「未标明」，且账本在这两次之后都没有新事件
- **AND** 第三次回复含「✈ 起飞 demo」；第四次之后，账本有原因含「人工中止」的 halt
