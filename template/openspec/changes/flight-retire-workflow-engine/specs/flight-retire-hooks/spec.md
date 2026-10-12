## ADDED Requirements

### Requirement: takeoff-gate 的 hook 模式退役
`takeoff-gate.py` 不带参数运行时 SHALL 读掉 stdin、不输出、以 0 退出；`--change-dir` 的 CLI 模式（插件起飞守卫在用）SHALL 不变。
Feature: hook 模式只拦 Workflow / slice-executor / integrator 派发，旧引擎删除后无对象

#### Scenario: takeoff-gate-hook-mode-retired
- **GIVEN** change demo 未批准，载荷是一个 Workflow 派发（`args.changeDir` 指向 demo）
- **WHEN** 不带参数运行 `takeoff-gate.py` 并把载荷送进 stdin，再以 `--change-dir <demo>` 运行一次
- **THEN** 前者退出 0、stdout 为空
- **AND** 后者以 3 退出、输出含「未批准」

### Requirement: stop-gate 是兼容空壳
`stop-gate.py` SHALL 读掉 stdin、不输出、以 0 退出，不论有没有切片标记与门禁结论。
Feature: 已注册的 Stop / SubagentStop hook 不带存在保护调用它，删除文件会卡住会话收尾

#### Scenario: stop-gate-is-noop
- **GIVEN** 一个存在 `.openspec-slice` 标记、本片门禁未绿的仓库
- **WHEN** 以 SubagentStop 载荷运行 `stop-gate.py`
- **THEN** 退出 0、stdout 为空（不 block）

### Requirement: test-evidence 只记飞行外
`test-evidence.py` 在 git toplevel 下存在 `.openspec-slice` 标记时 SHALL 一律不写 evidence.log（不论标记里的 evidence 模式）；没有标记时 SHALL 照旧写入。
Feature: 用户定：evidence.log 保留作飞行外的留痕

#### Scenario: test-evidence-skips-slice-worktrees
- **GIVEN** 两个仓库各跑一次 pytest 的 Bash 载荷：
  - 一个有 `.openspec-slice` 标记（evidence 为 log）；
  - 一个在 `worktree-demo` 分支上、没有标记
- **WHEN** 分别运行 `test-evidence.py`
- **THEN** 前者 change 目录下没有 evidence.log
- **AND** 后者 demo 的 evidence.log 新增一行

### Requirement: 模板 hooks.json 不再注册退役 hook
`template/.claude/hooks/hooks.json` SHALL NOT 注册 takeoff-gate、`slice-gate.py checkpoint`、stop-gate；test-evidence 的注册 SHALL 保留。`session-decompose.py` SHALL 删除。
Feature: 新安装只注册仍在服务的 hook

#### Scenario: retired-hooks-unregistered
- **GIVEN** 本 change 合入后的模板
- **WHEN** 读取 `template/.claude/hooks/hooks.json` 的全部命令，并检查 `template/.claude/hooks/session-decompose.py`
- **THEN** 命令里不含 `takeoff-gate.py`、`checkpoint`、`stop-gate.py`，仍含 `test-evidence.py`
- **AND** `session-decompose.py` 不存在
