## ADDED Requirements

### Requirement: 会话主模型由脚本判定
飞行与评审派发用的"会话主模型"SHALL 由脚本读会话转录判定，MUST NOT 由模型自述；判定不出时 SHALL 失败退出而非给出默认值。
Feature: 主模型是一条可机械判定的事实
Rule: 读最后一条主循环 assistant 的 model；不认识就报错，不猜

#### Scenario: session-model-resolves-alias
- **GIVEN** 一份主会话转录，最后一条 `type: "assistant"` 条目的 `message.model` 为 `claude-opus-5[1m]`
- **WHEN** 运行 `python3 .claude/hooks/session-model.py --session <该转录>`
- **THEN** stdout 为别名 `opus`，退出码为 0
- **AND** `--json` 时输出含 `alias` / `model` / `session` / `source` 四个字段，`model` 为原始 id

#### Scenario: session-model-latest-wins
- **GIVEN** 一份中途换过模型的转录（依次为 `k3` → `claude-fable-5-1` → `claude-opus-5`，即 2026-09-10 事故会话的形状）
- **WHEN** 运行判定脚本
- **THEN** 输出 `opus`——以最后一条主循环 assistant 为准，早先的 `fable` 不影响结果

#### Scenario: session-model-skips-sidechain
- **GIVEN** 转录里在最后混有 `isSidechain: true` 的 assistant 条目（子 agent，`message.model` 为 `claude-sonnet-5`）
- **WHEN** 运行判定脚本
- **THEN** 输出仍是最后一条**主循环**条目的别名，子 agent 条目被跳过

#### Scenario: session-model-fails-closed
- **GIVEN** 下列任一情形：转录文件不存在 · 转录里没有可用 assistant 条目 · `message.model` 是无法映射的第三方 id（如 `k3`）· 既无 `--session` 也无 `CLAUDE_CODE_SESSION_ID`
- **WHEN** 运行判定脚本
- **THEN** 退出码非 0，stdout 不输出任何别名
- **AND** stderr 点名具体原因（含无法映射时的原始 id）

### Requirement: 起飞与评审的路由取自判定脚本
`/opsx-apply` 与 `/pr-ship` SHALL 以判定脚本的输出作为 `<main>`，判定失败时 SHALL 停下报告且 MUST NOT 派发；人工 SHALL 能以 `--model=<alias>` 覆盖。
Feature: 路由表的声明端有机械来源
Rule: 脚本给不出别名就不起飞，改由人显式指定

#### Scenario: apply-resolves-main-model
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 阅读启动切片工作流的步骤
- **THEN** `<main>` 来自 `python3 .claude/hooks/session-model.py`，两份文件写法一致（命令与同名 skill 不漂移）
- **AND** 判定失败 → 停下报告并提示 `--model=<alias>` 显式指定，不派发任何 agent
- **AND** 全文不再出现"看 `/model`"式由模型自述主模型的措辞
- **AND** 起飞写的 `.flight` 含解析出的路由表、原始 model id 与判定来源

#### Scenario: pr-ship-resolves-main-model
- **GIVEN** `template/.claude/commands/pr-ship.md`
- **WHEN** 阅读两处 `code-reviewer` 派发（首审与 follow-up 复核）
- **THEN** 两处的 `<main>` 都注明取自 `session-model.py`，且仍显式带 `model:`
- **AND** 全文不再出现由模型自述主模型的措辞

### Requirement: 收口路由对账是门禁
收口 SHALL 把各 agent 的实际模型与起飞路由表机械对账，不一致 SHALL 以非 0 退出，MUST NOT 只靠模型肉眼比对。
Feature: 路由表的实际端也有机械来源
Rule: 别名归一后比对；不一致即铁律违规，红着退出

#### Scenario: route-audit-flags-mismatch
- **GIVEN** 一个 Workflow 转录目录，其中某 `Implement` 阶段 agent 的实际模型为 `claude-sonnet-5`，而期望路由 `{"executor": "opus", "reviewer": "opus", "integrator": "sonnet"}`
- **WHEN** 运行 `session-decompose.py --workflow <dir> --expect-models <该 JSON>`
- **THEN** 输出逐条列出不符项（标签 · 阶段 · 期望别名 · 实际 id），退出码非 0
- **AND** `/opsx-apply` 收口遇非 0 时在收口报告点名不符的 agent，并让 `/pr-ship` 以 draft 建 PR（与 final 未绿同处置）

#### Scenario: route-audit-passes-on-match
- **GIVEN** 各 agent 实际模型与期望路由一致（`claude-opus-5[1m]` 与 `claude-opus-5` 都归一为 `opus`）
- **WHEN** 运行同一命令
- **THEN** 打印一致结论，退出码为 0
- **AND** 不传 `--expect-models` 时行为与既有一致：只打印各 agent 实际模型，退出码 0

### Requirement: 判定纪律写进模板文档
模板下发的文档与铁律 SHALL 声明主模型由脚本判定，MUST NOT 保留"由模型自述"的写法。
Feature: 下游装模板即得同一条纪律
Rule: 文档与实现同改，不漂移

#### Scenario: docs-state-mechanical-resolution
- **GIVEN** `README.md` · `docs/WORKFLOW_zh.md` · `template/CLAUDE.md.snippet` · 仓库根 `CLAUDE.md` · `install.sh`
- **WHEN** 检索模型路由相关段落
- **THEN** 均声明会话主模型由 `session-model.py` 判定、判定失败不起飞
- **AND** 铁律 11 增加"主模型判定禁自述"这一条款，且不出现"看 `/model`"式措辞
