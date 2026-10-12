## ADDED Requirements

### Requirement: ship 工具核对 PR 后才裁决
`shipPr` SHALL 依次检查以下各项，任一不满足即返回 `{deny}`，并且 SHALL NOT 贴评论、SHALL NOT 切换 PR 状态、SHALL NOT 写账本：
- 本 attempt 已落地（否则原因含「还没落地」）；
- origin 是 GitHub（否则原因含「只支持 GitHub」）；
- pr 为数字或以 `/pull/<数字>` 结尾的 URL；
- `gh pr view` 的 `headRefName` 等于 change 分支；
- `headRefOid` 等于 change worktree 的 HEAD（否则原因含「先推送」）。
Feature: 用户定（2026-10-13）：C3-A draft / ready 由插件执行

#### Scenario: ship-tool-checks-pr-head
- **GIVEN** change demo 已落地，分支 `worktree-demo`，HEAD 为 h1，origin 为 github.com；五个世界：
  - PR 7 的 headRefName 为 `other`；
  - PR 7 的 headRefOid 为 h0；
  - 账本没有 land；
  - origin 为 gitlab.com；
  - pr 参数为 `abc`
- **WHEN** 各调用一次 `shipPr`
- **THEN** 五次都返回 deny：
  - 第一次原因含 `worktree-demo`；
  - 第二次含「先推送」；
  - 第三次含「还没落地」；
  - 第四次含「只支持 GitHub」
- **AND** 五个世界都没有运行 `gh pr comment` 与 `gh pr ready`，账本没有新事件

### Requirement: ship 工具按账本裁决执行
核对通过后，`shipPr` SHALL 运行 `slice-gate.py ship --change-dir`（cwd 为 change worktree）取得 JSON，并 SHALL 用 `gh pr comment` 贴出 `shipComment` 的内容。之后按裁决切换 PR 状态：
- 裁决为 ready 且 PR 是 draft 时，SHALL 运行 `gh pr ready <n>`；
- 裁决为 draft 且 PR 不是 draft 时，SHALL 运行 `gh pr ready <n> --undo`；
- 其余情况 SHALL NOT 切换。
最后 SHALL 追加 ship 事件 `{attempt, pr: <PR url>, verdict, commit: <HEAD>}`，返回的 result SHALL 写明裁决。`io.ts` 的事件字段表 SHALL 含 ship，与 `ledger.py` 一致。
Feature: 用户定（2026-10-13）：C3-A

#### Scenario: ship-tool-applies-ledger-verdict
- **GIVEN** demo 已落地，PR 7 的头与 HEAD h1 相符；三个世界：
  - ship 裁决 ready、PR 是 draft；
  - ship 裁决 draft（reasons 为 `["1 条 CRITICAL/HIGH 评审未闭环"]`）、PR 不是 draft；
  - ship 裁决 draft、PR 是 draft
- **WHEN** 各调用一次 `shipPr`
- **THEN** 第一个世界依次运行 `gh pr view`、`slice-gate.py ship`、`gh pr comment 7`、`gh pr ready 7`，账本末条为 ship 事件（pr 为 PR url、verdict ready、commit h1），result 含 ready
- **AND** 第二个世界运行了 `gh pr ready 7 --undo`，评论正文含「1 条 CRITICAL/HIGH 评审未闭环」
- **AND** 第三个世界没有运行 `gh pr ready`，账本末条为 verdict draft 的 ship 事件

### Requirement: 评论内容
`shipComment` SHALL 依次输出：标题 `## flight 裁决：<ready|draft>`、commit 前 10 位、draft 时的「未满足」reasons、全量评审的轮次与 agent 以及逐条 `file:line — 级别 — 摘要 — 修法：…`、「未自动修的 MEDIUM/LOW」逐条，末行为 `— flight 插件，<YYYY-MM-DD>`。
Feature: 用户定（2026-10-13）：C3-A

#### Scenario: ship-comment-lists-findings
- **GIVEN** ship JSON：ready false、reasons `["1 条 CRITICAL/HIGH 评审未闭环"]`、review `{slice:"whole-r1", agent:"r9", commit:"c10"}`、blocking 一条 HIGH `a.ts:3 空指针 / 判空`、deferred 一条 MEDIUM `b.ts:5 命名 / 改名`；日期 2026-10-13
- **WHEN** 生成评论
- **THEN** 依次含「flight 裁决：draft」「1 条 CRITICAL/HIGH 评审未闭环」「whole-r1」「a.ts:3 — HIGH — 空指针 — 修法：判空」「b.ts:5 — MEDIUM — 命名 — 修法：改名」，末行为「— flight 插件，2026-10-13」

### Requirement: ship 工具只接受主会话
插件 SHALL 在会话开始时注册 `ship` 工具，失败时忽略。带 agentId 的调用 SHALL 一律被拒，原因含「只接受主会话」。主会话调用时，插件 SHALL 校验输入 `{change, pr}`，定位 change、读账本后交给 `shipPr`。修复轮的合回动作 SHALL 以动作里的 slice 调用 `mergeFix`。
Feature: 用户定（2026-10-13）：C3-A

#### Scenario: ship-tool-main-session-only
- **GIVEN** demo 已落地，PR 7 的头与 HEAD 相符，ship 裁决 ready；另有一个在飞 change 的执行体 X
- **WHEN** X 以 `{change:"demo", pr:"7"}` 调用 `mcp__flight__ship`；主会话以同样输入调用
- **THEN** X 被拒，原因含「只接受主会话」
- **AND** 主会话的调用返回的 result 含 ready，demo 的账本末条为 ship 事件

#### Scenario: fix-round-merges-by-slice
- **GIVEN** demo 在飞，账本里 fix-r1 修复体的收口门禁绿且已结束，分支为 `flight/demo/fix-r1`
- **WHEN** drive 执行合回
- **THEN** 运行了 `git -C <change worktree> merge --no-ff flight/demo/fix-r1 -m integrate: fix-r1`，账本末条 merge 事件的 slice 为 `fix-r1`、ok 为 true

### Requirement: 不变量
没有同名命令文件时，插件注册的斜杠命令 SHALL 恰为 `flight` 与 `opsx-apply`。模型可调用的工具 SHALL 恰为 `submit_findings`、`measure` 与 `ship`。任何工具或命令在任何输入下都 SHALL NOT 追加 approve 事件；`ship` SHALL 只追加 ship 事件。本要求取代 flight-entry-handoff 中「模型可调用的工具恰为 submit_findings 与 measure」的约束。
Feature: 用户定（2026-10-13）：C3-A；沿用 D8（#50）

#### Scenario: tools-and-commands-invariant
- **GIVEN** 插件已加载，仓库里有待批准的 demo，会话已启动
- **WHEN** 对三个工具各以三种输入调用：主会话 `{findings:[1 条 HIGH]}`、非飞行 agent 带同样输入、伪造 `{ev:"approve", fp:F}`
- **THEN** 注册的工具按名排序恰为 measure、ship、submit_findings，命令恰为 flight、opsx-apply
- **AND** 全部调用都没有向账本写入任何事件

### Requirement: 插件自己注册入口时 per-task 给出指引
插件在会话开始时成功注册了 `opsx-apply` 时，`/opsx-apply <change> --gate=per-task` SHALL 直接回复：含「本项目没有 /opsx-apply 命令文件」与 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md`，并且 SHALL NOT 写账本。注册被拒（项目有同名命令文件）时 SHALL 照旧透传。
Feature: #51 评审 LOW（2026-10-13 用户定一并处理）

#### Scenario: per-task-guidance-when-plugin-registers
- **GIVEN** 两个世界：甲的 command.register 照常应答；乙对 opsx-apply 抛「refused: it is the user's /opsx-apply」
- **WHEN** 各自开始会话，再由人在终端发出 `/opsx-apply demo --gate=per-task`
- **THEN** 甲的回复含「本项目没有 /opsx-apply 命令文件」与 legacy skill 路径，账本没有新事件，没有透传
- **AND** 乙照旧透传：log.commands 恰为 `['opsx-apply demo --gate=per-task']`

### Requirement: 起飞核对 ship-ledger 能力
`REQUIRED_FEATURES` SHALL 含 `ship-ledger`。判定器的 `features` 缺少它时，起飞核对 SHALL 拒飞，原因列出 ship-ledger。
Feature: 已定（2026-10-13）：判定器与插件同版本

#### Scenario: judges-need-ship-ledger
- **GIVEN** 判定器目录 /j4，`ledger.py events` 列出全部所需事件，`slice-gate.py features` 只输出 evidence-ledger-only、g5-per-target、guards
- **WHEN** 对 /j4 运行 checkJudges
- **THEN** 拒飞，原因含「缺少能力 ship-ledger」与「先把主检出更新到与插件同一版本」
