## ADDED Requirements

### Requirement: 起飞需要人类批准的机械证据
起飞 SHALL 以会话转录里**人类自己发出**的批准消息为证据，MUST NOT 以模型自己记录的 `approve` 事件为准；批准 SHALL 晚于计划工件的最后一次改动。
Feature: 批准是人给的事实，不是模型的叙述
Rule: 人类消息 + 新鲜度，两者缺一即不起飞

#### Scenario: approval-gate-accepts-human-command
- **GIVEN** 一份转录，其中有一条人类消息调用了 `/opsx-apply <change>`（`<command-name>` 形式），时间晚于计划工件的最大 mtime
- **WHEN** 运行 `python3 .claude/hooks/takeoff-gate.py --change-dir <dir> --session <转录>`
- **THEN** 退出码为 0，stdout 打印批准证据（时间戳 + 人类原话摘要）
- **AND** 一条不含命令调用、但内容为短批准词（如 `起飞` / `授权` / `批准`）的人类消息同样被接受

#### Scenario: approval-gate-rejects-self-start
- **GIVEN** 一份转录，最近的人类消息只是继续规划类指令（如 `继续上述任务的规划`），既无 `/opsx-apply` 调用也无批准词
- **WHEN** 运行判定
- **THEN** 退出码非 0，stdout 不输出任何"已批准"结论
- **AND** stderr 说明需要人类显式批准，并给出 `spec.html` 路径与补救方式

#### Scenario: approval-gate-requires-fresh-approval
- **GIVEN** 批准消息的时间**早于**计划工件（`proposal.md` · `design.md` · `slices.json` · `specs/**/spec.md`；`tasks.md` 的勾选是执行记账，不算计划改动）的最大 mtime——即计划在批准之后又被改过
- **WHEN** 运行判定
- **THEN** 退出码非 0，stderr 点名"计划在批准之后改过，需重新批准"

### Requirement: 飞行派发由 hook 强制
飞行派发 SHALL 被 `PreToolUse` hook 拦截并校验批准证据；未获批准 SHALL 以 `permissionDecision: deny` 拒绝，MUST NOT 依赖模型自觉停下。
Feature: 强制点在 hook，模型绕不过
Rule: 命中飞行派发才判定，其余一律放行

#### Scenario: takeoff-hook-denies-unapproved-dispatch
- **GIVEN** 一次 `PreToolUse` 输入：`Workflow` 工具、`args.changeDir` 指向 `openspec/changes/<name>`，而转录里没有该 change 的人类批准
- **WHEN** 把该 JSON 喂给 `takeoff-gate.py`（hook 模式，stdin）
- **THEN** stdout 是 `permissionDecision: deny` 的 hook 输出，reason 含 `spec.html` 路径与"需人类显式 `/opsx-apply`"
- **AND** 同样的输入在批准成立时静默放行（无输出、退出码 0）

#### Scenario: takeoff-hook-ignores-unrelated-dispatch
- **GIVEN** 一次与飞行无关的派发（`tool_input` 里不含 `openspec/changes/<name>`，如普通 Explore 子 agent）
- **WHEN** 把该 JSON 喂给 hook
- **THEN** 静默放行；脚本自身异常（转录不可读等）同样放行——hook 不锁死派发能力

#### Scenario: hook-allows-review-dispatch
- **GIVEN** 一次 `/pr-ship` 的 `code-reviewer` 派发，prompt 里提到了该 change 的 `gate-report.md` 路径，而转录里没有任何批准
- **WHEN** 把该 JSON 喂给 hook
- **THEN** 静默放行——只有起飞类派发（`Workflow` 带 `args.changeDir` / `Agent` 派 `slice-executor`·`integrator`）才判定
- **AND** 否则本门禁会掐断铁律 4 要求的独立评审

#### Scenario: tasks-tick-keeps-approval
- **GIVEN** 批准成立后，收口把 `tasks.md` 里门禁绿的切片勾成 `- [x]`（mtime 变新）
- **WHEN** 随后再有起飞类派发
- **THEN** 仍然放行——勾选是执行记账不是计划变更
- **AND** 改动真正的计划工件（如 `slices.json`）后同一派发被 deny，新鲜度规则本身不放松

### Requirement: 规划收尾硬交接，起飞前先自检
`/opsx-propose` SHALL 在收尾把 `spec.html` 交给人并声明本轮结束；`/opsx-apply` SHALL 在 step 0 自跑批准自检并在未批准时停下报告。
Feature: 人的两处审批看得见
Rule: propose 不接 apply；apply 先验批准再谈路由

#### Scenario: propose-ends-with-handoff
- **GIVEN** `template/.claude/commands/opsx-propose.md` 与 `template/.claude/skills/openspec-propose/SKILL.md`
- **WHEN** 阅读收尾步骤
- **THEN** 两份文件都要求打印 `spec.html` 的**绝对路径**，并声明"本命令到此结束，不得在同一轮继续 apply；起飞需人类显式 `/opsx-apply`"
- **AND** 不再出现"运行 `/opsx-apply` 即视为批准"这种把批准与执行合并的措辞（批准仍由人给，但要人自己发出）

#### Scenario: apply-checks-approval-gate
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 阅读起飞前的步骤
- **THEN** step 0 运行 `takeoff-gate.py --change-dir …`，非 0 → 停下报告并把 `spec.html` 路径交给人，不进入后续任何步骤
- **AND** step 4 的 `approve` 事件带上该批准证据（时间戳 + 原话摘要），不再由模型自证
- **AND** `.flight` 记录 `approval` 字段
