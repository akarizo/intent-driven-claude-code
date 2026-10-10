## ADDED Requirements

### Requirement: 交接 /pr-ship 失败不让已落地的飞行停飞
落地动作写入 land 事件后，运行 `/pr-ship` 抛错时 SHALL 被落地动作自己吸收：经 `Ctx.log` 打印一行、经 toast 提示「已落地，但接 /pr-ship 失败：<原因>；请手动运行 /pr-ship」，SHALL NOT 向上抛出，账本 SHALL NOT 在 land 之后追加 halt。
Feature: 首飞账本出现「land 之后又 halt」，原因是本仓库没有注册 `/pr-ship`

#### Scenario: land-handoff-failure-keeps-landing
- **GIVEN** 全部合回、final 绿；运行 `/pr-ship` 抛出「no command named /pr-ship in this session」
- **WHEN** 执行落地动作
- **THEN** 落地动作没有抛错，账本末条为 land
- **AND** toast 含「手动运行 /pr-ship」，`Ctx.log` 收到含「/pr-ship」的文本

### Requirement: 飞行记录的拼装有兜底
拼飞行记录时，`timeline.py report` 的调用抛错 SHALL 与非 0 退出走同一分支，正文写「（timeline report 失败：<原因首行>）」；stderr 首行为空时 SHALL 写 `exit <退出码>`。落地时 `Ctx.log` SHALL 仍在运行 `/pr-ship` 之前被调用。
Feature: PR #40 评审 MEDIUM 与 LOW：拼记录抛错会让 `/pr-ship` 不运行；无 stderr 时记录里没有线索

#### Scenario: flight-record-survives-report-throw
- **GIVEN** 全部合回、final 绿；运行 `timeline.py report` 时 `io.run` 抛错「spawn ENOENT」
- **WHEN** 执行落地动作
- **THEN** `Ctx.log` 收到含「（timeline report 失败：spawn ENOENT）」的文本
- **AND** 调用顺序为先 log、后运行 `/pr-ship`

#### Scenario: flight-record-shows-exit-code
- **GIVEN** `timeline.py report` 以 2 退出，stderr 为空
- **WHEN** 执行停飞动作
- **THEN** `Ctx.log` 收到含「（timeline report 失败：exit 2）」的文本
