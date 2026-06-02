# intent-driven-claude-code

> 把 [intent-driven OpenSpec 工作流](https://intent-driven.dev/) 适配到 Claude Code，并叠加 TDD 实现纪律、PR 自审闭环、CLAUDE.md 知识同步/蒸馏三层增强。

```
proposal → specs → design → adr → tasks   ┐
                                          │  规划阶段（不写代码）
                                          ▼
                                    /opsx-apply
                                          │  实现阶段（TDD 红绿重构 + GWT 注释）
                                          ▼
                                   /claudemd-sync
                                          │  增量沉淀本轮知识到 CLAUDE.md
                                          ▼
                                       /pr-ship
                                          │  端到端送出 + 干净 subagent 自审
                                          ▼
                                  /opsx-verify
                                          │  三维一致性 + TDD/BDD 纪律检查
                                          ▼
                                  /opsx-archive
                                          │  归档（要求已合 main）
                                          ▼
                              （累积几轮后） /claudemd-distill
                                          ▼  彻底压缩所有 CLAUDE.md
```

---

## 设计哲学

**Intent-driven = 先把意图想清楚再动代码**。每个变更先用 5 个 markdown artifact 把「为什么 / 做什么 / 怎么做 / 不可逆决策 / 实现步骤」沉淀下来，然后才进入实现循环。所有 artifact 都是带版本的纯 Markdown，与 git 协作天然契合。

上游 [intent-driven-template](https://github.com/intent-driven-dev/intent-driven-template) 是为 OpenCode 设计的，本仓库做了三件事：

1. **把命令、技能、schema 适配到 Claude Code**（`.claude/commands/` 与 `.claude/skills/`）+ 一键 `install.sh`
2. **把 [obra/superpowers](https://github.com/obra/superpowers) 的 TDD skill 中文化移植进来**，并叠加 BDD Given/When/Then 单测注释规范——见 `.claude/skills/test-driven-development/`
3. **新增三个命令补齐变更全周期**：`/pr-ship`（送出 + 自审）/ `/claudemd-sync`（沉淀）/ `/claudemd-distill`（蒸馏）

---

## 前置依赖

| 工具 | 版本 | 安装 |
| --- | --- | --- |
| [Claude Code](https://claude.com/claude-code) | 最新即可 | 官方 CLI / Desktop / Web / IDE 任一即可 |
| Node.js | ≥ 18 | nvm / fnm / volta / brew |
| OpenSpec CLI | ≥ 1.3 | `npm install -g @fission-ai/openspec`（或 pnpm / bun add 全局） |
| [`gh`](https://cli.github.com/) 或 [`glab`](https://gitlab.com/gitlab-org/cli) | 最新 | `/pr-ship` 命令需要，按你的远端平台二选一 |

可选：[Superpowers](https://github.com/obra/superpowers) 已被自动 reuse（若你 `~/.claude` 装过）。

---

## 一键安装

### 方式 A：克隆后运行（推荐 — 可审计）

```bash
git clone https://github.com/akarizo/intent-driven-claude-code.git /tmp/idt
/tmp/idt/install.sh ~/path/to/your-project
```

### 方式 B：curl 一行（极简）

```bash
curl -fsSL https://raw.githubusercontent.com/akarizo/intent-driven-claude-code/main/install.sh \
  | bash -s -- ~/path/to/your-project
```

> Fork 后把 `akarizo` 替换成你的 GitHub 用户名；也可以通过 `IDT_REPO_URL` 环境变量覆盖。

`TARGET_DIR` 缺省 `pwd`，所以也可以：

```bash
cd ~/your-project
curl -fsSL https://raw.githubusercontent.com/akarizo/intent-driven-claude-code/main/install.sh | bash
```

安装器**幂等**：重复运行已存在的文件全部 `[skip]`，CLAUDE.md 通过 `<!-- intent-driven:begin -->` marker 跳过追加。**默认模式只增不改，绝不覆盖你的文件。**

### 一键更新（已装项目）

默认安装是「只增不改」，**重复跑 `install.sh` 不会更新已装的 skill / 命令 / schema**。库演进后给老项目推更新，加 `--upgrade` 即可（三种形态任选其一）：

```bash
# 方式 A：克隆后运行（推荐 — 可审计）
git clone https://github.com/akarizo/intent-driven-claude-code.git /tmp/idt
/tmp/idt/install.sh --upgrade ~/path/to/your-project

# 方式 B：curl 一行
curl -fsSL https://raw.githubusercontent.com/akarizo/intent-driven-claude-code/main/install.sh \
  | bash -s -- --upgrade ~/path/to/your-project

# 方式 C：进到项目目录里就地更新（TARGET 缺省 pwd）
cd ~/your-project
curl -fsSL https://raw.githubusercontent.com/akarizo/intent-driven-claude-code/main/install.sh | bash -s -- --upgrade
```

`--upgrade` 的边界很清楚：

- **刷新（库自有）**：`.claude/commands/`、`.claude/skills/`、`openspec/schemas/`，并刷新 CLAUDE.md 的 `intent-driven` marker 段。
- **保留（用户数据）**：`openspec/changes`、`openspec/specs`、`openspec/adr/*.md`、`openspec/superpower`、`openspec/config.yaml`、ADR 风格 `preferences.md`、以及 CLAUDE.md marker 段以外的正文。
- **一次性迁移**：把旧版散落在项目根的 `adr/*.md` 自动搬进 `openspec/adr/` 并删空根 `adr/`（同名冲突会跳过并提示人工核对）。

> `--upgrade` 会覆盖 `.claude/` 下的库文件，所以**别在 `.claude/skills/` 里直接改库代码**——你的个性化应放在项目自己的文件里。

---

## 它装了什么

安装到目标项目根的内容：

```
your-project/
├── .claude/
│   ├── commands/       # 13 个 slash 命令（见下方）
│   ├── skills/         # 16 个 skill（见下方）
│   └── claudemd-standard.md   # CLAUDE.md 层级规范（sync/distill 硬约束基线）
├── openspec/
│   ├── config.yaml     # schema: intent-driven + 4 条 rules
│   ├── schemas/intent-driven/   # 离线 schema 副本
│   ├── adr/.gitkeep    # ADR 落地点（openspec/adr/NNNN-*.md，不可改 / supersede）
│   └── superpower/.gitkeep      # 探索 / 头脑风暴设计稿落点
└── CLAUDE.md           # 追加一段「Intent-Driven 工作流」中文 snippet
                         # （已存在则用 marker 块幂等追加；不存在则新建）
```

不写：`~/.claude`、系统配置、settings。所有改动严格限定在目标项目根。

---

## 完整工作流（变更全周期）

一个典型变更从想法到归档要经过 7 个阶段，每个阶段对应至少一个 slash 命令：

### 阶段 1 · 规划（写 markdown，不写代码）

5-artifact 链：`proposal → specs → design → adr → tasks`

| 阶段 | 关注点 | 推荐命令 |
| --- | --- | --- |
| proposal | _为什么_ 要做这次变更（背景 / 价值 / 范围） | `/opsx-new` 或 `/opsx-propose` |
| specs | _做什么_（Gherkin 接受标准 + 行为契约） | `/opsx-continue`（gherkin-authoring skill 接管） |
| design | _怎么做_（结构 / 数据流 / 关键算法 / 备选方案） | `/opsx-continue` |
| adr | 不可逆架构决策 → 写进 `openspec/adr/NNNN-*.md` 后**不可改**，需变更则 supersede | `/opsx-continue`（architectural-decision-records skill 接管） |
| tasks | 按怎样的步骤实现（checkbox 列表） | `/opsx-continue` |

不想分阶段思考？`/opsx-propose <name>` 一次性把 5 个 artifact 全生成出来。

**意图审批面板**：propose / continue 每完成一个工件后会自动重渲 `openspec/changes/<change>/spec.html` —— 单文件含 Mermaid 与必要原型，双击浏览器一屏审批意图。手动重渲：`/spec-html <change>`。

### 阶段 2 · 实现（开始动代码）

`/opsx-apply <name>` 按 tasks 顺序执行，**每个会写代码的 task 都强制走 TDD/BDD 循环**：

```
RED → 验证 RED → GREEN → 验证 GREEN → REFACTOR
```

具体硬约束（详见 `.claude/skills/test-driven-development/SKILL.md`）：

- **铁律**：没有先失败过的测试，就没有生产代码
- **GWT 注释先于代码**：测试函数体首行是 `// Given:`（Python 用 `#`）、`When:`、`Then:` 三段中文注释，之后才是 setup / mock / 被测调用 / 断言
- 一个测试只触发一个被测动作（When 块单一）
- 反模式（mock 滥用、生产类塞测试方法、不懂依赖就 mock、不完整 mock、测试事后补救）在 `testing-anti-patterns.md` 列出

### 阶段 3 · 知识沉淀（PR 前）

`/claudemd-sync` 把本轮变更的差异**增量**沉淀到 CLAUDE.md（**不压缩**）：

- 应追加的新约定 / skill / convention
- 应废弃的旧条目
- 本轮发现的「最佳工程实现偏差」（AI 观察到、本轮没修的问题）
- 待沉淀的隐性知识（口头给过但未落地的反馈）

monorepo 时按目录就近原则归位到对应 sub-repo 的 CLAUDE.md。

### 阶段 4 · 送出 + 自审（PR/MR 闭环）

`/pr-ship` 端到端 12 步：

```
预检 gh/glab → 梳理变更 → 必要时 commit → 预合并冲突检查
  → push → 起 PR/MR 标题正文 → 创建 PR/MR
  → 起【干净的】code-reviewer subagent 评审 diff
  → review markdown 作为评论入库（签名必带）
  → 与用户逐条讨论修复 → 落地补丁到同 PR → 询问是否再走一轮
```

关键设计：
- subagent **不带主会话上下文**，避免「我审我自己」的 confirmation bias
- 不代用户 `gh/glab auth login`、不代用户 merge —— 高风险动作只输出命令给用户在终端跑
- 评论必带签名 `— reviewed by Claude Code (code-reviewer subagent), <date>`，避免 PR 阅读者误以为是人类 reviewer

### 阶段 5 · 验收（合并前）

`/opsx-verify <name>` 做三维一致性检查 + TDD/BDD 纪律检查：

| 维度 | 检查 |
| --- | --- |
| Completeness | tasks checkbox 全勾 / 每个 requirement 都有实现 |
| Correctness | requirement → 代码映射 / scenario 覆盖 |
| **Test Discipline (TDD/BDD)** | 测试函数体首行 GWT 注释 / When 单一动作 / Then 与断言数对齐 / 不触犯 5 反模式 |
| Coherence | design 决策被遵循 / 代码风格一致 |

违反 TDD 纪律记 **CRITICAL**，阻止归档。

### 阶段 6 · 归档

`/opsx-archive <name>` 把变更标记为已完成。前置：**implementation 必须已合回 main**（git 纪律由 openspec-git-discipline skill 守护）。

### 阶段 7 · 知识收敛（累积几轮后）

`/claudemd-distill` 对所有 CLAUDE.md 做彻底压缩 = 蒸馏：

- 🟥 **必留**：硬约束、领域知识、隐性知识
- 🟧 **指针化**：已落到 skill/ADR/spec 的，留摘要 + 指针，删展开
- 🟨 **合并**：相似条目 → 表格行 / 一句话
- 🟦 **删除**：过时 / 已自解释 / 噪音

**永不删除**：snippet 注入段、git 纪律、ADR 不可改、TDD/GWT 等硬约束。**永不破坏** `<!-- intent-driven:begin --> ... :end -->` marker。

---

## 13 个 slash 命令

按命名空间分组。

### `/opsx-*`（OpenSpec 工作流，9 个）

| 命令 | 一句话 |
| --- | --- |
| `/opsx-new <name>` | 创建变更，停在第一个 artifact 模板等用户确认 |
| `/opsx-propose <name>` | 一次性生成 apply 所需的全部 artifacts，**自动渲染 spec.html** |
| `/opsx-continue [name]` | 推进下一个 artifact，**自动刷新 spec.html** |
| `/opsx-explore [topic]` | 探索模式：只思考、不实现 |
| `/opsx-apply [name]` | 按 tasks 执行实现（强制 TDD/BDD 入口） |
| `/opsx-verify [name]` | 三维一致性 + TDD/BDD 纪律检查 |
| `/opsx-archive [name]` | 归档已完成变更（要求 implementation 已合回 main） |
| `/opsx-sync [name]` | delta specs 合入主 specs |
| `/opsx-bulk-apply` | 多变更并行 worktree 实现 |

### `/claudemd-*`（CLAUDE.md 知识维护，2 个）

| 命令 | 时机 | 模式 |
| --- | --- | --- |
| `/claudemd-sync` | 每轮变更结束 / PR 前 | 增量、全覆盖、不压缩、逐条与用户讨论 |
| `/claudemd-distill` | 合并到 main 后 / 累积几轮 sync | 全量、彻底压缩、保留必要、逐文件确认 |

两者周期性配合，**不在同一轮一起跑**（sync 扩张，distill 收敛）。

### `/pr-*`（PR/MR 闭环，1 个）

| 命令 | 目的 |
| --- | --- |
| `/pr-ship [target-branch]` | 端到端送出本次变更：commit → push → 创建 PR/MR → 干净 subagent 自审 → 评论入库 → 迭代修复 |

### `/spec-*`（意图可视化，1 个）

| 命令 | 目的 |
| --- | --- |
| `/spec-html [name]` | 手动重渲 `openspec/changes/<name>/spec.html` 意图审批面板（propose / continue 已自动跑） |

---

## 16 个 skill

按主题分组。详细规范见各自 `SKILL.md`。

### OpenSpec 工作流（9 个）

每个 `/opsx-*` 命令背后都有一个同名 skill 承载执行逻辑。

| Skill | 对应命令 |
| --- | --- |
| `openspec-propose` | `/opsx-propose` |
| `openspec-new-change` | `/opsx-new` |
| `openspec-continue-change` | `/opsx-continue` |
| `openspec-explore` | `/opsx-explore` |
| `openspec-apply-change` | `/opsx-apply`（含 TDD/BDD 强制入口） |
| `openspec-verify-change` | `/opsx-verify`（含 Test Discipline Check） |
| `openspec-archive-change` | `/opsx-archive` |
| `openspec-sync-specs` | `/opsx-sync` |
| `openspec-bulk-apply-change` | `/opsx-bulk-apply` |

### 规格 / 文档（4 个）

| Skill | 目的 |
| --- | --- |
| `architectural-decision-records` | ADR 起草、评审、supersede 流程 |
| `c4-diagrams` | C4 架构图 ASCII / Mermaid 编写 |
| `gherkin-authoring` | `.feature` 与 BDD 接受标准（**规格层** BDD，与单测层 GWT 注释互补） |
| `spec-html-render` | 把 OpenSpec change 工件渲染为单文件 HTML 审批面板（Swiss/Editorial 风格 + Mermaid + 按需原型） |

### 实现纪律（2 个）

| Skill | 目的 |
| --- | --- |
| `test-driven-development` | TDD 红绿重构 + **Given/When/Then 单测注释 6 条强约束** + 反例/正例，配套 `testing-anti-patterns.md` 5 个反模式 + gate functions |
| `openspec-git-discipline` | propose → apply 与 apply → archive 都必须先合入 main；不代用户 commit/branch/merge |

### 协作工具（1 个）

| Skill | 目的 |
| --- | --- |
| `grill-me` | 「拷问式」交流：用户希望被反问、质疑、压力测试方案时使用（来源 [mattpocock/skills](https://github.com/mattpocock/skills)） |

---

## CLAUDE.md.snippet（常驻硬约束）

`install.sh` 注入到目标项目 CLAUDE.md 的常驻约束（用 marker 包裹幂等追加；`--upgrade` 时整段刷新）：

1. 5-artifact 链与 ADR 不可改（ADR 入 `openspec/adr/`）
2. `/opsx-*` 命令前缀；apply / bulk-apply 开始前会停下确认
3. Git：propose → apply 与 apply → archive 必须先合入 main；不代你 commit/branch/merge
4. Schema 来源
5. **TDD 铁律**：写实现前先写失败测试；红→验红→绿→验绿→重构
6. **单测先写 GWT 三段中文注释**，再写代码
7. **HTML 审批面板**：propose / continue 后自动出 `spec.html`（Mermaid + 按需原型）；手动 `/spec-html`
8. **落点收敛**：ADR 入 `openspec/adr/`，探索 / 头脑风暴设计稿入 `openspec/superpower/`，项目根仅 `.claude/` + `openspec/` + `CLAUDE.md`
9. **CLAUDE.md 层级规范**：放置铁律（LCA）/ 头部三件套 / 固定段目录 / 指针优先 / 排版密集 —— 全文见 `.claude/claudemd-standard.md`（`/claudemd-sync`·`/claudemd-distill` 的硬约束基线）

每行都是 load-bearing；不写解释、不展开——展开内容沉到对应 skill 或 `.claude/claudemd-standard.md`。

---

## 快速试用

```bash
cd ~/path/to/your-project

# 启动 Claude Code（CLI 或 Desktop）然后输入：
/opsx-propose add-hello-world
```

Claude 会：
1. 调用 `openspec new change add-hello-world` 创建变更骨架
2. 依次生成 `proposal.md` → `specs/.../spec.md` → `design.md` → `openspec/adr/NNNN-*.md` → `tasks.md`
3. 提示运行 `/opsx-apply` 进入实现阶段（届时 TDD/BDD 入口生效）

CLI 验证：

```bash
openspec list
openspec status  --change add-hello-world
openspec schema validate intent-driven
```

---

## 与上游的差异

| 项 | 上游（OpenCode） | 本仓库（Claude Code） |
| --- | --- | --- |
| 命令位置 | `.opencode/commands/` | `.claude/commands/` |
| 技能位置 | `.opencode/skills/` + `.agents/skills/` | `.claude/skills/`（合并后） |
| 插件机制 | `opencode.json` 声明 superpowers | 不需要：Claude Code 用户自行装 [Superpowers](https://github.com/obra/superpowers) |
| TDD 纪律 | 无 | 中文化移植 superpowers test-driven-development + 叠加 GWT 单测注释规范 |
| PR 闭环 | 无 | `/pr-ship` 端到端送出 + 干净 subagent 自审 |
| 知识维护 | 无 | `/claudemd-sync` ↔ `/claudemd-distill` 周期性配合 |
| 安装方式 | 手动复制目录 | `install.sh` 一键：幂等安装 + `--upgrade` 升级（库文件刷新、用户数据不动） |
| 中文文档 | 无 | README + CLAUDE.md snippet + 所有新增 skill / 命令全中文 |

OpenSpec 上游命令、技能和 schema **内容字节级一致**，仅迁移路径与添加安装器。本仓库新增的 TDD / PR / CLAUDE.md 三类增强独立成文件，不污染上游内容。

---

## 致谢

- [intent-driven-dev/intent-driven-template](https://github.com/intent-driven-dev/intent-driven-template) —— 上游模板与工作流设计
- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) —— OpenSpec CLI 与 schema 引擎
- [obra/superpowers](https://github.com/obra/superpowers) —— brainstorming / planning / **test-driven-development** 等技能集，本仓库的 TDD skill 是其中文化移植
- [mattpocock/skills](https://github.com/mattpocock/skills) —— `grill-me` 风格来源

---

## License

MIT。详见 [LICENSE](LICENSE)。
