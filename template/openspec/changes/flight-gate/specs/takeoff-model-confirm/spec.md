## ADDED Requirements

### Requirement: 起飞前执行模型须经人确认
`/opsx-apply` SHALL 在人未确认执行模型前被 `UserPromptSubmit` hook 阻断；确认的证据 SHALL 是人自己 prompt 里的 `--confirm-model=<alias>`，MUST NOT 由模型代为记录或推断。
Feature: 人看得见自己正在用哪个模型起飞
Rule: 无 flag 不起飞；flag 与转录实测主模型必须一致

#### Scenario: blocks-apply-without-confirm
- **GIVEN** 一份转录，最后一条主循环 assistant 的 `message.model` 是 `claude-fable-5-1`
- **AND** 一次 `UserPromptSubmit` 输入，prompt 为人敲的 `/opsx-apply <change>`，不含 `--confirm-model=`
- **WHEN** 把该 JSON 喂给 `phase-gate.py`（stdin）
- **THEN** 退出码为 2（阻断该 prompt）
- **AND** stderr 含 change 名、当前主模型别名 `fable`、切片数与 wave 数
- **AND** stderr 给出两条出路：先 `/model` 切换后重敲，或带 `--confirm-model=fable` 重敲

#### Scenario: accepts-matching-confirm
- **GIVEN** 同一份转录（实测主模型别名为 `fable`）
- **AND** prompt 为 `/opsx-apply <change> --confirm-model=fable`
- **WHEN** 运行判定
- **THEN** 静默放行，退出码 0，不写任何文件——证据就在 prompt 里，转录可复核

#### Scenario: rejects-mismatched-confirm
- **GIVEN** 同一份转录（实测主模型别名为 `fable`）
- **AND** prompt 为 `/opsx-apply <change> --confirm-model=opus`
- **WHEN** 运行判定
- **THEN** 退出码为 2
- **AND** stderr 点名 flag 声称 `opus` 但实测主模型是 `fable`，要求先真的切换再重敲
- **AND** 不因 flag 存在就放行——防止人以为切了而其实没切

#### Scenario: confirm-required-every-takeoff
- **GIVEN** 同一个 change 上一次起飞已带 `--confirm-model=fable` 放行过
- **AND** 新一次 `/opsx-apply <change>` 的 prompt 不含 flag
- **WHEN** 运行判定
- **THEN** 仍然阻断——确认是每次起飞的动作，不继承历史

#### Scenario: unrelated-prompt-passes
- **GIVEN** 一次 `UserPromptSubmit` 输入，prompt 与 `/opsx-apply` 无关（普通提问，或 `/opsx-propose`）
- **WHEN** 运行判定
- **THEN** 静默放行，退出码 0——本门禁只在起飞命令上生效

#### Scenario: unresolvable-model-fails-open
- **GIVEN** 一次 `/opsx-apply` 的 prompt，但转录定位不到 / 读不出任何 assistant 条目
- **WHEN** 运行判定
- **THEN** 放行，退出码 0——`UserPromptSubmit` 阻断会抹掉 prompt，环境异常时不能把人锁在门外
- **AND** 转录可读但模型 id 认不出别名（如第三方 id）时改为阻断，stderr 点名认不出的 id

### Requirement: apply 命令写明确认 flag 的语义
`/opsx-apply` 命令与 `openspec-apply-change` skill SHALL 写明 `--confirm-model=<alias>` 由 hook 强制、不参与 change 名解析。
Feature: flag 的含义与归属写清楚，命令自身不重复判断
Rule: 命令文本与 hook 同改，禁漂移

#### Scenario: apply-command-documents-flag
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 阅读 Input 与 step 0
- **THEN** 两份文件都写明 `--confirm-model=<alias>` 的语义与它不参与 change 名解析
- **AND** 都写明该 flag 由 `UserPromptSubmit` hook 强制，命令自身不判断
- **AND** 既有的 `takeoff-gate.py` 自检步骤保持不变

#### Scenario: iron-rule-records-confirm
- **GIVEN** 仓库根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet`
- **WHEN** 阅读两处人类审批的铁律条目
- **THEN** 都写明起飞前执行模型须经人确认，证据是人 prompt 里的 `--confirm-model=`

### Requirement: 起飞指令自足
交给人的起飞指令 SHALL 自足——人在 `/clear` 清空上下文、切换模型之后，不依赖任何会话记忆即可直接复制起飞。指令 MUST 包含 worktree 的**绝对路径**、change 名、确认 flag，以及派发所需的全部参数；MUST NOT 只给一句"运行 `/opsx-apply <name>`"。
Feature: 切模型要 clear，clear 后不该再问"我在哪个目录"
Rule: 收尾交付与阻断提示都给可直接复制的整段，不留待补全的空

#### Scenario: propose-prints-takeoff-command
- **GIVEN** `template/.claude/commands/opsx-propose.md` 与 `template/.claude/skills/openspec-propose/SKILL.md`
- **WHEN** 阅读收尾的硬交接步骤
- **THEN** 两份文件都要求打印一段**可直接复制的起飞指令**，其中含 worktree 绝对路径（用 `pwd` 拼）、change 名与 `--confirm-model=<alias>` 占位
- **AND** 都要求同时打印派发参数：`changeDir` · `hooksDir` · `agentsDir` · `waves` · `deps` · `expectHead`（`git rev-parse --short=10 HEAD`），使起飞会话不必重新推导
- **AND** 仍保留既有三件事：`spec.html` 绝对路径 · 本命令到此结束 · 工件单独 commit

#### Scenario: block-message-carries-worktree
- **GIVEN** 一次被阻断的起飞（转录实测主模型 `fable`，prompt 无 `--confirm-model=`），hook 输入的 `cwd` 位于该 change 的 worktree 内
- **WHEN** 运行判定
- **THEN** stderr 的补救命令含该 worktree 的**绝对路径**，人可整段复制而不必自己拼目录
- **AND** `cwd` 不在任何 worktree 内时省略路径一项，其余照常输出（不因此阻断失败）
