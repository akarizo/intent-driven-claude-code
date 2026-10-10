## Why

铁律 3 要求「生产代码前必有先失败的测试；测试运行由 hook 留痕，不接受自述」。插件接管飞行之后，这一条实际上没有被强制：
- **留痕回不到判定处**：`test-evidence.py` 是 classic hook，它把记录写进执行体自己 worktree 里的 `evidence.log`。#39–#43 的每一次飞行，G5 都只给出警告「无 evidence.log」，从未判红过。
- **记录在执行体可写的地方**：`evidence.log` 和切片标记 `.openspec-slice` 都在执行体的 worktree 里，Bash 能直接改。门禁的 base 也是从这个标记里读出来的。
- **门禁红次数报错了**：飞行记录里的「门禁红次数」只数 timeline.md 里的行。收口门禁红的结论写在账本里，没有写进 timeline。#40 报的是 0，账本里实际有 7 次。

评审页 `docs/flight-orchestrator.html` 的 D3 已经选定 A：「测量工具：执行体请求，控制面执行」。路线页把它排在 3b-3。

另外有三项从 #42、#43 带过来：
1. **#42 评审的包络缺口（MEDIUM）**：
   - `bash -c` / `eval` 包住的 git 绕过拒绝表；
   - `pushd`、`builtin cd` 不被当作换目录；
   - `GIT_CONFIG_*`、`GIT_DIR` 等前导环境变量绕过作用目标判定；
   - `git remote`、`branch -u` 会写共享 config；
   - 拒绝表漏了 `git fetch`（`git fetch . HEAD:refs/heads/main` 能移动分支）；
   - 归属查询把「读账本失败」也缓存成「不是飞行 agent」，这是 fail-open。
2. **插件版本没有机械核对**：#41、#42 两次飞行都因为插件更新后没有 `/reload-plugins`，实际跑在旧版上，直到复盘转录才发现。
3. **判定器与插件版本错位**：账本里一旦出现判定器不认识的事件类型，`ledger.py` 会把整条账本判为损坏。新增 `measure` 事件之后，主检出的判定器如果没更新，起飞会被永久拒绝。

## What Changes

- **测量工具 `measure`**（插件注册，只给本次飞行的执行体用）：执行体写好测试后调用它，由控制面在执行体的 worktree 里运行本片 scenario 测试，结果写进账本，成为 `measure` 事件。执行体自己跑测试照常可以，但那不算证据。
- **起点测量**：控制面在新建的切片 worktree 上派发执行体之前，先自动测量一次。起点就已经通过的测试，比如映射到已有测试的 scenario，免于「先红」。
- **G5 改为读账本**（门禁带 `--evidence ledger` 时）。以下情况直接判红：
  - 本片某个需要先红的测试，从未在测量里红过；
  - 每次红都发生在已经改动生产代码之后；
  - 缺少起点测量。
  不带这个参数时（Workflow 回退路径），G5 沿用 evidence.log，行为不变。
- **门禁的 base 由控制面给出**：dispatch 事件记下 base，门禁一律带 `--base`，不再读执行体可写的标记。
- **test-evidence 卸下飞行职责**：切片标记写明 `evidence: ledger` 时不写 evidence.log。
- **门禁红次数从账本统计**，飞行记录加一行测量统计。
- **起飞核对版本**：
  - 起飞回复带上插件版本；
  - 已安装的副本与会话加载的副本不一致时拒飞，并提示 `/reload-plugins`；
  - 读不到已安装记录时照常起飞，并注明未核对；
  - 判定器不认识插件要写的事件类型时拒飞，并提示更新主检出。
- **包络补漏**：
  - 解释器 `-c` 与 `eval` 内层命令按同一规则递归判定；
  - `pushd` / `builtin cd` / `command cd` 计入换目录；
  - 改动类 git 不得带 `GIT_*` 环境变量；
  - 拒绝 `git fetch`、`remote` 写入、`branch -u`；
  - Glob 的 pattern 不得越界免询问。
- **归属判定 fail-closed**：读账本失败不缓存为未命中。在飞期间，归属判不出的 agent 的写入与 Bash 一律拒绝。「登记中」刻意不加撤销入口：撤销会让该 agent 脱离包络。
- **铁律 3 改写**为「测试由可信方运行并留痕」，并新增 ADR。执行体定义与提示词写明测量协议。插件版本升到 0.4.0。

无 BREAKING。但 G5 在插件飞行中由警告变为判红，这是刻意加严（铁律 1、3）。

## Capabilities

### New Capabilities
- `flight-measure`：测量工具、`measure` 事件、起点测量、门禁的证据模式与 base 由控制面给出。
- `flight-gate-evidence`：G5 账本判据、门禁红次数与测量统计、test-evidence 卸下飞行职责。
- `flight-envelope-gaps`：#42 评审留下的 Bash 包络缺口。
- `flight-ownership-fail-closed`：归属判定读失败不放行，登记中可撤销。
- `flight-version-check`：起飞时核对插件版本，以及判定器的事件表。
- `flight-measure-docs`：铁律 3、新 ADR、执行体定义与提示词、评审参考材料。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **判定器**：`template/.claude/hooks/` 下的 `slice-gate.py`（新增 measure 子命令、G5 账本模式、start 与 gate 的新参数、严格 XPASS）、`ledger.py`（新增 measure 事件与 `events` 子命令）、`timeline.py`、`test-evidence.py`。
- **插件**：`template/plugins/flight/hooks/` 下的 `io.ts`、`envelope.ts`、`orchestrator.tsx`、`core.ts`、`prompts.ts`，以及新增的 `versions.ts`、`measure.ts`；`agents/executor.md`；插件版本 0.4.0。
- **文档**：根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet` 的铁律 3、`README.md`、`docs/WORKFLOW_zh.md`、`pr-ship.md` 与 `code-reviewer.md` 的评审参考材料，以及新 ADR `DRAFT-flight-measure-protocol`。
- **attempt 1（2026-10-10）停飞后修订计划续飞**：S7 因规划失误被阻断（漏了工具不变量测试的 owns，起飞 scenario 在测试里构造不出）。修订内容：S7 补 owns 与 scenario；新增 S9，把评审的 3 条 HIGH 与 1 条 MEDIUM 写成 scenario。详见 design 的「修订」一节。
- **本 change 跑在已安装的 0.3.x 上**：测量协议在合入之前不生效，本次飞行的 G5 仍是旧的警告语义。合入后，下一次飞行才是测量协议的首飞。
- **合入后必须同时做两件事**：主检出快进（判定器在主检出），以及更新插件并 `/reload-plugins`。只做一件时，新的版本核对会拒飞并说明缺了哪一步。
