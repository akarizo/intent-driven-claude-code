## ADDED Requirements

### Requirement: 起飞是两段式握手，发起不等于批准
起飞指令（一行自然语言 或 `/opsx-apply <name>`）SHALL 只构成**发起**；批准 SHALL 是发起之后另一条人类确认消息。`takeoff-gate.py` MUST NOT 再把发起消息本身当作批准，MUST NOT 接受模型代记的批准。
Feature: 每次起飞都停一次，让人看清用哪个模型飞
Rule: 存在一条确认、且晚于最新发起与计划工件最后改动 → 放行；否则停（确认之后又出现新发起同样要重新确认）

#### Scenario: initiation-is-not-approval
- **GIVEN** 一份转录，最后一条人类消息是起飞发起——含 change 名、worktree 路径或 `<command-name>/opsx-apply` 之一，即使正文里带"授权"这类词
- **WHEN** 运行 `python3 .claude/hooks/takeoff-gate.py --change-dir <dir> --session <转录>`
- **THEN** 退出码非 0，stdout 不输出任何"已批准"结论
- **AND** 一行自然语言发起（如 `去 '<worktree>' apply <name>, 授权你git提交, 完成后就pr-ship`）与 `/opsx-apply <name>` 命令形式**判定一致**，两边都停

#### Scenario: short-confirm-approves
- **GIVEN** 同一份转录，其后人又发了一条短确认消息（≤ 40 字、含批准词如 `起飞` / `批准` / `授权` / `approve`，且不含 change 名与 worktree 路径）
- **WHEN** 运行判定
- **THEN** 退出码为 0，stdout 打印批准证据（时间戳 + 人类原话摘要）
- **AND** 该确认消息必须晚于发起消息，也必须晚于计划工件的最后一次改动

#### Scenario: block-message-shows-model-and-scale
- **GIVEN** 一次停下的判定（最后一条人类消息是发起），转录末条主循环 assistant 的 `message.model` 为 `claude-fable-5-1`
- **WHEN** 运行判定
- **THEN** stderr 含当前主模型别名 `fable`，并说明 executor / reviewer 会用它
- **AND** 含切片数与 wave 数（读 `slices.json`；读不到就省略该项，不因此失败）
- **AND** 含该 change 的 worktree **绝对路径**与 `spec.html` 绝对路径
- **AND** 含一句明确的补救指引：确认无误回一句 `起飞`；要换模型先 `/model` 再回

#### Scenario: confirm-must-follow-initiation
- **GIVEN** 一份转录，短确认消息出现在发起消息**之前**（例如上一轮起飞遗留的确认）
- **WHEN** 运行判定
- **THEN** 退出码非 0——确认必须是对本次发起的回应，不继承历史
- **AND** 确认之后计划工件又被改动时同样不成立，stderr 点名"计划在批准之后改过，需重新批准"

#### Scenario: unresolvable-model-still-blocks
- **GIVEN** 最后一条人类消息是发起，但转录里模型 id 认不出别名（如第三方 `k3`）
- **WHEN** 运行判定
- **THEN** 退出码非 0，stderr 点名认不出的原始 id——判不出主模型就不许起飞（fail-closed）
- **AND** 转录完全读不出 assistant 条目时同样停下并说明原因

#### Scenario: hook-denies-dispatch-without-confirm
- **GIVEN** 一次 `PreToolUse` 输入：`Workflow` 工具、`args.changeDir` 指向该 change，而转录里只有发起、没有短确认
- **WHEN** 把该 JSON 喂给 `takeoff-gate.py`（hook 模式，stdin）
- **THEN** stdout 是 `permissionDecision: deny` 的 hook 输出，reason 与 CLI 模式同样含主模型别名与补救指引
- **AND** 确认成立时静默放行；与飞行无关的派发、以及脚本自身异常一律放行

### Requirement: 起飞指令自足
交给人的起飞指令 SHALL 是**一行**，含 worktree 绝对路径、change 名与授权语，人在 `/clear` 清空上下文并切换模型之后可直接复制发出。派发参数（`waves` · `deps` · `expectHead` · `changeDir` · `hooksDir` · `agentsDir` · 执行体模型）MUST NOT 要求人填写或复制——它们 SHALL 由起飞会话从 `slices.json` · `git` · 仓库布局 · `session-model.py` 机械推导。
Feature: 简单精准的一行，机械可得的东西不劳人
Rule: 人只给意图与授权，参数系统自己算

#### Scenario: propose-prints-takeoff-command
- **GIVEN** `template/.claude/commands/opsx-propose.md` 与 `template/.claude/skills/openspec-propose/SKILL.md`
- **WHEN** 阅读收尾的硬交接步骤
- **THEN** 两份文件都要求打印**一行**可直接复制的起飞指令，形如 `去 '<worktree 绝对路径>' apply <name>, 授权你git提交, 完成后就pr-ship, 把pr url交付我review`
- **AND** worktree 路径要求用 `pwd` 拼成绝对路径，不得写相对路径
- **AND** 都明确**不得**把 `waves` · `deps` · `expectHead` · `hooksDir` 等派发参数列进那一行让人复制
- **AND** 仍保留既有三件事：`spec.html` 绝对路径 · 本命令到此结束 · 工件单独 commit

#### Scenario: apply-command-documents-handshake
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 阅读 step 0
- **THEN** 两份文件都写明起飞是两段式：发起只是发起，step 0 展示主模型与规模后停下，等人一句短确认
- **AND** 都写明派发参数由本会话机械推导（`waves` 取 `slice-gate.py lint`、`deps` 取 `slices.json`、`expectHead` 取 `git rev-parse --short=10 HEAD`、`<main>` 取 `session-model.py`），不要求人提供
- **AND** 都写明该停顿由 `takeoff-gate.py` 强制，命令自身不重复判断

#### Scenario: iron-rule-records-handshake
- **GIVEN** 仓库根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet`
- **WHEN** 阅读"两处人类审批"的铁律条目
- **THEN** 都写明起飞为两段式握手：发起 ≠ 批准，批准是发起之后人自己发出的短确认
- **AND** PR #29 已写入的"判据不得由模型自证"保留
