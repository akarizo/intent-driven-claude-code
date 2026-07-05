# Intent-Driven 工作流详解

> 把 _为什么_、_做什么_、_怎么做_、_长期决策_、_实现步骤_ 这五件事，**强制按顺序**写下来，让代码上线时仍然能解释自己。

```
proposal → specs → design → adr → tasks
```

每一步都依赖前一步。`/opsx-apply` 在 `tasks` 完成前会拒绝运行。
schema 把这套规则编码在 `openspec/schemas/intent-driven/schema.yaml` 里。

---

## 阶段总览

| 阶段 | 文件 | 关键问题 | 配套 skill |
| --- | --- | --- | --- |
| 1. proposal | `proposal.md` | 为什么现在做？影响什么 capability？ | `grill-me` |
| 2. specs | `specs/<capability>/spec.md` | 系统外部可观测的行为是什么？ | `gherkin-authoring` |
| 3. design | `design.md` | 怎么实现？权衡了什么？ | `c4-diagrams` |
| 4. adr | `<repo>/openspec/adr/NNNN-*.md` | 哪些是长期不可逆的架构决策？ | `architectural-decision-records` |
| 5. tasks | `tasks.md` | 怎么落到逐条可勾选的步骤？ | —— |

---

## 1. proposal — 写"为什么"

**目标**：让一个完全没上下文的同事/未来的自己，仅凭这份 proposal 就能判断这件事值不值得做。

**模板**（来自 schema）：

```markdown
## Why
<!-- 1-2 句话点明问题 / 机会 -->

## What Changes
<!-- bullet 列出新增 / 修改 / 删除；BREAKING 显式标注 -->

## Capabilities
### New Capabilities
- `user-auth`: 简述这个能力的范围
### Modified Capabilities
- `data-export`: 行为级的改动是什么

## Impact
<!-- 影响的代码、API、依赖、运维系统 -->
```

**`Capabilities` 是 proposal → specs 的契约**：每一个列出的 capability 都会在 specs 阶段
对应一个 `specs/<capability>/spec.md` 文件。

---

## 2. specs — 写"做什么"

**目标**：用 Gherkin 句式描述行为，避免泄漏 UI/数据库/HTTP 细节。

```markdown
## ADDED Requirements

### Requirement: User data export
Feature: User data export
Rule: Users can export their own data

#### Scenario: Successful CSV export
- **GIVEN** a user has saved data
- **WHEN**  the user exports their data as CSV
- **THEN** the system provides a CSV file containing the user's data
```

四种 delta header：

| Header | 用途 | 注意事项 |
| --- | --- | --- |
| `## ADDED Requirements` | 新增 requirement | 直接写 |
| `## MODIFIED Requirements` | 修改已有 requirement | **必须粘贴完整的修改后内容**，不能只贴 diff |
| `## REMOVED Requirements` | 删除 requirement | 必须含 `**Reason**` 和 `**Migration**` |
| `## RENAMED Requirements` | 仅改名 | `FROM: / TO:` 格式 |

`### Requirement: <name>` 和 `#### Scenario: <name>` 的标题层级是 OpenSpec archive 用来合并的契约，**不能改**。

---

## 3. design — 写"怎么做"

**目标**：把会被后续 review 的关键决策（why X over Y）固化下来；预防"半年后看代码不知道为什么这么写"。

`design.md` 包含：

- **Context**：现状、约束、相关人
- **Goals / Non-Goals**：明确做什么 + **明确不做什么**
- **Decisions**：每个决策都附 _备选方案_ 和 _选择理由_
- **Risks / Trade-offs**：`[Risk] → Mitigation`
- **Migration Plan**：上线 / 回滚步骤
- **Open Questions**：尚未解决的问题；如果建议变更某个 in-force ADR，写在这里，由 adr 阶段处理

**铁律**：写 design 前先读 `openspec/adr/`，构建 supersession 图，识别**当前生效**的 ADR 集合。
新 design 必须跟现行 ADR 一致；要推翻某个现行 ADR，只能在 Open Questions 提议并让 adr 阶段新建一个 supersede。

---

## 4. adr — 写"长期不可逆决策"

**铁律**：**ADR 一经 accepted 就不可改**。任何字段都不可改：Status、Date、Decision、Consequences 全部冻结。

要变更一个旧决策？新建一个 ADR：

```markdown
# 0042. 改用 Postgres 替代 MySQL 做目录服务

- Status: accepted, supersedes ADR-0017
- Date: 2026-05-13
- Supersedes: ADR-0017

## Context
...为什么要重新讨论 ADR-0017...
```

文件名：`NNNN-kebab-title.md`，NNNN 是仓库范围全局递增，**永不复用**。

何时建 ADR？满足三个条件全部：

1. 是**长期架构承诺**（pattern / 技术选型 / 模块边界 / 契约），不是战术实现细节
2. 会影响**当前变更之外**的未来工作
3. 当前没有 in-force ADR 已经覆盖，或者**有意推翻**某个 in-force ADR

不满足就别建 ADR，写在 design 里即可。

---

## 5. tasks — 写"怎么逐步实现"

```markdown
## 1. 数据层

- [ ] 1.1 新建 user_exports 表（migration）
- [ ] 1.2 增加 ExportJob 模型

## 2. API 层

- [ ] 2.1 POST /v1/exports 创建任务
- [ ] 2.2 GET  /v1/exports/:id 查询状态
```

**强制**：必须用 `- [ ]` checkbox 格式，否则 `/opsx-apply` 解析不到进度。

---

## apply 两种执行模式 · 串行 vs subagent 逐 task 守门

`/opsx-apply <name>` 开始前（step 6 确认）让你选执行模式：

| 模式 | 承载 skill | 怎么跑 | 守门 |
| --- | --- | --- | --- |
| **subagent 逐 task 守门**（推荐中级+） | `openspec-subagent-apply-change` | 主会话逐个 task 派 **fresh 实现 subagent**（强制 TDD），完成即派 **`code-reviewer` subagent** 审本 task 净 diff | **CRITICAL/HIGH 阻断**，回灌修复过才勾 checkbox；末尾 full review + verify |
| **串行（轻量）** | `openspec-apply-change` | 主会话逐 task 串行写 | 无（靠 `/pr-ship` 末尾一次性评审） |

**逐 task 守门循环**（吸收自 sdd-plus-superpowers 的 subagent-development 玩法，中文化自研、不依赖外部插件）：

```
对每个 task：
  派 fresh 实现 subagent（走 test-driven-development：RED→验红→GREEN→验绿→REFACTOR + GWT 中文注释）
    → 派 code-reviewer subagent 审本 task 净 diff（CRITICAL/HIGH 阻断）
    → 有阻断项 → 回灌实现 subagent 修 → 复审（循环到清零）
    → 勾选 checkbox - [ ] → - [x] → 下一个 task
全部 task 完成 → full review（整个 change 累计 diff）→ /opsx-verify → 收口（不 merge 不 archive）
```

**关键约束**：

- **不开 worktree**：逐 task 是串行累积（task2 依赖 task1 产出），在当前工作区。原生 `isolation: worktree` 每次派发开独立 worktree、看不到前序 task，不适用；这也让分级门禁 `intent-gate.py` 零改动生效。
- **subagent 不能嵌套**：`--no-confirm`（`/opsx-bulk-apply` 子 agent）一律走串行。
- **三处守门同一 agent**：逐 task review（单 task 净 diff）/ full review（累计 diff）/ `/pr-ship`（PR↔target diff），靠 diff 范围区分，互补不重复。
- **`code-reviewer` 物理只读**：工具集仅 Read/Grep/Glob/Bash，从工具层面保证只 review 不改码；prompt 自包含、不带主会话上下文。

详见 `.claude/skills/openspec-subagent-apply-change/SKILL.md` 与 `.claude/agents/code-reviewer.md`。

---

## Git 纪律

| 时机 | 规则 |
| --- | --- |
| propose 前 | 优先在 `main` 上；不在则警告并询问 |
| propose 后 | 提示用户把工件**单独提交为一个 commit**（只含 openspec 工件，不混实现代码）；可选建 PR 分支 |
| apply 前 | **工件必须已单独成一个 commit**（无需先合 `main`）；之后可在 main / 分支 / worktree 实现 |
| archive 前 | **必须从 `main` 运行**；implementation 必须已合回 |
| archive 后 | 提示 commit archive 与 spec sync 改动 |

完整规则见 `.claude/skills/openspec-git-discipline/SKILL.md`。

---

## 端到端示例

```bash
# 在某项目根
cd ~/my-app

# 1. 启动 Claude Code，输入：
/opsx-propose add-user-export

# Claude 会：
#   - openspec new change add-user-export
#   - 生成 proposal.md, specs/user-export/spec.md, design.md, openspec/adr/0042-*.md, tasks.md

# 2. 用户审阅，把工件单独提交为一个 commit（只含 openspec 工件；无需先合 main）
git add openspec
git commit -m "propose: add-user-export"

# 3. 实现
git checkout -b feat/add-user-export
/opsx-apply add-user-export
# step 6 选执行模式：
#   - subagent 逐 task 守门（推荐）：每个 task 派 subagent 实现 + code-reviewer 守门，
#     CRITICAL/HIGH 阻断、回灌修复过才勾 checkbox；末尾 full review + verify
#   - 串行（轻量）：主会话逐条实现，勾选 checkbox

# 4. 实现合回 main 后归档
git checkout main && git pull
/opsx-verify  add-user-export   # 一致性检查
/opsx-archive add-user-export   # 移到 openspec/changes/archive/YYYY-MM-DD-*
```

---

## 任务分级 · 何时必须走工作流，何时可跳过

这套 5 工件流不是对所有改动一刀切。按任务分级决定：**中级+ 必须严格走，mini 才允许跳过**。
源码写入由 PreToolUse 门禁 `.claude/hooks/intent-gate.py` 强制——绕不过去（需 python3）。

| | mini（允许跳过） | 中级+（必须严格工作流） |
| --- | --- | --- |
| 触发 | 文档/注释单改 · 依赖升级 · 配置值调整 · 单文件无行为变化 hotfix · 内部一次性脚本 | 新 capability · 新公共 API/命令 · 改公共契约(签名/返回/错误码/**数据投影·序列化**) · 跨模块 · 引入新抽象/依赖/模式 · 影响数据模型/迁移 · 长期不可逆设计决策 |
| 走法 | 文档/配置类自动放行；源码 mini 先 `/opsx-mini "<理由+范围>"` 留痕 | `/opsx-propose`（或 `/opsx-new`）建五工件 → `/opsx-apply` |

> **判据来源**：本表由 schema README 的 "Good fit / Not a good fit" 与下方旧「何时不用」固化而来，不另造词。

### 门禁怎么放行

`intent-gate.py` 拦 `Write|Edit`，命中任一即放行，否则 DENY 并回灌指引：

1. 项目无 `openspec/` → 放行（非 intent-driven 项目，门禁 no-op）
2. 目标命中豁免名单：文档（`*.md`/`*.rst`/`*.txt`）、`openspec/**`、`.claude/**`、`docs/**`、生成式 lockfile/清单（`*.lock`/`package-lock.json`/`pnpm-lock.yaml`/`go.sum`）。**通用 `*.json`/`*.yaml`/`*.toml`/`*.ini` 不再整类豁免**——它们可能是中级+ 的 CI/k8s/IaC/schema/app 配置改动，受门禁；确属 mini 走 `/opsx-mini`（`openspec/`、`.claude/` 内的配置仍按目录豁免）
3. 存在某个非 archive change 且其 `tasks.md` **仍有未勾选 `- [ ]`**（实现进行中）——全勾选（应归档）或无 checkbox 不再放行，避免「一个没归档的旧 change 永久放行后续所有源码写入」
4. `openspec/.mini-active` 有效（24h 内）且其 `scope` 覆盖该文件

配套提醒 `intent-reminder.py`（UserPromptSubmit）在每个任务开头注入本 rubric。

### ⚠ plan mode 不等于工作流

原生 plan mode 产出的 markdown plan + `ExitPlanMode` 审批，**不满足**中级+ 的工件要求。
approve 一份 plan ≠ 建了 `proposal→specs→design→adr→tasks`。plan 是临时的、不归档、不可追溯；
五工件是持久、可审计、可归档的。**别让「规划过了」的错觉吞掉真正的工作流。**

### 反面教材（真实复盘）

> 「新增 a320 能力 + 动 RawParam 投影」被误判为「加性 non-breaking，可直接做」，于是切进 plan mode、
> approve 一份 markdown plan 后直接 TDD 实现，5 工件一个没建。
> 实则它同时命中两条中级+ 触发器——**新 capability + 改数据投影契约**——本该 `/opsx-propose`，
> 由 design 阶段把投影的架构决策摆出来给人审，而不是在代码里默默定掉。

### 何时整套都不用

- 纯文档单改、依赖升级、临时 hotfix：太重，commit message 就够（= mini，走 `/opsx-mini` 或直接改豁免路径）
- 行为驱动但不涉及架构决策：考虑用 `behaviour-driven` schema 替代
- 内部脚本 / 玩具项目：YAGNI

参考：[schema 仓库](https://github.com/intent-driven-dev/openspec-schemas) 还提供 `spec-driven`、`behaviour-driven` 等更轻量 schema。
