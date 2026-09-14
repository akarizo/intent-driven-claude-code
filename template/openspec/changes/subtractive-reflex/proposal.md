## Why

AI 写代码的默认失败模式是**过度构建**：没人要的抽象、为"以后"留的脚手架、在第 7 个文件里第 4 次实现同一个 helper、只修工单点名的那条路径而兄弟 caller 仍坏着。这些不是风格问题，是可维护性成本——未来每次变更都要为它们付钱。

`DietrichGebert/ponytail`（@ `356918e`，136,912 star）把这个症状做成了一个常驻 prompt 人格。审查它之后（判据 = 本仓库 11 条铁律，结论：通过 2 / 部分 3 / 不通过 4 / 不适用 2）结论是**诊断对、处方错**：它把一整套规则押在模型自律上（`ACTIVE EVERY RESPONSE. No drift.`），三个 hook 全是注入与状态标记，**没有一个 `PreToolUse` / `PostToolUse`**；它的 CI 守着 8 份规则副本不漂移，却不守技能是否还在起作用。它的规则里真正有效的那几条，其实是**可维护性规则伪装成懒规则**——因为"懒"是模型更容易服从的指令形式。

本 change 只吸收那几条，并且把判断权尽量交给脚本。本仓库的真实缺口（均为本地实测）：

| 能力 | 现状 | 缺口 |
|---|---|---|
| 重复实现 / 未要求的抽象 | `code-reviewer.md` checklist 已有「重复代码」「未要求的抽象 / 过度设计（YAGNI）」 | **判得太晚**：评审抓到时代码已写完，闭环要走一轮批量修复 |
| 根因修复（grep 全部 caller） | `slice-executor.md` 纪律段无此条；`code-reviewer.md` 无「症状修复」维度 | 两边都没有 |
| 故意简化的天花板与升级路径 | ADR（重）· backlog（文件名指针）· `gate-report.md`（门禁结论） | **代码级无载体**：简化的理由只活在对话里，而对话会被 compact |

第三条同时修掉 ponytail 自己的反向机制：它的输出契约是 `[code] → skipped: X` 三行以内，外加一条「解释比代码长就删掉解释」——在优化单次交付的同时，系统性地删除了下一次变更需要的上下文。它有 `ponytail:` 注释规范想救这个，但**零执行器**，是纯自愿标注。

## What Changes

- **新增 `slice-gate.py` 的 G8 `ceiling` 判据**（零 token 机械校验）：扫本切片 diff 的**新增源码行**，行首注释形如 `ceiling:` 的标记必须同时给出「限制」与「升级路径」（`限制 -> 升级条件/路径`），缺一 → `failed` 点名 `file:line`；合规标记汇总进 `gate-report.md` 的「天花板」表。**非目标：无标记的切片不得因此变红**——否则判据会退化成形式主义标注，比没有更糟。
- **`slice-executor.md` 纪律段 +3 行**（实现段的减法反射，只在这一段生效）：① 写新符号前先查项目里是否已有同义实现，命中就复用；② 改函数体前先 grep 全部 caller，修在汇流处而不是工单点名的那一条路径；③ 故意切了角的简化用 `ceiling:` 标记写清限制与升级路径。
- **`code-reviewer.md` 正确性维度 +1 条**：症状修复（同类输入经其他 caller 仍失败）。
- **新增 ADR**：《从外部 prompt 工程吸收能力的判据》——记录三条闸门、三条吸收项、五条拒绝项及其理由与证据，防止将来把整包 ponytail 装进来。
- **`tests/` +6 条 scenario**：4 条锁 G8 语义（含 1 条非目标守卫），2 条锁两个 agent 的正文契约。

**不改**：`G1`–`G7` 的既有语义与 JSON 契约形状（`failed` 每项以 `G<n>` 开头并点名对象，G8 沿用）· `cmd_final`（`ceiling` 是逐切片判据，收口不重复扫）· `code-reviewer.md` 既有 7 个 checklist 维度一条不减（只是从"唯一拦点"退为"兜底"）· `template/CLAUDE.md.snippet`（减法反射不常驻，见 design D5）· 任何与 LOC / diff 行数有关的东西（见下）。

**明确拒绝**（写进 ADR，防止将来回流）：

| ponytail 的条款 | 拒绝理由 | 冲突 |
|---|---|---|
| `YAGNI applies to tests too`、trivial 免测 | 测试是重构时唯一的安全网。它自己也自相矛盾：benchmark 特意把 test LOC 从 bloat 统计里切出去，指令却对模型说测试也适用 YAGNI——而模型只读指令 | 铁律 2 / 3 |
| 「解释比代码长就删掉解释」 | 正是它的反向机制：把下一次变更需要的上下文一起删掉。G8 反过来把这类上下文钉在代码旁 | 铁律 8 |
| `ultra` 档「挑战剩下的需求」 | 在维护期等于授权模型缩小需求范围；范围由意图工件定，执行体无权改 | 铁律 1 |
| 常驻人格（`no drift`，"still active if unsure"） | 「该少写」与「该写全」在真实项目里交替出现，它把阶段切换当故障 | — |
| 任何 LOC / diff 行数阈值判据 | **LOC 分不清「压缩」与「简化」**：一个 200 行分层清晰的实现比 40 行挤进一个函数的好维护。它自己的 `benchmarks/agentic/run.py` 注释坦白过度工程只能用 source LOC 做 proxy、真要测得另起 LLM judge——引入行数判据就是把这个坑抄回来 | 永久拒绝 |

**候选中被砍掉的两条**（用 ponytail 自己 ladder 的前三级审这份规划的结果）：

- **依赖新增门禁 → 砍（Q2 已有覆盖）**：切片 `owns` 是白名单，依赖清单文件不在 owns 里写入即被 G6 拒绝；而「引入新抽象或依赖」在 `template/CLAUDE.md.snippet` 里本就是中级+ 触发条件，由 `intent-gate.py` 拦。
- **reuse 专用 `PreToolUse` hook（替模型预搜同义实现）→ 砍（Q1 无实据）**：评审层尚未报过一次重复实现，现在造机制是投机。留观察判据：连续 3 个切片被 reviewer 报重复实现，再立 change。

## Capabilities

### New Capabilities

- **subtractive-discipline**：实现段的减法纪律——`ceiling` 标记的机械判据（格式 · 扫描范围 · 汇总 · 非目标），以及执行体与评审员两侧的减法契约条目。

### Modified Capabilities

无。G8 是 `slice-gate` 既有判据序列的增量，JSON 契约形状不变；`slice-gate` capability 的既有 requirement 一条不改。

## Impact

- **代码**：`template/.claude/hooks/slice-gate.py`（新增判据，约 30–40 行，复用现成的 `changed_files` / `is_doc_or_config` / `append_report`）· `template/.claude/agents/slice-executor.md`（+3 行）· `template/.claude/agents/code-reviewer.md`（+1 条）。
- **契约**：`gate` 子命令的 `failed` 可能出现 `G8 ceiling: <file>:<line> …`；`gate-report.md` 追加一个「天花板」表（追加式，不改既有表）。下游消费者只依赖 `failed` 的前缀约定，不受影响。
- **测试**：`tests/test_slice_gate.py` +4 · `tests/test_agents_workflow.py` +2（后者已在对 agent 正文做内容断言，扩断言即可）。
- **依赖**：无新增。纯 stdlib + 既有 pytest。
- **自举陷阱（实现时必须避开）**：G8 的实现文件自己会提到 `ceiling:`。判据因此只匹配**行首注释紧跟标记**（`^\s*(#|//|--|\*)+\s*ceiling:`），并排除 `is_doc_or_config` 与 `NON_SOURCE_PREFIX`；实现 slice-gate.py 时不得写出 `# ceiling: …` 形状的说明注释（要举例就写 `# G8 ceiling: …` 或放进 docstring 的非行首位置）。切片包 S1 记了这条。
- **未复跑的外部数据**：proposal 引用的 ponytail benchmark 结论（54% 均值 / 94% 天花板 / 100% safe）来自其 `README.md` 与 `benchmarks/results/`，本次**未复跑**（需 API key 与 fixture 仓库）。本 change 不依赖这些数字——吸收判据来自代码事实（hook 清单、CI 配置、SKILL.md 原文），均本地实测。
