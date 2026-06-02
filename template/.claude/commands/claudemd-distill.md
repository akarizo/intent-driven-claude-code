---
description: 对所有 CLAUDE.md 做彻底压缩（保留必要、删除冗余、指针化已沉淀知识）
---

对所有 CLAUDE.md 做**彻底压缩**：合并几轮 `/claudemd-sync` 沉淀下来的条目，在保留必要硬约束的基础上，把冗余、可由代码自解释、已落到其他文件（skill / ADR / 规格）的条目蒸馏掉。

**通常在合并到 main 后使用**——`/claudemd-sync` 负责把每轮变更全量沉淀到 CLAUDE.md（文件会变长），本命令负责定期收敛。

**Input**: 可选指定单个 CLAUDE.md 路径。例如 `/claudemd-distill apps/web/CLAUDE.md`。默认处理所有 CLAUDE.md。

**Steps**

1. **发现所有 CLAUDE.md**

   ```bash
   find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null
   ```

   报告分布：
   - **单仓**：只有根 `CLAUDE.md` → 仅处理这一个
   - **monorepo**：多个 CLAUDE.md → 逐个处理，每个的压缩方案独立提案与确认

2. **读取全部 CLAUDE.md 与关键参考**

   并行读取：
   - 所有 CLAUDE.md
   - `.claude/claudemd-standard.md`（CLAUDE.md 层级规范的硬约束基线：段目录 / 骨架 / 排除清单 / 尺寸预算的权威）
   - `.claude/skills/` 与 `.claude/commands/` 清单（用于判断哪些 CLAUDE.md 条目已被 skill/command 承载）
   - `openspec/`（含 `adr/`、`superpower/`）目录清单（用于判断哪些条目已被规格或决策记录承载）

3. **逐文件分析压缩点**

   对每个 CLAUDE.md，按下列优先级标记每个段落 / 条目：

   - **🟥 必留**（硬约束、不可替代）：
     - 全局开发原则（如"代码 80% 测试覆盖"、"PR 必经 main"）
     - 项目特有的领域知识 / 业务约束
     - 不在 skill/ADR/spec 里的隐性知识
   - **🟧 可指针化**（信息已存在于 skill/ADR/spec，CLAUDE.md 留指针即可）：
     - 详细工作流（→ skill）
     - 架构决策（→ ADR）
     - 业务规格细节（→ spec）
     - **保留方式**：保留一句话摘要 + 指针路径，删展开正文
   - **🟨 可合并**（多条相似 / 重复的条目）：
     - 同主题多 bullet → 合并为一句话或表格行
     - 长段自然语言 → 浓缩为 bullet
   - **🟦 可删**（已过时 / 已自解释 / 噪音）：
     - 引用已删除文件 / 已废弃流程的条目
     - 命名良好的标识符已自解释的解释性段落
     - 调试日志 / 临时笔记 / 任务摘要

4. **生成压缩提案（每个 CLAUDE.md 一份）**

   对每个文件输出：

   ```
   ### <CLAUDE.md 路径> — 压缩提案

   **当前**: <X> 行 / <Y> 字符
   **目标**: <X'> 行 / <Y'> 字符（节省约 <Z>%）

   **必留**（<N> 条，原样保留）:
   - <条目摘要>
   - ...

   **指针化**（<N> 条，删展开留指针）:
   - "<原条目首句>..." → 替换为 "详见 <pointer>"
   - ...

   **合并**（<N> 组）:
   - 原：3 行 bullet → 后：1 行表格
   - ...

   **删除**（<N> 条，理由：<已落到 skill / 已删文件 / 已自解释>）:
   - "<原条目首句>..."
   - ...
   ```

5. **逐文件让用户确认压缩方案**

   用 **AskUserQuestion 工具**对每个 CLAUDE.md 单独问：
   - `全部接受` — 按提案应用
   - `挑选接受` — 用户逐条选择（特别针对"必留 → 删除"或"展开 → 指针化"这种边界条目）
   - `跳过此文件` — 不动
   - `取消` — 终止整个 distill 流程

   **monorepo 多文件**：每个文件独立确认，不打包成"一刀切"。

6. **应用压缩**

   对用户接受的方案：
   - 用 Write 工具**重写**目标 CLAUDE.md（多数情况下整文件重排比逐条 Edit 更安全）
   - 不要破坏既有 marker（如 `<!-- intent-driven:begin --> ... <!-- intent-driven:end -->` 等 install.sh 注入段的 marker，必须原样保留）
   - 不要触碰未被讨论过的章节

7. **生成压缩报告**

   ```
   ## CLAUDE.md 蒸馏报告

   | 文件 | 行数 (前→后) | 字符数 (前→后) | 节省 | 状态 |
   | --- | --- | --- | --- | --- |
   | ./CLAUDE.md | 180 → 64 | 8,420 → 2,950 | 65% | 已应用 |
   | apps/web/CLAUDE.md | 50 → 50 | 1,800 → 1,800 | 0% | 跳过（用户决定） |
   | packages/core/CLAUDE.md | 90 → 32 | 4,100 → 1,400 | 66% | 已应用 |

   ### 指针化条目
   - ./CLAUDE.md: "TDD 工作流详述" → "详见 .claude/skills/test-driven-development/"
   - ...

   ### 删除条目
   - ./CLAUDE.md: "OpenSpec 命令完整列表" — 理由：已自解释（命令名即文档）
   - ...

   ### 边界争议项（用户最终决定）
   - <条目>：保留 / 删除 / 改写为<...>
   ```

**Guardrails**

- **永不删除硬约束**：snippet 注入段（marker 之间）、`.claude/claudemd-standard.md` 定义的固定段骨架、git 纪律、ADR 不可改、TDD/GWT 等强制规则必须保留
- **永不破坏 marker**：`<!-- intent-driven:begin --> ... <!-- intent-driven:end -->` 必须原样在文件中，且首尾包裹的内容不动（除非用户明确说改）
- **指针不要悬空**：写"详见 <path>"前必须验证 path 真实存在（`ls` / `find` 验证）
- **monorepo 各自独立**：根 CLAUDE.md 与 sub-repo CLAUDE.md 的压缩方案分别确认，不打包
- **首选 Write 整文件重写**：压缩涉及多处删/挪/合，Edit 多次容易遗漏；先在内存里构造新内容，让用户预审整文件 diff，再一次 Write
- **可逆性**：每次 Write 前 `cp <file> <file>.before-distill` 备份在 `/tmp/` 是可选的保险动作（用户可选择启用）

**与 `/claudemd-sync` 的分工**

参见 `/claudemd-sync` 文件中的对比表。简言之：sync 负责"加进来"，distill 负责"清出去"，两者周期性配合。

**何时不该跑 distill**

- 距离上次 distill 不到 3 轮 sync 沉淀 → 文件可能还没积够冗余，跑了也没什么可压
- 项目处于活跃重构期 → 知识在快速变动，距离稳态太远，压缩后可能很快又得重写
- 当前 CLAUDE.md ≤ 100 行（小项目）→ 没必要折腾
