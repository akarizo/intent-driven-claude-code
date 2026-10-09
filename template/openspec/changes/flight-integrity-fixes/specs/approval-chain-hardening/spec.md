## ADDED Requirements

### Requirement: 计划指纹不受路径里的 glob 元字符影响
`plan_fp.py` 收集 `specs/**/spec.md` 与 `slices/*.md` 时 SHALL 对 change 目录前缀做 glob 转义。仓库路径含 `[`、`]`、`*`、`?` 时，这些计划文件仍 SHALL 计入指纹。
Feature: 批准绑定计划指纹，不能因为仓库放在 `My [Projects]` 下就失效

#### Scenario: plan-fp-escapes-glob-metachars
- **GIVEN** change 目录位于路径含 `[` 与 `]` 的目录下
- **WHEN** 先算一次指纹，再改 `specs/cap/spec.md` 后再算一次
- **THEN** 两次指纹不同

### Requirement: 账本读取对异常对象一律判损坏
`ledger.py` SHALL 把以下情形判为账本损坏（`LedgerInvalid`，CLI 以 4 退出，stderr 含「账本损坏」）：
- `event.json` 不是合法 UTF-8；
- 账本 ref 指向仓库里不存在的对象（悬空）。

读取 SHALL 只解析一次链尾：`latest_approval` 返回的链尾，必须正是读出这些事件的那个提交。
Feature: 账本只读判定器的结论与它读到的内容严格一致

#### Scenario: ledger-non-utf8-event-is-corrupt
- **GIVEN** demo 的账本唯一提交里，`event.json` 的内容是非 UTF-8 字节
- **WHEN** 运行 `ledger.py verify`
- **THEN** 以 4 退出，stderr 含「账本损坏」

#### Scenario: ledger-dangling-ref-is-corrupt
- **GIVEN** demo 的账本 ref 指向一个仓库里不存在的对象
- **WHEN** 运行 `ledger.py verify`
- **THEN** 以 4 退出，stderr 含「账本损坏」

#### Scenario: ledger-tip-matches-read-chain
- **GIVEN** demo 的账本链尾是批准 F1 的提交 T1
- **AND** 读取过程中，另一个写入方追加了批准 F2 的提交 T2
- **WHEN** 调用 `latest_approval`
- **THEN** 返回的事件是 F1，返回的链尾是 T1

### Requirement: 起飞门禁守住 Workflow 派发
起飞门禁 hook SHALL 按线上真实形态识别 Workflow 派发：`tool_input` 带 `scriptPath`，`args` 是 JSON 字符串。按账本判定：无批准时 deny；账本最新批准指纹等于当前计划指纹时放行。
Feature: Workflow 是飞行派发的主强制点，必须有测试守着

#### Scenario: takeoff-hook-guards-workflow-dispatch
- **GIVEN** demo 没有账本，一次 Workflow 派发的 `args` 是 JSON 字符串、含 demo 的 changeDir
- **WHEN** 以 hook 模式运行起飞门禁；随后给账本追加当前指纹的批准，再运行一次
- **THEN** 第一次 deny
- **AND** 第二次静默放行

### Requirement: 批准带优先显示可批准的项
批准带 SHALL 在可批准的项（无 problem）里取 `spec.html` 最近修改的一项，显示它和批准按钮；没有可批准的项时才显示有问题的项。另有的待批准项与无法批准的项 SHALL 分开计数。
Feature: 一个坏掉的 change 不能挡住其他 change 的批准

#### Scenario: band-prefers-approvable-item
- **GIVEN** demo 可批准（spec.html 较早修改）
- **AND** zeta 所在 worktree 找不到 plan_fp.py（spec.html 较晚修改）
- **WHEN** 会话启动后绘制批准带
- **THEN** 显示 demo 与它的批准按钮
- **AND** 注明另有 1 个无法批准

### Requirement: 读不到版本时给出提示
会话启动时读取 Claude Code 版本的调用失败，插件 SHALL 保持停用，并提示「无法确认 Claude Code 版本，批准带已停用」。
Feature: 停用要让人看得见原因

#### Scenario: version-unreadable-shows-notice
- **GIVEN** 读会话版本的调用失败
- **WHEN** 会话启动
- **THEN** 出现含「无法确认 Claude Code 版本」的提示，且批准带不显示

### Requirement: 账本守卫先规范化路径再匹配
文件写入类工具的目标路径，SHALL 先把反斜杠换成正斜杠，并折叠 `//` 与 `/./`，再判断是否落在 `refs/flight/` 下或是否为 `packed-refs`。
Feature: Windows 路径与没规范化的写法不能漏网

#### Scenario: guard-normalizes-ledger-paths
- **GIVEN** 插件已加载
- **WHEN** 模型对 `C:\repo\.git\refs\flight\demo\ledger`、`/repo/.git/refs//flight/demo/ledger`、`/repo/.git/refs/./flight/demo/ledger` 发起 Write
- **THEN** 三次都被拒绝，理由含 `ledger.py show`

### Requirement: 门禁结论引用与账本同受守卫
`refs/flight/<change>/gate-<S>` 是重派时被采信的证据。Bash / Monitor 命令文本中出现它时，插件 SHALL 与账本 ref 一样拒绝。slice-gate 自己写这条引用时以 python 脚本运行，命令文本里不含引用名，不受影响。
Feature: 新的证据对象，同样的保护

#### Scenario: guard-denies-gate-record-writes
- **GIVEN** 插件已加载
- **WHEN** 模型发起 Bash 命令 `git update-ref refs/flight/demo/gate-S1 abc`，再发起 `python3 .claude/hooks/slice-gate.py gate S1 --change-dir openspec/changes/demo`
- **THEN** 前者被拒绝，理由含 `ledger.py show`
- **AND** 后者照常执行
