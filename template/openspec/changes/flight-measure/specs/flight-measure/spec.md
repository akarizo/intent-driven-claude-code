## ADDED Requirements

### Requirement: slice-gate 提供 measure 子命令，只跑本片 scenario 的 pytest 目标
`slice-gate.py measure <S> --change-dir D [--base B]` SHALL 只运行本片 scenario 映射中以 `.py` 结尾的目标，复用 G7 的 pytest 运行方式与超时；SHALL 打印 JSON `{slice, base, commit, outcomes, unmeasurable, changed, source, tail}`。其中：
- `outcomes` 为 `[目标, 状态]`。一个目标对应多个节点时，按 ERROR > FAILED > XPASS > XFAIL > SKIPPED > PASSED 取最差者；没有结果记 MISSING。
- `unmeasurable` 为非 `.py` 目标。
- `changed` 为相对 base 的改动文件，含未提交的，但不计切片标记 `.openspec-slice` 与本 change 目录下的文件（这些是控制面的簿记，start 一跑就会出现）。
- `source` 为其中按 G3 分类属于生产代码的文件。

跑完 SHALL 退出 0，不论红绿；跑不起来或超时 SHALL 退出 1，并在 JSON 中带 `error`。
Feature: 评审页 D3-A：测试由控制面执行

#### Scenario: measure-command-reports-outcomes
- **GIVEN** 切片 S1 的 scenario 映射到三个目标：`tests/test_a.py::test_red`（断言失败）、`tests/test_a.py::test_marked`（仍带 `xfail(strict=True)`、断言失败）、`web/a.test.ts::case`
- **AND** 相对 base B，工作树改了 `src/a.py`（未提交）与 `tests/test_a.py`
- **WHEN** 运行 `slice-gate.py measure S1 --change-dir D --base B`
- **THEN** 退出码为 0，JSON 的 `slice` 为 S1、`base` 为 B、`commit` 为当前 HEAD
- **AND** `outcomes` 为 `[["tests/test_a.py::test_red","FAILED"],["tests/test_a.py::test_marked","XFAIL"]]`
- **AND** `unmeasurable` 为 `["web/a.test.ts::case"]`，`changed` 含 `src/a.py` 与 `tests/test_a.py`，`source` 为 `["src/a.py"]`

#### Scenario: measure-reports-strict-xpass
- **GIVEN** 切片 S1 的唯一目标带 `xfail(strict=True)`，但测试体已能通过
- **WHEN** 运行 measure，再运行该切片的 gate
- **THEN** measure 的 `outcomes` 里该目标为 XPASS，不是 FAILED
- **AND** gate 的 G7 仍判该 scenario 未通过（实际结果不是 PASSED）

### Requirement: start 之后立即测量即为起点测量
切片以 `start --evidence ledger` 起跑、工作树没有其他改动时，紧接着运行的 measure SHALL 输出空的 `changed`，账本模式的 gate SHALL 认出这次测量是起点测量。
Feature: flight-measure attempt 1 · S2 评审 HIGH：start 写的标记与 timeline 让起点测量永远不成立

#### Scenario: start-measure-right-after-start
- **GIVEN** 切片 S1 的工件已提交，以 `start S1 --evidence ledger` 起跑，工作树没有其他改动
- **WHEN** 立即运行 `slice-gate.py measure S1 --base <start 的 base>`，把输出写成一条 measure 事件，再以账本模式运行 gate
- **THEN** measure 的 `changed` 为 `[]`
- **AND** gate 的 G5 失败项不含「缺少本片起点测量」

### Requirement: 账本接受 measure 事件，判定器能列出已知事件类型
`ledger.py` SHALL 把 `measure` 列为合法事件：`attempt` 为正整数；`slice`、`agent`、`base` 为非空字符串；`commit` 为字符串；`outcomes` 为「两项字符串数组」的数组，且第二项属于 PASSED / FAILED / ERROR / SKIPPED / XFAIL / XPASS / MISSING；`changed`、`source` 为字符串数组。缺字段或类型不符 SHALL 让账本判为损坏。`ledger.py events` SHALL 每行打印一个已知事件类型并退出 0。
Feature: 新事件类型须读写两侧同表

#### Scenario: ledger-accepts-measure-events
- **GIVEN** 账本 A 依次含 approve、takeoff 与一条字段齐全的 measure；账本 B 同上，但 measure 缺 `outcomes`
- **WHEN** 分别运行 `ledger.py show` 与 `ledger.py verify`，再运行 `ledger.py events`
- **THEN** A 的 show 打印三条事件、退出 0
- **AND** B 的 verify 退出 4，stderr 含「measure 的 outcomes」
- **AND** events 的输出含 `measure` 与 `gate`，退出 0

### Requirement: 插件写入前按同一张表校验 measure 事件
`io.ts` 的 `eventProblem` SHALL 对 measure 事件按与 `ledger.py` 相同的字段表校验；不合规的 measure 事件 SHALL NOT 写入账本。
Feature: 链上一条坏事件会让整条账本判损坏（PR #39 评审 HIGH）

#### Scenario: measure-event-checked-before-write
- **GIVEN** 一条字段齐全的 measure 事件，以及一条缺 `base` 的 measure 事件
- **WHEN** 分别调用 `eventProblem` 与 `appendEvent`
- **THEN** 前者 `eventProblem` 为 undefined，`appendEvent` 返回 true
- **AND** 后者 `eventProblem` 含「measure 的 base」，`appendEvent` 返回 false 且没有调用 `git hash-object`

### Requirement: 执行体通过测量工具请求测量，控制面执行并记账
插件 SHALL 在会话启动时注册工具 `measure`。本次飞行当前 attempt 的执行体调用它时，控制面 SHALL：
1. 在该执行体的 worktree 里运行 `slice-gate.py measure <S> --change-dir <D> --base <B>`，B 取该执行体 dispatch 事件里的 base；
2. 把结果追加为 measure 事件，`agent` 为调用者；
3. 返回字符串摘要，含每个目标的状态、是否见红；见红但 `source` 非空时，SHALL 写明这次红不能作为先红证据。

测量没有完成或账本写入失败时，SHALL 返回「测量没有完成」及原因，不记事件。其他调用者 SHALL 被拒绝。在飞执行体调用测量工具时，`tool.check` SHALL 把 ask 改答 allow。
Feature: 评审页 D3-A

#### Scenario: measure-tool-records-event
- **GIVEN** demo 在飞，agent-1 是 S1 的执行体，dispatch 事件记有 base B；测量命令的应答为 S1 的一个目标 FAILED、`source` 为空
- **WHEN** agent-1 调用 `mcp__flight__measure`
- **THEN** 执行端收到的命令是 `python3 <判定器>/slice-gate.py measure S1 --change-dir <D> --base B`，工作目录是 agent-1 的 worktree
- **AND** 账本新增一条 measure 事件，`agent` 为 agent-1、`slice` 为 S1、`base` 为 B
- **AND** 工具结果含该目标、FAILED 与「见红」

#### Scenario: measure-tool-only-for-flight-executors
- **GIVEN** demo 在飞；agent-2 是 S1 的评审员；agent-x 不属于任何飞行
- **WHEN** agent-2、agent-x 分别调用 `mcp__flight__measure`
- **THEN** 两次都被拒绝，理由含「只有本次飞行的执行体可以请求测量」
- **AND** 没有运行测量命令，账本没有新增 measure 事件

#### Scenario: measure-tool-upgraded-for-executor
- **GIVEN** demo 在飞，agent-1 是 S1 的执行体；引擎对 `mcp__flight__measure` 的判定为 ask
- **WHEN** 插件的 `tool.check` 处理 agent-1 的这次调用，以及评审员 agent-2 的同一调用
- **THEN** agent-1 的判定为 allow
- **AND** agent-2 的判定仍为 ask

### Requirement: 模型可调用的插件工具不构成批准路径
插件注册的模型可调用工具 SHALL 恰为 `submit_findings` 与 `measure`，两者在任何输入下都 SHALL NOT 追加 approve 事件；插件 SHALL NOT 注册斜杠命令。
Feature: 铁律 7 · 加了测量工具后，批准带之外仍然没有模型能走的批准路径

#### Scenario: model-tools-cannot-approve
- **GIVEN** 插件已加载、会话已启动
- **WHEN** 列出插件注册的工具与斜杠命令，并以各种输入调用这两个工具
- **THEN** 工具恰为 `submit_findings` 与 `measure`，没有斜杠命令
- **AND** 账本没有新增 approve 事件

### Requirement: 派发执行体前，控制面先做起点测量
派发执行体之前（`slice-gate start` 成功之后），若账本里没有本片、本 base 的起点测量（`changed` 为空的 measure 事件），控制面 SHALL 先运行一次测量，并以 `agent` 为 `dispatch` 记账。测量失败或写入失败 SHALL 记本片 blocked（infra），理由含「起点测量失败」，SHALL NOT 派发。
Feature: 免于先红的依据须由控制面测出

#### Scenario: fresh-dispatch-takes-start-measure
- **GIVEN** demo 起飞，S1 的切片 worktree 是新建的，start 打印的 base 为 B
- **WHEN** 控制面派发 S1 的执行体；再把测量命令的应答改为退出 1，对同一计划的 S2 派发
- **THEN** S1 的 measure（agent 为 dispatch、base 为 B）先于 S1 的 dispatch 事件写入，S1 的 dispatch 事件带 `base` 为 B
- **AND** S2 记 blocked（infra），理由含「起点测量失败」，没有派发 S2 的执行体
