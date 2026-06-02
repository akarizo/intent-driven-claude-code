---
description: 把本轮变更增量同步到 CLAUDE.md（全覆盖、不压缩、与用户讨论）
---

把本轮（当前分支相对于 main / 当前 session）的变更**增量**同步到 CLAUDE.md。**全覆盖，不压缩**——压缩留给 `/claudemd-distill` 处理。

**Input**: 可选指定参考分支（默认 `origin/main`）。例如 `/claudemd-sync origin/release-v2`。

**Steps**

1. **确定本轮变更范围**

   并行跑：
   ```bash
   git status --short
   git diff --stat <base-ref>...HEAD
   git log --oneline <base-ref>...HEAD
   ```
   其中 `<base-ref>` 默认 `origin/main`，或用户传入的参考分支。

   汇总变更文件清单，并按目录归类。

2. **检测 monorepo 与 CLAUDE.md 分布**

   ```bash
   find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null
   ```

   - **单仓**：只有根 `CLAUDE.md`（或还没有）→ 后续所有变更都归到这一个文件
   - **monorepo**：多个 CLAUDE.md（如 `apps/web/CLAUDE.md`、`packages/core/CLAUDE.md`）→ 每个变更文件按**就近原则**归到上溯最近的 CLAUDE.md

   报告分布情况后再继续。

3. **读取所有 CLAUDE.md 现状 + 规范基线**

   并行 Read 第 2 步发现的每个 CLAUDE.md，建立"现有约定清单"心智模型；同时读 `.claude/claudemd-standard.md`（如存在）作为放置（§2 LCA）与分段（§5 段目录）的权威基线。

4. **生成差异候选清单**（这是核心动作，要全面，不要漏）

   对照本轮变更与现有 CLAUDE.md 内容，分四类列出候选：

   - **A. 应追加的新知识**（本轮新增了 skill / command / convention / 决策 / 工具 / 依赖 / 命名风格 / 目录结构）
   - **B. 应废弃的旧条目**（本轮删了某文件 / 改了流程 / 新规则代替了旧规则）
   - **C. 本轮发现的"不符合最佳工程实现"的地方**——AI 在本轮工作中观察到、但本轮**没修**的偏差（如：发现某个常用脚本没纳入约束、某个反模式实际上还在用、某层抽象缺失、某项决策没沉淀为 ADR）
   - **D. 待沉淀的隐性知识**（本轮 session 里用户口头给过反馈但未落地到 CLAUDE.md 的规则、约定、偏好）

   每条候选必须含：
   - **目标 CLAUDE.md 文件路径**
   - **动作**：追加 / 删除 / 修改
   - **具体内容**（追加的原文、要删的原文、修改的 before/after）
   - **理由**（一句话，引用本轮哪个变更 / 观察）

5. **逐类与用户讨论**

   用 **AskUserQuestion 工具**逐类（A/B/C/D）展示候选清单，对每条让用户选：
   - `接受` — 进入待写入队列
   - `调整后接受` — 用户提供修改后的文案，再进入队列
   - `推迟到 /claudemd-distill 处理` — 标记 skip 但记录在最终报告里
   - `拒绝` — 完全丢弃

   **关键**：不要把所有候选打包成一个问题让用户回答 yes/no——逐条或按小组让用户判断。条目多时按相关性分组（同一文件 / 同一主题）一组一组问。

6. **批量写入用户接受的条目**

   按文件分组应用：
   - 追加项 → 按 `.claude/claudemd-standard.md` §2 LCA 选定文件、§5 段目录定位到对应固定槽段（无该段则按段目录顺序新建）；领域知识落自由扩展区
   - 删除项 → 用 Edit 工具按原文精确删除
   - 修改项 → 用 Edit 工具改文案

   **不要压缩**：每条独立成行，宁可冗余也要完整。压缩留给 `/claudemd-distill`。

7. **生成同步报告**

   ```
   ## CLAUDE.md 同步报告

   **base**: <base-ref>  **commits 数**: N  **变更文件数**: M

   ### 各 CLAUDE.md 改动汇总
   | 文件 | 追加 | 删除 | 修改 | 推迟 |
   | --- | --- | --- | --- | --- |
   | ./CLAUDE.md | 3 | 1 | 0 | 2 |
   | apps/web/CLAUDE.md | 1 | 0 | 0 | 0 |

   ### 推迟项（留给 /claudemd-distill 或下一轮 /claudemd-sync）
   - <条目 1>
   - <条目 2>

   ### 被拒绝项（本次最终不入库）
   - <条目 1> — 拒绝理由：<用户原话>
   ```

**Output During Discussion**

```
## CLAUDE.md 同步候选（共 N 条）

### A. 应追加的新知识（X 条）
1. [./CLAUDE.md] 追加："本仓库 TDD 强制使用 GWT 注释 ..." — 来源：本轮新增 .claude/skills/test-driven-development/
2. ...

### B. 应废弃的旧条目（Y 条）
...

### C. 本轮发现的最佳工程实现偏差（Z 条）
...

### D. 待沉淀的隐性知识（W 条）
...

逐条向你确认 →
```

**Guardrails**

- 不要主动压缩、不要合并相似条目——这是 `/claudemd-distill` 的职责
- 每条候选必须可被用户独立 accept/reject，不要打包
- monorepo 时按目录就近原则归位，绝不把 sub-repo 的事写进根 CLAUDE.md
- C 类（最佳工程实现偏差）发现的问题，**只罗列建议，不主动修代码**——本命令只动 CLAUDE.md
- 如果用户在 C/D 类提供了新约束，立刻把它转写到 CLAUDE.md，不要让它再次成为隐性知识
- 写入前展示 Edit/Write 的精确 old_string/new_string 或追加位置，让用户能预审

**与 `/claudemd-distill` 的分工**

| Command | 时机 | 模式 | 体量倾向 |
| --- | --- | --- | --- |
| `/claudemd-sync`（本命令） | 每轮变更结束 / PR 前 | 增量、全覆盖、不压缩 | 文件会变长 |
| `/claudemd-distill` | 合并到 main 后 / 累积多轮后 | 全量、彻底压缩、保留必要 | 文件会变短 |

两者不要在同一轮里一起跑——先用 sync 把知识全量沉淀，等沉淀几轮后再用 distill 收敛。
