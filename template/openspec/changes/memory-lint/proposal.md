## Why

`~/.claude/projects/<slug>/memory/` 是一个**常驻上下文载体**，却是当前唯一没有任何机械门禁的那个。`CLAUDE.md` 有 `claudemd-lint`（字节 / 行长 / 悬空指针 / `@` 误用），memory 层完全裸奔。

这不是理论风险。2026-08-28 对本机 21 个有 memory 的项目做了实测：

| 指标 | 实测值 |
|---|---|
| 项目规模分布 | `amc-afa` **24094 B 常驻索引 / 221 实体文件**；第二名 1738 B / 10 files；其余全部 < 1 KB |
| 索引行长度（n=218，含二级索引） | p50=147 · p75=194 · p90=335 · p95=400 · p99=511 · **max=882** |
| 一致性缺陷 | `amc-afa` 抓到 **1 处悬空指针 + 1 个孤儿文件 + 1 处状态漂移** |

> 上表的行长分布是**实现后用 lint 自身口径复测**的值。立项调研时的统计漏掉了「文字在前、指针在后」的索引行，得出的 `n=209 / max=552` 偏低——见 `design.md` 的口径修正注。

那处缺陷的形态很有代表性：change 从 propose 推进到 apply 后，memory 文件被重写并改名 `model-trial-compute-propose-status.md` → `-applied-status.md`，**但 `MEMORY.md` 的索引行没跟着改**。后果是三重的：

1. **悬空指针** —— 索引指向已不存在的文件，recall 时点不开
2. **孤儿文件** —— 新文件不在任何索引里
3. **状态失真** —— 索引行仍写「已 propose 未 apply」，实际是「已 apply 40/40 并预合并 origin/main，待开 MR」；更糟的是索引行还在展示 propose 期已作废的警告（`A1–A12 全勾`、`示例 JSON 已交付`），而 apply 后真正要盯的四条（DRAFT ADR 待定号 · 发版前两项人工确认 · 三缺陷共同点 · 现网 qarpc `missing field 'uuid'`）一条都没有。

**三个后果里，第三个最危险**：前两个只是「召不回」，第三个是**主动提供了错误的常驻信息**。索引是每会话必付的，失真的索引比没有索引更坏。

**为什么人眼守不住**：`amc-afa` 是 106 条一级索引 + 56 条二级索引，跨 217 个实体文件。交叉核对是纯机械工作，且 memory 由 agent 在会话中自动写入——写入时机分散在几十个会话里，没有任何一处能看到全局。

**为什么不能用 CLAUDE.md 取代 memory**（这是设计前提，已单独论证）：两者的加载条件不同——CLAUDE.md 全量常驻，memory 是**索引常驻 + 正文按需 recall**。`amc-afa` 的 1.1 MB 正文正是靠这个机制才没有每会话全付。取消 memory 等于把按需变全量。

**由此暴露 spec 的一处真缺口**：`claudemd-standard.md §12b` 的分流表列了四个载体（CLAUDE.md / `.claude/rules/*.md` + `paths:` / Skill / 测试·lint·hook），**memory 完全缺席**。它是第五种加载条件，且是四者之外唯一「部分常驻、部分按需」的混合体。缺了它，「这条事实该写哪」这个问题在 spec 层面无法回答。

## What Changes

引入 **memory 索引完整性契约**：索引与实体文件之间的映射必须双向闭合，且索引所述状态必须与正文一致。一条原则——**索引是常驻的，所以索引的每一个字节都必须为真**。

- **`§12b` 补第五载体 `memory/`**：给出加载条件（索引常驻 / 正文按需 recall）、装什么、常驻成本，以及与 CLAUDE.md 的分界判据——「不知道它会**做错事** → CLAUDE.md（约束）；不知道它只是**多花时间** → memory（发现）」。同时明确 memory 的准入门槛不为零：每写一条就给所有会话永久加一行索引，**未来 10 次会话用不到 1 次的，不该进 memory**。
- **`§12` 预算表补 memory 两档**：索引常驻预算（提醒 28 KB）与索引单行（提醒 > 400 B · 拦截 > 700 B）。阈值取自上述实测分布：400 B 恰在 p95（10 条超线），700 B 实测触发 1 条（882 B，确实该拦）。**总量只算一级索引 `MEMORY.md`，二级索引按需 recall 不计入**——否则会惩罚「下沉」这个正确行为。**刻意比 CLAUDE.md 的 200/400 宽**——索引行承担「坑位前置警告」职能（`❗❗MUST 走 pypi:conda matplotlib 拉 numpy 2.5.2 撞 af-abc 的 pin 直接拒解`），压到 CLAUDE.md 的行长等于摘掉防护。
- **新增 `hooks/memory-lint.py`，四道机械闸**：
  - **悬空指针**（索引 → 不存在的文件）：拦截
  - **孤儿文件**（实体文件未被任何索引登记）：拦截
  - **状态漂移**（索引行的状态词与正文 frontmatter `description` 矛盾）：提醒
  - **行长 / 常驻预算超线**：分档提醒与拦截
- **二级索引递归解析**：`MEMORY.md` 可声明二级索引（`amc-afa` 已实践：`index-shipped-changes.md` / `index-dlib-parser-facts.md`，把已完结条目下沉、不占常驻）。lint **必须**沿着这层递归，否则会把 56 条已登记条目误报为孤儿——这正是本 change 立项过程中犯过的错，写进 spec 防止实现方重蹈。
- **触发点**：`PostToolUse(Write|Edit)` 且目标落在 memory 目录内 → 只查该文件的登记状态（增量、快）；CLI `--all` 走全量。
- **项目定位靠运行时推导**：memory 目录不在仓库内，路径为 `~/.claude/projects/<cwd 绝对路径把 / 换成 ->/memory/`。该规则已正向实测验证（139 个项目目录、两例逐字符比对）。**禁止硬编码**——模板要服务任意用户的任意项目。

## Capabilities

### New Capabilities

- `memory-index-integrity`: 规约 memory 索引层与实体文件之间的完整性契约——索引与文件的双向映射闭合、二级索引的递归展开、索引所述状态与正文的一致性、以及常驻索引的字节预算。它回答「索引说的还算不算数」，不规约「哪条知识值得记」（后者属 `claudemd-standard §12b` 的分流判据）。

### Modified Capabilities

<!-- 无。memory 层此前无任何 spec 覆盖，本 change 引入的是全新契约层。 -->

## Impact

- **新增**：`template/.claude/hooks/memory-lint.py`
- **spec（1）**：`template/.claude/claudemd-standard.md` —— `§12` 预算表补 memory 两档、`§12b` 分流表补第五载体、`§13` 合约表补 `memory-lint` 一行
- **hook 配置（1）**：`template/.claude/hooks/hooks.json` —— `PostToolUse` 增挂 `memory-lint.py --hook`
- **snippet（1）**：`template/CLAUDE.md.snippet` —— 记忆分流段补一行 memory 指针（当前 4216 B / 4608 B，余 392 B，够）
- **文档（2）**：`README.md`、`docs/WORKFLOW_zh.md`
- **不影响**：`claudemd-lint.py` 的任何现有判据与阈值、`intent-gate.py` 门禁、openspec schema、任何业务逻辑。memory-lint 与 claudemd-lint 是两个独立脚本，互不 import。
- **向后兼容**：无 memory 目录的项目 lint 直接静默退出（21 个项目中 5 个 memory 为空、118 个无 memory 目录）。
- **依赖**：无新增依赖，仅标准库（`pathlib` / `re` / `json` / `sys`）。
