## ADDED Requirements

### Requirement: explore 阶段不得产出飞行计划
`/opsx-explore` 阶段 SHALL NOT 写入飞行计划工件（`slices.json` · `tasks.md` · `slices/*.md`），MUST NOT 运行 baseline；越界 SHALL 由 `PreToolUse` hook 以 `permissionDecision: deny` 拒绝，MUST NOT 依赖模型自觉打住。
Feature: 探索就是探索，飞行计划属 propose 收口
Rule: 阶段取自人类自己发出的命令消息，越界动作当场 deny

#### Scenario: explore-denies-flight-plan-write
- **GIVEN** 一份转录，最后一条人类命令消息是 `/opsx-explore`
- **AND** 一次 `PreToolUse` 输入：`Write` 工具，`file_path` 指向 `openspec/changes/<name>/slices.json`
- **WHEN** 把该 JSON 喂给 `phase-gate.py`（hook 模式，stdin）
- **THEN** stdout 是 `permissionDecision: deny` 的 hook 输出
- **AND** reason 点名当前阶段是 explore，并要求显式 `/opsx-propose` 才能落飞行计划
- **AND** 同一阶段下写 `tasks.md` 与 `slices/S1.md` 同样被 deny

#### Scenario: explore-allows-thinking-artifacts
- **GIVEN** 同一份 explore 转录
- **AND** 一次 `PreToolUse` 输入：`Write` 工具，`file_path` 指向 `openspec/changes/<name>/proposal.md`
- **WHEN** 运行判定
- **THEN** 静默放行（无输出、退出码 0）
- **AND** `design.md` 与 `specs/<cap>/spec.md` 同样放行——explore 仍可捕捉思考

#### Scenario: explore-denies-baseline
- **GIVEN** 同一份 explore 转录
- **AND** 一次 `PreToolUse` 输入：`Bash` 工具，`command` 为 `python3 .claude/hooks/slice-gate.py baseline --change-dir openspec/changes/<name>`
- **WHEN** 运行判定
- **THEN** stdout 是 `permissionDecision: deny` 的 hook 输出，reason 说明 baseline 属 propose 收口
- **AND** 同一阶段下不含 `baseline` 子命令的 `slice-gate.py lint` 调用被放行

#### Scenario: non-explore-phase-passes
- **GIVEN** 一份转录，最后一条人类命令消息是 `/opsx-propose`（或 `/opsx-apply`）
- **AND** 一次写 `slices.json` 的 `PreToolUse` 输入
- **WHEN** 运行判定
- **THEN** 静默放行——本门禁只约束 explore 阶段
- **AND** 转录里没有任何 `/opsx-*` 命令消息时同样放行（判不出阶段不锁死能力）

#### Scenario: phase-gate-fails-open-on-error
- **GIVEN** 一次 `PreToolUse` 输入，但转录路径不存在 / 内容不是合法 JSONL
- **WHEN** 运行判定
- **THEN** 静默放行，退出码 0——坏门禁不绑架用户，与 `intent-gate.py` · `takeoff-gate.py` 同规矩

### Requirement: explore 命令写明阶段边界
`/opsx-explore` 命令与 `openspec-explore` skill SHALL 在 Guardrails 写明禁止的三件事，MUST NOT 再出现把 explore 直接推进到飞行的措辞。
Feature: 人读得到的边界，与 hook 判据一致
Rule: 命令文本与 hook 同改，禁漂移

#### Scenario: explore-command-states-boundary
- **GIVEN** `template/.claude/commands/opsx-explore.md` 与 `template/.claude/skills/openspec-explore/SKILL.md`
- **WHEN** 阅读 Guardrails 段
- **THEN** 两份文件都写明 explore 不产出 `slices.json` · `tasks.md` · `slices/*.md`、不跑 baseline、不派实现类子 agent
- **AND** 都写明工件成形后引导人显式 `/opsx-propose`，而不是在同一轮继续
- **AND** 仍保留 `proposal.md` · `design.md` · `specs/**` 可在 explore 内写的既有定位
