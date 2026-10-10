# DRAFT. 飞行中的「先红后绿」由控制面测量写入账本，G5 只认账本

- Status: accepted
- Date: 2026-10-10
- 关联：细化 DRAFT-gate-evidence-not-self-reported 第 1 条（真值源加入账本的 `measure` 事件）· 在飞行路径取代 DRAFT-apply-as-flight 第 4 条中「测试运行由 hook 留痕」一句 · 两份旧 ADR 原文不动
- 来源 change：flight-measure（design D1–D7、D11）

## Context

插件接管飞行以后，RED / GREEN 留痕仍然靠 classic hook `test-evidence.py`：
- 它写进执行体自己 worktree 里的 `evidence.log`，G5 读到的永远是「无 evidence.log」，只给警告，先红证据形同虚设；
- 门禁的 base 读自切片标记 `.openspec-slice`，这个标记同样在执行体可写的 worktree 里；
- 测试结果出自执行体的环境与时机，记录在执行体可写的地方，不满足「判据禁自证」。

## Decision

1. **测量工具由执行体请求、控制面执行。** 插件注册工具 `measure`，执行体的工具白名单加上 `mcp__flight__measure`。调用方必须是在飞飞行、当前 attempt、role 为 executor 的 agent，否则拒绝。控制面在该执行体的 worktree 里运行 `slice-gate.py measure <S> --change-dir <D> --base <B>`（B 取该执行体 dispatch 事件记的 base），结果写成账本的 `measure` 事件，再把摘要（各目标状态、是否见红、见红时已改生产代码则明说「这次红不能作为先红证据」、pytest 输出尾部）返回执行体。测量没完成或账本写不进去 → 返回「测量没有完成：原因」，不记事件。执行体自己跑的测试只用于快速反馈，不算证据。GREEN 不另设测量：收口门禁的 G7 由控制面实跑并写入 gate 事件。
2. **起点测量与豁免。** 派发执行体之前、`slice-gate start` 成功之后，若账本里还没有本片、本 base 的起点测量（`changed` 为空的测量），控制面先测一次（agent 记为 `dispatch`）；测失败 → 本片记 `blocked`（infra），不派发。起点测量里已经 PASSED 的目标免于先红（记警告）；豁免依据只认控制面亲测，规划者的声明不算数。
3. **G5 账本判据（门禁带 `--evidence ledger`），以下四条任一不满足即判红：**
   1. 账本可读（读不到 → 红「账本读取失败」，fail-closed）；
   2. 本片、指定 base 的 `measure` 事件里有起点测量（否则红「缺少本片起点测量」）；
   3. 除起点豁免外，本片每个 `.py` scenario 目标都在某次测量里 FAILED 或 ERROR（否则红「目标 t 从未在控制面测量中红过」）；
   4. 至少有一次见红时 `source`（生产代码改动）为空（否则红「每次见红时都已改动生产代码」）。
   账本模式下不读 evidence.log；非 `.py` 目标只给警告「无法测量」。
4. **门禁的 base 与证据模式由控制面给出。** `slice-gate start <S> --evidence ledger` 在标记里写 `"evidence": "ledger"`，控制面把 start 打印的 base 记进 dispatch 事件；执行体的门禁一律带 `--evidence ledger --base <dispatch 的 base>`，解冲突 agent 另带 `--measure-base` 沿用执行体那次的测量证据。执行体改标记不影响门禁区间与 G5。
5. **Workflow 回退路径仍用 evidence.log。** 不带 `--evidence ledger`（Workflow 回退、手工运行）时 G5 沿用 evidence.log 判据，一字不改；标记 `evidence` 为 `ledger` 时 `test-evidence.py` 直接返回。回退路径与 evidence.log 随 Workflow 引擎在 3c 删除。

否决的方案：
- **保留 test-evidence hook 作飞行证据**：测试结果仍出自执行体的环境与时机，且记录在执行体可写的地方。
- **先上只警告的过渡版本**：用户定不满足即判红，过渡期的先红证据没有约束力。
- **收口前再请求一次 GREEN 测量**：G7 已由控制面实跑，执行体少一轮，证据也不缺。

## Consequences

- **更易**：飞行中的先红证据出自控制面并落在执行体写不到的账本里，铁律 3「不接受自述」在飞行路径上由机器判定；门禁红次数与测量统计可从账本直接打印。
- **更难（判红的摩擦）**：执行体若先写了实现才去测量，就再也拿不到合格的先红证据，3 次收口红后本片记阻断、交给人处理；每片多一次起点测量，执行体每测一次要等一次 pytest。
- **已知边界**：非 pytest 目标（例如直接映射到 `*.test.ts::name`）无法测量，G5 只给警告；跨插件版本续飞时旧账本没有 dispatch base 也没有起点测量，G5 会判「缺少起点测量」，处理办法是作废重飞。
- **中性**：本 ADR 细化而不取代 `DRAFT-gate-evidence-not-self-reported`，在飞行路径取代 `DRAFT-apply-as-flight` 第 4 条中的一句；两份旧 ADR 原文不改。
