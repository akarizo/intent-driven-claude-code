## Context

**基线**：本 change 从 `worktree-mechanical-takeoff-gates`（PR #29，OPEN）开出。该 PR 已落地 `session-model.py`（读转录末条主循环 assistant 的 `message.model` → 别名，fail-closed）与 `takeoff-gate.py`（`PreToolUse(Workflow|Agent|Task)` 校验人类批准证据 + 新鲜度），判据来源已符合 ADR `DRAFT-gate-evidence-not-self-reported`。

**在force的 ADR**（`openspec/adr/` 全部 5 份，无 `Supersedes`，故全部在force）：

| ADR | 对本设计的约束 |
|---|---|
| `DRAFT-gate-evidence-not-self-reported` | **直接约束**。真值源只认转录 / 文件系统 / git / hook 留痕；强制点放 hook；判不出 fail-closed，hook 自身异常 fail-open；人类审批的证据是人自己发出的消息 |
| `DRAFT-apply-as-flight` | 飞行一旦开始零问询——本 change 的停顿都在**起飞之前**，不违背 |
| `DRAFT-model-routing-defaults-for-template` | 路由表本身不动；本 change 只加"人对该路由的知情" |
| `DRAFT-review-orchestration-watermark` · `DRAFT-memory-as-fifth-resident-carrier` | 无关 |

**三个缺口**（证据见 proposal）：explore 阶段不在任何拦截面内；执行模型只是自动读数不是确认点；交给人的起飞指令不自足（`/clear` 后无法复原）。

## Goals / Non-Goals

**Goals**
- explore 阶段的两类越界动作（写飞行计划工件、跑 baseline）当场被 hook deny。
- 每次起飞停一次，把当前主模型与规模摆在人面前，人一句短确认才飞。
- 交给人的起飞指令是**一行**，`/clear` 后可直接复制；派发参数一律机械推导。
- 判据零 token；模型**不能借工具输出自证**（`tool_result` / `<bash-stdout>` / `<local-command-stdout>` / sidechain 形状都被 `human_text()` 排除）。⚠ 直接向 `~/.claude/projects/**/<sid>.jsonl` 追加伪造的 `type:"user"` 行是**已知残留通路**，两个门禁都分辨不了；属既有架构问题（非本 change 引入），见 Open Questions。命令文本与 hook 判据同改。

**Non-Goals**
- 不改 `session-model.py`（直接复用其 `alias_of`）。
- 不拦 explore 阶段写 `proposal.md` / `design.md` / `specs/**`。
- 不在飞行开始后增加任何问询点。
- 不引入新的落盘状态文件。

## 关键技术事实（先验真，后设计）

对 `code.claude.com/docs/en/hooks` 核对、并与本机 `2.1.269` 的二进制字符串交叉验证：

| 事实 | 结论 | 对设计的影响 |
|---|---|---|
| `PreToolUse` 支持 `permissionDecision: allow / deny` | 可阻断 | 两个门禁的强制点都放这里 |
| `SubagentStart` exit 2 **不被 honored** | 不可阻断 | 排除"拦执行体启动"的方案，否则静默失效 |
| `UserPromptSubmit` exit 2 = "Blocks prompt processing and **erases the prompt**" | 可阻断，但**erase 后是否入转录，文档未定义** | ⚠ 见 D1 |
| transcript 异步写入："may not yet include the current turn's most recent messages when a hook fires" | 转录有滞后 | ⚠ 见 D1 |
| hook 输入含 `transcript_path` · `cwd` · `hook_event_name` | 有 | 主模型与阶段都能取转录真值 |

## 组件视图（虚线 = 本 change 新增/改动）

```
                          Claude Code 会话
   人 ──起飞指令(一行)──▶ ┌───────────────────────────────────────────┐
                         │  PreToolUse                               │
                         │   ├─ intent-gate.py   (Write|Edit)   已有  │
                         │   ├╌ takeoff-gate.py  (Workflow|Agent|Task)│╌▶ deny（发起未确认）
                         │   │    判据改：发起 ≠ 批准              S1 │
                         │   └╌ phase-gate.py    (Write|Edit|Bash) S2│╌▶ deny（explore 越界）
                         └───────────────────────────────────────────┘
                                        │ 只读
                                        ▼
                          ~/.claude/projects/*/<sid>.jsonl（真值源）
```

## 起飞时序

```
人: 去 '<worktree 绝对路径>' apply flight-gate, 授权你git提交, 完成后就pr-ship, 把pr url交付我review
      │                                    ← 这一行由 propose 收尾直接给出（S3）
      ▼
/opsx-apply step 0 → takeoff-gate.py --change-dir …
      │  最后一条人类消息 = 发起（含 change 名/路径/命令）→ 不是批准
      ▼
  exit 3 ⛔ 主会话停下，把这段原样交给人：
      ┌──────────────────────────────────────────────────────┐
      │ ⛔ 起飞待确认                                          │
      │    当前主模型 fable → executor / reviewer 都用它       │
      │    规模 3 切片 · 2 wave                                │
      │    worktree  /abs/.../.worktrees/flight-gate          │
      │    spec.html /abs/.../spec.html                       │
      │    确认无误回一句「起飞」；要换模型先 /model 再回        │
      └──────────────────────────────────────────────────────┘
      │
      │ 人看一眼 → 切模型 or 直接确认
      ▼
人: 起飞          ← ≤40 字 · 含批准词 · 不含 change 名与路径 = 确认
      ▼
step 0 重跑 → 批准成立 → 派发（hook 同判据兜底）→ 飞
```

## Decisions

### D1 · 停顿放在 `PreToolUse` / step 0，不用 `UserPromptSubmit`
原设计是 `UserPromptSubmit` exit 2 拦起飞 prompt，人原样重发即放行（判据：转录里该消息已出现过一次）。**验真后作废**：
- 文档未定义被 erase 的 prompt 是否写入转录 → "第一次是否留痕"不可知；
- 转录异步写入且可能滞后当前轮 → 即使留痕，hook 读它也有竞态。

**基于未定义行为建门禁违反"判据可核验"**，故改用 `takeoff-gate.py` 既有的 `PreToolUse` + step 0 自检位置：人的两次消息之间有真实往返，转录有充分时间落盘，且 deny 不抹 prompt。
- 代价：停顿比 `UserPromptSubmit` 晚一点（step 0 之前是几条只读命令，无副作用）。
- 若日后实验确认 erase 后仍留痕，可把停顿前移，判据语义不变。

### D2 · 判据改为"发起 ≠ 批准"，两段式握手
分类只看最后一条人类消息：含 change 名 / worktree 路径 / `<command-name>/opsx-apply` → **发起**；≤ 40 字 + 含批准词 + 不含 change 名与路径 → **确认**。先判发起再判确认。
- 这样用户那行 `去 '…' apply demo, 授权你git提交…`（**含"授权"二字**）被正确判为发起而非批准——这是最易写错的一处，已写进 S1 切片包与测试。
- **BREAKING**：收紧 PR #29 的 `approval-gate-accepts-human-command`（原本 `/opsx-apply` 即批准）。
- **备选：只靠"本仓没有 slash command 所以长指令超 40 字会被拦"** — 那样 gateway 那类装了命令的仓库敲 `/opsx-apply` 仍不停，两边行为不一致，停顿变成"碰巧生效"而非设计。否决。

### D3 · 停下时一次给全，不让人再问
`stderr` 与 hook 的 `permissionDecisionReason` 用同一段文本：主模型别名 + 规模 + worktree 绝对路径 + `spec.html` 绝对路径 + 两条出路。
- 主模型判不出（第三方 id / 读不出 assistant）→ **仍然停**并点名原因（fail-closed）：判不出就不许起飞。
- 规模读不到（`slices.json` 缺失）→ 省略该项，不因此失败：它是参考信息不是判据。

### D4 · 起飞指令一行，派发参数机械推导
交给人的只有意图与授权；`waves` ← `slice-gate.py lint`、`deps` ← `slices.json`、`expectHead` ← `git rev-parse --short=10 HEAD`、`changeDir`/`hooksDir`/`agentsDir` ← 仓库布局、`<main>` ← `session-model.py`。
- **备选：收尾把全部参数打印出来让人复制** — 违反铁律 9（能机械判定的不交给人），且人工复制的参数会过期（`expectHead` 每次 commit 都变）。否决。

### D5 · 新建 `phase-gate.py`，不把 explore 逻辑塞进 `takeoff-gate.py`
两者判据同源（读转录认人类消息），但触发面与语义不同：`takeoff-gate` 判"起飞批准"，matcher `Workflow|Agent|Task`；`phase-gate` 判"阶段纪律"，matcher `Write|Edit|Bash`。合并会让每次 `Write` 都跑一遍起飞批准判定。
- 代价：约 40 行转录扫描形似。抽公共模块留到两者各稳定一个迭代后再议（见 Open Questions）。

### D6 · explore 的禁区限于三类工件 + baseline
禁 `slices.json` · `tasks.md` · `slices/*.md` 与 `slice-gate.py baseline`；`proposal.md` / `design.md` / `specs/**` 放行（保留 explore "捕捉思考"的既有定位）。派实现类子 agent 由 `takeoff-gate.py` 覆盖，不重复实现。

## Risks / Trade-offs

- **[每次起飞多一次短往返]** → 用户明确要求的停顿；起飞指令保持一行，确认只需两个字。不提供跳过开关——开关本身就是绕过路径。
- **[收紧 PR #29 判据，两个 PR 有先后依赖]** → 合并顺序固定为 PR #29 先、本 change 后；S1 同时改 `tests/test_approval_gate.py` 里冲突的断言，冲突面集中在一个切片内。
- **[`phase-gate` 与 `takeoff-gate` 形似约 40 行]** → 刻意接受（D5），记入 Open Questions。
- **[判据依赖转录的 `<command-name>` 与人类消息形状]** → 与 `takeoff-gate.py` 同源，风险已存在；形状变更时两者一起 fail-open（放行），不会静默误 deny。
- **[阶段判定受转录异步滞后影响]** → `phase-gate` 只读"更早的、已落盘的"命令消息判阶段，不依赖当前轮；滞后只会让它少拦一次（fail-open 方向），不会误拦。

## Migration Plan

1. PR #29 先合并进 `main`。
2. 本 change 预合并 `main` 后建 PR；`install.sh` 无需改动——`hooks.json` 是 hook 唯一真源，安装时幂等合并进目标 `settings.json`。
3. 已安装模板的仓库重跑 `install.sh` 即获得两道门禁。
4. **回退**：从 `hooks.json` 摘掉 `phase-gate.py` 一条注册即停用阶段门禁；`takeoff-gate.py` 的握手判据回退则是把分类函数退回"发起即批准"，其余逻辑不受影响。

## Open Questions

- `phase-gate.py` 与 `takeoff-gate.py` 的转录扫描是否抽成公共模块——待 PR #29 合并、两者各稳定一个迭代后评估。
- `UserPromptSubmit` exit 2 后被 erase 的 prompt 是否写入转录——文档未定义。若日后做实验确认留痕，停顿可前移到 prompt 提交时刻，判据语义不变（值得单独记一条基础设施事实）。
- **转录文件本身可被模型直接写**：`human_text()` 封住了「借工具输出自证」，但模型持 Bash 写权限时可向 `~/.claude/projects/**/<sid>.jsonl` 追加伪造的人类消息行，`takeoff-gate` 与 `phase-gate` 都分辨不了。封堵方案是对该路径加一条 `PreToolUse` 写入拦截，属跨 change 的架构问题，另案处理。
- `phase-gate.py` 的阶段只认 `<command-name>/opsx-*` 形状，而本 change 新确立的主用起飞路径是一行自然语言。若最后一条 opsx 命令是 `/opsx-explore`、随后用一行式起飞，阶段会卡在 explore 并误拦 apply 期间的 `tasks.md` 勾选（PR #30 评审 M1）。已入 `review-findings.json` 的 deferred，下一轮修。
- 本设计不建议修改任何在force ADR；`DRAFT-gate-evidence-not-self-reported` 的适用范围由"起飞那一刻"延伸到"起飞之前的整段路"，属延伸而非变更，无需 supersede。
