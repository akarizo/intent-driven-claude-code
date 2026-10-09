## ADDED Requirements

### Requirement: 起飞判据是账本指纹等于当前计划指纹
`takeoff-gate.py --change-dir DIR` SHALL 用 `plan_fp.py` 的同一函数计算当前指纹、用 `ledger.py` 的同一函数读取最新批准指纹，二者相等才以 0 退出，stdout 打印一行证据「`<批准时间> · fp <前8位> · ledger <链尾前8位>`」。无批准记录、指纹不等、账本损坏时 SHALL 以 3 退出，stderr 分别说明「未批准」「计划已变，需重新批准（批准的是 X，当前是 Y）」「账本损坏」，并给出 `spec.html` 绝对路径、批准带操作说明与插件安装命令。会话转录与文件 mtime SHALL NOT 参与判定；`--session` 参数 SHALL 移除。
Feature: 批准绑定内容，不绑定时刻
Rule: 证据只来自账本，判不出就不放行

#### Scenario: takeoff-accepts-matching-approval
- **GIVEN** change `demo` 的当前指纹为 F，账本最新批准指纹也是 F
- **WHEN** 运行 `takeoff-gate.py --change-dir <demo>`
- **THEN** 以 0 退出，stdout 含 F 的前 8 位与批准时间

#### Scenario: takeoff-rejects-missing-approval
- **GIVEN** change `demo` 没有账本
- **WHEN** 运行 `takeoff-gate.py --change-dir <demo>`
- **THEN** 以 3 退出
- **AND** stderr 含 `spec.html` 绝对路径、「批准带」与 `claude plugin install`

#### Scenario: takeoff-rejects-stale-approval
- **GIVEN** 账本最新批准指纹为 F，之后 `slices.json` 被改，当前指纹变为 G
- **WHEN** 运行 `takeoff-gate.py --change-dir <demo>`
- **THEN** 以 3 退出，stderr 含「重新批准」以及 F 与 G 的前 8 位

#### Scenario: takeoff-rejects-invalid-ledger
- **GIVEN** 账本某个提交的 `event.json` 不是 JSON
- **WHEN** 运行 `takeoff-gate.py --change-dir <demo>`
- **THEN** 以 3 退出，stderr 含「账本损坏」

### Requirement: PreToolUse 拦截未批准的起飞派发
hook 模式（无参数、stdin 为 PreToolUse 载荷）SHALL 沿用现有的起飞类派发识别（Workflow 带 `args.changeDir`；Agent / Task 派 `slice-executor` 或 `integrator`）与 change 目录定位；判定不成立时输出 `permissionDecision: deny`，理由与 CLI 一致。载荷里的转录 SHALL NOT 影响判定。hook 自身异常 SHALL 放行（坏门禁不锁死派发）；但「没有批准记录」是判定结果而不是异常，SHALL 拒绝。
Feature: 派发点上机械强制

#### Scenario: takeoff-hook-denies-despite-transcript-approval
- **GIVEN** 一份转录里人类发出过 `/opsx-apply demo`，而 `demo` 没有账本
- **WHEN** 以该转录路径构造派发 `slice-executor` 的 PreToolUse 载荷并运行 hook
- **THEN** 输出 `permissionDecision: deny`

#### Scenario: takeoff-hook-allows-approved-dispatch
- **GIVEN** 账本最新批准指纹等于 `demo` 的当前指纹
- **WHEN** 以派发 `slice-executor` 的 PreToolUse 载荷运行 hook
- **THEN** 以 0 退出且 stdout 为空

#### Scenario: takeoff-tasks-tick-keeps-approval
- **GIVEN** 账本最新批准指纹等于 `demo` 的当前指纹
- **WHEN** 先勾选 `tasks.md` 后派发一次，再改 `slices.json` 后派发一次
- **THEN** 第一次放行（stdout 为空）
- **AND** 第二次输出 deny，理由含「重新批准」
