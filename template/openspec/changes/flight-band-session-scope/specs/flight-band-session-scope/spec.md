## ADDED Requirements

### Requirement: 批准带只评估本会话认领的 change
flight 插件 SHALL 为每个会话维护一份认领的 change 名集合，存于会话状态：热重载后保留，新进程里为空。刷新待批准列表时，遍历 worktree 与同名去重的规则不变，但 SHALL 只评估名字在认领集合里的 change：未认领的 change 不显示，也不为它计算指纹、不读它的账本。没有已认领的待批准项时，批准带 SHALL 不显示。本进程正在起飞或跑基线的项照旧显示。读取 change 目录（Read 工具、只读的 Bash 命令）SHALL NOT 认领。
Feature: 每个会话只看到自己在做的飞行计划

#### Scenario: band-hides-unclaimed
- **GIVEN** 主 worktree 里有待批准的 change `demo`：有 `spec.html`，`tasks.md` 有未勾选项，账本无批准
- **AND** 本会话没有写过 `demo` 的目录，也没有发过点名 `demo` 的命令
- **WHEN** 会话启动后绘制输入框上方区域
- **THEN** 批准带不显示：没有 `demo`，没有任何按钮
- **AND** 插件没有对 `demo` 的目录运行 `plan_fp.py`

#### Scenario: read-does-not-claim
- **GIVEN** 主 worktree 里有待批准的 change `demo`，会话已启动，批准带不显示
- **WHEN** 本会话用 Bash 运行 `cat <demo 目录>/tasks.md` 与 `grep -n x <demo 目录>/proposal.md`
- **AND** 主会话一轮结束
- **THEN** 批准带仍不显示

### Requirement: 本会话写入 change 目录即认领
本会话发起的 Write / Edit / NotebookEdit / Bash 工具调用，写入目标（口径与意图门禁相同：Write / Edit 的 `file_path`、NotebookEdit 的 `notebook_path`、Bash 命令的写入目标）路径含 `openspec/changes/<name>/` 或以 `openspec/changes/<name>` 结尾时，插件 SHALL 把 `<name>` 记入本会话的认领集合；`archive` 不算 change 名。主循环与子 agent 的调用都算。记录 SHALL NOT 阻止或改动这次工具调用；记录出错时工具调用照常进行。记录之后不立即重绘，主会话一轮结束时照常刷新。
Feature: 写提案的会话自然就能看到要批准的计划

#### Scenario: write-claims-change
- **GIVEN** 主 worktree 里有待批准的 change `demo` 与 `beta`，会话已启动，批准带不显示
- **WHEN** 本会话用 Write 写 `<demo 目录>/proposal.md`
- **AND** 主会话一轮结束
- **THEN** 批准带显示 `demo` 与「批准起飞」按钮，没有「另有」字样
- **AND** 本会话再用 Bash 运行 `touch <beta 目录>/tasks.md`、主会话一轮结束后，批准带显示「另有 1 个待批准」

### Requirement: 人发的命令点名即认领
人（来源为终端、Remote Control 或 SDK）发出的 `/opsx-*` 或 `/flight` 命令，插件 SHALL 在命令执行之前，把参数里每个不以 `-` 开头的词记入本会话的认领集合；只有与真实 change 同名的词才会产生显示。其他来源（如插件代发）SHALL NOT 认领。认领集合因此变大、且批准带已启用时，插件 SHALL 在命令返回后立即刷新一次批准带，不等主会话一轮结束。
Feature: 别的会话写好的 change，在本会话发一次命令就能批准

#### Scenario: command-claims-change
- **GIVEN** 主 worktree 里有待批准的 change `demo` 与 `beta`，会话已启动，批准带不显示
- **WHEN** 插件以自己的名义（来源 `plugin`）发出 `/flight status beta`
- **THEN** 批准带仍不显示
- **WHEN** 人在终端（来源 `composer`）发出 `/flight status demo`，命令返回，期间没有主会话一轮结束
- **THEN** 批准带显示 `demo` 与「批准起飞」按钮，没有「另有」字样
