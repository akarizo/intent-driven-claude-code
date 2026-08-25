---
description: 把本轮变更沉淀进 CLAUDE.md —— 预算中性（加一减一），加法与减法在同一个动作里
---

把本轮（当前分支相对 `origin/main` / 当前 session）的变更沉淀进记忆层。

> **取代 `/claudemd-sync`**（2026-08-25 废除）。旧命令明写「不要压缩、宁可冗余」且每轮跑，而减法挂在一个更慢的 `/claudemd-distill` 上 —— 结构上是**有齿无掣子的棘轮**，必然单调增长（实测：某仓 12 周内子项目文件字节 14.6×，全程「行数合规」）。本命令把加法与减法合进同一个动作。

> **模型建议**：机械同步任务，主会话在 Opus 时先 `/model sonnet` 再跑，省约 5× token。

**硬约束基线**：`.claude/claudemd-standard.md` —— §0 四大不变量 · §7 准入闸门 + 路由 · §12 字节预算 · §12b 分流去向。

**Input**：可选参考分支（默认 `origin/main`）。例如 `/claudemd-commit origin/release-v2`。

---

## Steps

### 1. 量基线（先知道自己在哪）

并行跑：

```bash
git status --short
git diff --stat <base-ref>...HEAD
git log --oneline <base-ref>...HEAD
python3 .claude/hooks/claudemd-lint.py --warn-only
```

lint 输出即**预算基线**：每份文件当前字节 / 闸门 / 已有违规。记下来，第 5 步要对账。

⚠ 若 lint 已报 ERROR（超预算 / 悬空指针），**本轮必须一并清掉** —— 不允许在已超线的文件上继续加。

### 2. 归类变更 + 读现状

- 按目录归类变更文件；`find . -name CLAUDE.md`（排除 worktree / node_modules）建立分布图。
- 并行 Read 相关 CLAUDE.md + `.claude/claudemd-standard.md`，建立「现有约定清单」心智模型。
- 列出已有的 `.claude/rules/*.md` 与 `.claude/skills/` —— 它们是分流去向，不是背景板。

### 3. 生成候选（三类，**没有第四类**）

- **A. 新知识**：本轮新增的约定 / 决策 / 工具 / 依赖 / 目录结构 / 命名风格。
- **B. 应废弃**：本轮删了文件、改了流程、新规则取代旧规则 → 对应条目必须删或改。
- **D. 隐性知识**：用户本轮口头给过、但未落地的规则与偏好。**这类最有价值** —— 它是唯一从代码里推导不出来的。

> ⚠ **不再有 C 类「本轮发现的工程偏差」**（2026-08-25 废除）：A/B/D 记录*已发生*的事、规模受变更规模约束；C 让模型主动去*发明*观察再倒进永久常驻文件，是增长引擎里唯一的**无界项**。
> 本轮观察到的偏差 → **写进 backlog**（`docs/superpowers/backlog/<date>-<topic>.md`）并在报告里列出，**不进 CLAUDE.md**。

### 4. 逐条过准入闸门（standard §7 ⓪）

每条候选**必须**回答四问，答案写进候选清单：

```
Q1 典型会话里会命中吗?          ✗ → 进 ADR / docs，至多留一行指针
Q2 不写模型就会做错吗?          ✗ → 丢弃（模型默认行为已正确）
Q3 做错了会「静默」吗?          ✗ → 丢弃（会报错/测试红 = 一个循环就教会了）
Q4 能写成测试 / lint / hook 吗? ✓ → 写那个；解释放进 assert message，
                                    CLAUDE.md 只留一行「防线索引」
```

四问全过 → 再按 **§12b 分流表**定载体，**不默认落 CLAUDE.md**：

| 判据 | 载体 |
|---|---|
| 每会话都要命中 | CLAUDE.md（对应层级，§2 LCA） |
| 只治理某片目录 / 某类文件 | `.claude/rules/<topic>.md` + `paths:` frontmatter |
| 多步流程 / 深度领域契约 | Skill |
| 可被断言 | 测试 / lint / hook |
| 有正式归宿（ADR/spec/backlog） | 只留一行指针 |

每条候选须含：**目标载体+路径** · **动作**（增/删/改）· **原文** · **四问答案** · **理由**（引本轮哪个变更）。

### 5. 算预算账（本命令的核心，**不可跳过**）

对每个将被写入的 CLAUDE.md，先算：

```
写入后字节 = 当前字节 + 新增字节 − 删除字节
```

| 情形 | 处置 |
|---|---|
| 写入后 ≤ 闸门 **且** 净增 ≤ 0 | 直接进第 6 步 |
| 写入后 ≤ 闸门 但净增 > 0 | 可放行，但须在报告里显式记「本轮净增 N 字节，余量剩 M」 |
| 写入后 > 闸门 | **当场**减：从同文件挑等量内容删 / 指针化 / 分流到 rules·skill，减够了才写 |

⚠ **禁「先写进去，等以后跑 distill」** —— 减法一旦推迟就永远滞后于加法。
⚠ 减法候选优先级：① 已被测试拦住的重复解释 → 一行防线索引 ② 变更史叙述 → ADR ③ 只服务单片目录的段 → `.claude/rules/` ④ 已自解释的代码复述 → 删。

### 6. 与用户逐类确认

用 **AskUserQuestion** 逐类（A/B/D）展示候选 + **该文件的预算账**，每条让用户选：
`接受` / `调整后接受` / `拒绝`。

- 不要打包成一个 yes/no；条目多时按文件或主题分组。
- **减法项与加法项成对展示** —— 让用户看见「为了加这条，要删哪条」。

### 7. 写入 + 验收

- 按用户接受的方案写入（多处改动优先 Write 整文件重排，少量用 Edit）。
- **不破坏 marker**：`<!-- intent-driven:begin --> … <!-- intent-driven:end -->` 原样保留。
- 写完**必须**跑：

```bash
python3 .claude/hooks/claudemd-lint.py
```

**全绿才算完成**。红了就继续减，不允许带着 ERROR 收尾。

### 8. 报告

```
## CLAUDE.md 沉淀报告（预算中性）

**base**: <ref>  **commits**: N  **变更文件**: M

| 文件 | 前 | 后 | 净变化 | 闸门 | 余量 |
| --- | --- | --- | --- | --- | --- |
| ./CLAUDE.md | 7.2KB | 7.1KB | −112B | 8KB | 0.9KB |

### 分流去向（未进 CLAUDE.md 的）
| 条目 | 去向 | 理由（四问哪一问 ✗） |
| --- | --- | --- |
| rom 脚本 5 条不变量 | `.claude/rules/rom-script.md` | Q1 ✗ 只在改 af_rom/** 时命中 |
| qarpc 桩签名必须照抄 | `tests/.../test_reader_contract.py` | Q4 ✓ 可断言 |

### 本轮观察到的偏差 → backlog（不进 CLAUDE.md）
- <条目> → `docs/superpowers/backlog/<file>.md`

### lint
<claudemd-lint 最终输出，须 0 ERROR>
```

---

## Guardrails

- **预算中性是硬约束**：超闸门必须当场减，不允许推给 `/claudemd-distill`。
- **不默认落 CLAUDE.md**：每条先过四问、再查 §12b 分流表。「重要」不等于「该常驻」。
- **没有 C 类**：本轮发现的偏差进 backlog，不进常驻层。
- **祈使句判据**：写不成祈使句（「MUST / 禁 / 先 X 再 Y」）的句子属于 ADR，不属于 CLAUDE.md。
- **指针写前验真**：`ls` / `find` / `cx` 确认目标存在；lint 会兜底拦悬空指针。
- **monorepo 就近归位**（§2 LCA）：绝不把子项目的事写进根。
- **收尾必须 lint 全绿**，禁带 ERROR 声明完成。

## 与其它命令的分工

| 工具 | 时机 | 模式 |
| --- | --- | --- |
| `claudemd-lint` | pre-commit / CI / 每次写入后 | 机械拦截，无判断 |
| `/claudemd-commit`（本命令） | 每轮变更结束 / PR 前 | 增量 + 预算中性（字节零净增） |
| `/claudemd-distill` | 累积多轮后 / 结构性重排 | 全量大扫除（文件显著变短） |

日常增长已由本命令约束住 → `/claudemd-distill` 不再是「止血手段」，只用于定期重排。
