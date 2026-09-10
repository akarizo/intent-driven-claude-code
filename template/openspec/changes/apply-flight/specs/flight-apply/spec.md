## ADDED Requirements

### Requirement: apply 作为一次飞行
`/opsx-apply` SHALL 在批准到 PR 打开之间不发起任何问询，并 SHALL 用确定性脚本按 wave 并行派发切片。
Feature: /opsx-apply 的编排契约
Rule: 批准到 PR 打开之间零问询；失败是数据不是对话

#### Scenario: workflow-script-valid
- **GIVEN** `template/.claude/workflows/opsx-apply.js`
- **WHEN** 静态检查该脚本
- **THEN** 第一条语句是纯字面量 `export const meta`，`name` 为 `opsx-apply`，`phases` 含 Implement / Review / Fix / Finalize
- **AND** wave 内用 `parallel` 派发切片，评审 agent 只 push 不 await，直到 Fix 阶段才 `Promise.all`
- **AND** `node --check` 通过

#### Scenario: apply-command-zero-prompts
- **GIVEN** `template/.claude/commands/opsx-apply.md`
- **WHEN** 阅读其步骤
- **THEN** 步骤顺序为：选 change → git 纪律检查 → `slice-gate.py lint` 得 waves → 记录 approve 事件 → 启动命名工作流 `opsx-apply`（不可用时回退 Agent 并行派发）→ 收 JSON → 收口分解 → 直接进入 `/pr-ship`
- **AND** 启动到 pr-ship 之间不出现 AskUserQuestion
- **AND** 保留 `--gate=per-task` 旗标指向 `skills/legacy/`

#### Scenario: pr-ship-single-review
- **GIVEN** `template/.claude/commands/pr-ship.md`
- **WHEN** 阅读其步骤
- **THEN** commit 文案、PR 正文、逐 finding 处置、是否复审四处不再问询，AskUserQuestion 至多出现在收尾一次
- **AND** 评审 subagent 的输入包含 gate-report.md 与 evidence.log，并声明不重跑测试
- **AND** CRITICAL/HIGH 自动修复至多 2 轮后停下交人

#### Scenario: legacy-mode-optional
- **GIVEN** 安装后的 `.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md`
- **WHEN** 用户以 `--gate=per-task` 调用 `/opsx-apply`
- **THEN** 命令转到该 legacy skill，其余情况不加载它

### Requirement: 执行体 / 集成员 / 评审员契约
执行纪律 SHALL 写在 agent 定义里，主会话 MUST NOT 以 prompt 转述替代。
Feature: agent 定义承载纪律，不靠主会话转述

#### Scenario: executor-agent-contract
- **GIVEN** `template/.claude/agents/slice-executor.md`
- **WHEN** 读取 frontmatter 与正文
- **THEN** frontmatter 含 `model: inherit`、`maxTurns: 40`、`permissionMode: acceptEdits`，tools 含 Read / Edit / Write / Bash
- **AND** 正文要求：先 `slice-gate.py start`，只写 owns 内文件，一轮多动作，不加 `cd &&` 前缀，收尾运行 gate 并原样返回其 JSON，不写报告

#### Scenario: reviewer-no-rerun
- **GIVEN** `template/.claude/agents/code-reviewer.md`
- **WHEN** 读取正文
- **THEN** 只保留 `full` 与 `follow-up` 两种模式，删除 `integration` 与水位线段
- **AND** 铁律含「不重跑测试套件、不轮询，以门禁报告与 evidence.log 为准，至多 1 次定向抽查」
- **AND** 支持在 prompt 要求时输出结构化 findings（severity / file / line / summary / fix）

### Requirement: 飞行记录
每次 apply SHALL 记录时间事件，并 SHALL 能打印批准到 PR 打开的用时。
Feature: 每次 apply 自带度量

#### Scenario: timeline-report
- **GIVEN** `timeline.md` 含 `approve` 与 `pr-open` 事件
- **WHEN** 运行 `timeline.py report --change-dir <dir>`
- **THEN** 打印批准到 PR 打开的分钟数

#### Scenario: session-decompose-runs
- **GIVEN** 一个最小的会话转录 fixture（含 assistant / tool_result / task-notification 条目）
- **WHEN** 运行 `session-decompose.py --session <path>`
- **THEN** 打印等子 agent / 模型生成 / 工具执行 / 等人四类归因与子 agent 数
