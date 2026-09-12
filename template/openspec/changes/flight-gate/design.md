## Context

**基线**：本 change 从 `worktree-mechanical-takeoff-gates`（PR #29，OPEN）开出。该 PR 已落地两块机械判定——`session-model.py`（读转录末条主循环 assistant 的 `message.model` → 别名，fail-closed）与 `takeoff-gate.py`（`PreToolUse(Workflow|Agent|Task)` 校验人类批准证据 + 新鲜度）。两者的判据来源已符合 ADR `DRAFT-gate-evidence-not-self-reported`。

**在force的 ADR**（`openspec/adr/` 全部 5 份，无 `Supersedes` 字段，故全部在force）：

| ADR | 对本设计的约束 |
|---|---|
| `DRAFT-gate-evidence-not-self-reported` | **直接约束**。真值源只认转录 / 文件系统 / git / hook 留痕；强制点放 hook；判不出时 fail-closed，hook 自身异常时 fail-open；人类审批的证据是人自己发出的消息 |
| `DRAFT-apply-as-flight` | 飞行一旦开始零问询——本 change 两处拦截都在**起飞之前**，不违背 |
| `DRAFT-model-routing-defaults-for-template` | 路由表本身不动；本 change 只加"人对该路由的知情与确认" |
| `DRAFT-review-orchestration-watermark` · `DRAFT-memory-as-fifth-resident-carrier` | 无关 |

**待补的拦截面**（proposal 已给事故证据）：`takeoff-gate.py` 的 matcher 是 `Workflow|Agent|Task`，只覆盖**派发**这一类动作。explore 阶段的越界是 `Write`（写 `slices.json`）与 `Bash`（跑 baseline），落在 matcher 之外；而执行模型在 `session-model.py` 里是**自动读数**，没有任何一处把它变成人的确认动作。

## Goals / Non-Goals

**Goals**
- explore 阶段的两类越界动作（写飞行计划工件、跑 baseline）当场被 hook deny。
- 每次 `/opsx-apply` 起飞前，人必须看见当前主模型并显式确认；确认证据可从转录复核。
- 判据零 token、不可由模型伪造；命令文本与 hook 判据同改，不漂移。

**Non-Goals**
- 不改 `takeoff-gate.py` / `session-model.py` 的判据与实现（PR #29 已定）。
- 不拦 explore 阶段写 `proposal.md` / `design.md` / `specs/**`（保留"捕捉思考"定位）。
- 不在飞行开始后增加任何问询点（铁律与 `DRAFT-apply-as-flight` 不变）。
- 不引入新的落盘状态文件。

## 组件视图（C4 Component，虚线=本 change 新增）

```
                         Claude Code 会话
   人 ──prompt──▶ ┌──────────────────────────────────────────────┐
                  │  UserPromptSubmit                            │
                  │   ├─ intent-reminder.py   （已有·注入 rubric）│
                  │   └╌ phase-gate.py --mode prompt          ╌╌╌┼╌▶ exit 2 阻断
                  │        判据：转录末条 assistant.model         │    （无 --confirm-model）
                  │               + prompt 里的 --confirm-model=  │
                  ├──────────────────────────────────────────────┤
                  │  PreToolUse                                  │
                  │   ├─ intent-gate.py    (Write|Edit)  已有     │
                  │   ├─ takeoff-gate.py   (Workflow|Agent|Task) │ ← PR #29
                  │   └╌ phase-gate.py     (Write|Edit|Bash)  ╌╌╌┼╌▶ deny
                  │        判据：转录末条人类命令消息 → 阶段       │    （explore 越界）
                  └──────────────────────────────────────────────┘
                                    │ 只读
                                    ▼
                     ~/.claude/projects/*/<sid>.jsonl（真值源）
```

## 起飞时序（本 change 后）

```
人: /opsx-apply flight-gate
      │
      ▼
UserPromptSubmit → phase-gate.py
      │  读转录末条 assistant.model = claude-fable-5-1 → 别名 fable
      │  prompt 里找 --confirm-model=  → 没有
      ▼
  exit 2 ⛔ prompt 被抹掉，stderr 呈现：
      ┌─────────────────────────────────────────────────────┐
      │ ⛔ 起飞闸门 · 尚未确认执行模型                        │
      │    change  flight-gate   切片 3 · waves 2            │
      │    当前主模型 fable  → executor / reviewer 都用它     │
      │    换模型  先 /model，再重敲                          │
      │    就用它  /opsx-apply flight-gate --confirm-model=fable │
      └─────────────────────────────────────────────────────┘
      │
      │ 人 /model 切 opus，重敲带 flag
      ▼
人: /opsx-apply flight-gate --confirm-model=opus
      │  实测别名 opus == flag opus  → 静默放行
      ▼
/opsx-apply step 0 → takeoff-gate.py（PR #29：人类批准 + 新鲜度）→ 起飞
```

## Decisions

### D1 · 新建 `phase-gate.py`，不扩展 `takeoff-gate.py`
两者判据同源（都读转录认人类消息），但**触发面与语义不同**：`takeoff-gate` 是"起飞那一刻的批准"，matcher `Workflow|Agent|Task`；本 change 是"起飞之前整段路的阶段纪律 + 模型确认"，matcher `Write|Edit|Bash` 与 `UserPromptSubmit`。
- **备选 A：把逻辑塞进 `takeoff-gate.py`** — 单文件承三种 hook 事件、matcher 并集变成 `Workflow|Agent|Task|Write|Edit|Bash`，每次 Write 都要跑一遍起飞批准判定，职责糊成一团。否决。
- **备选 B：抽公共模块 `transcript_util.py`，两边共用** — 更 DRY，但要改 `takeoff-gate.py`（PR #29 的文件），冲突面扩大；且两者对转录的用法不同（takeoff 需新鲜度比对，phase 只需末条命令）。**本 change 选独立实现**，代价是约 40 行转录扫描与 `takeoff-gate.py` 形似；待 PR #29 合并且两者稳定后再决定是否抽取（记入 Open Questions）。

### D2 · 阶段判定取转录末条人类命令消息，不落盘 `.phase`
阶段 = 转录里**最后一条**人类消息中出现的 `<command-name>/opsx-<x>`。
- 符合 ADR：真值源是转录，人自己发出，模型伪造不了。
- **备选：`UserPromptSubmit` 写 `openspec/.phase` 状态文件** — 多一份可变状态、多一个模型可以 `Write` 覆盖的靶子（要再加一条 `intent-gate` deny 才能护住），且 worktree 间共享时语义含混。否决。
- 人在 `/opsx-explore` 之后发的普通消息（如"继续"）**不改变阶段**——只有命令消息才是阶段切换点。

### D3 · 模型确认的证据是 prompt 里的 `--confirm-model=`，不建凭据文件
flag 写在人自己的 prompt 里，天然落进转录，`takeoff-gate.py` 的既有判据也能看见同一条消息。
- **备选：hook 写 `.flight-approval.json` 凭据文件** — 引入可变状态，且必须再加一条"禁止模型自己 Write 该文件"的 deny 才能防伪造；用 flag 则零状态、零新靶子。否决。
- 不继承历史：每次起飞都要带 flag（用户拍板"每次都拦"）。

### D4 · 用 `UserPromptSubmit` exit 2 阻断，不用 `AskUserQuestion`
`AskUserQuestion` 由模型自觉调用，属"判据由被门禁方提供"，与 ADR 冲突（本仓已有两次模型自证翻车记录）。`UserPromptSubmit` exit 2 的语义经官方文档核对为 "Blocks prompt processing and erases the prompt"，100% 触发、零 token。
- 代价：人要重敲一次命令。这是刻意成本，且正对应用户"每次起飞前都要切模型"的既有动作。

### D5 · fail-open 与 fail-closed 的分界
| 情形 | 处置 | 理由 |
|---|---|---|
| 转录定位不到 / 读不出 / 非法 JSONL | **放行** | ADR 第 3 条：hook 自身异常 fail-open；`UserPromptSubmit` 阻断会抹掉 prompt，环境异常时不能把人锁在门外 |
| 转录可读但模型 id 认不出别名（如第三方 `k3`） | **阻断** | 证据可疑属"判不出"，fail-closed；与 `session-model.py` 同规矩 |
| flag 与实测主模型不符 | **阻断** | 防止人以为切了而其实没切 |
| 非 `/opsx-apply` 的 prompt · 非 explore 阶段 · 非三类越界路径 | **静默放行** | 门禁只在命中面上生效 |

### D6 · explore 的禁区限于三件工件 + baseline
禁 `slices.json` · `tasks.md` · `slices/*.md` 的写入与 `slice-gate.py baseline`；`proposal.md` / `design.md` / `specs/**` 仍放行。
- 依据：现有 `opsx-explore.md` 定位是"捕捉思考不算实现"，全禁会推翻该定位、改动面外扩（用户已在两个选项间拍板取此）。
- 派实现类子 agent 的拦截**不重复实现**——`takeoff-gate.py` 已覆盖（无人类批准即 deny）。

## Risks / Trade-offs

- **[prompt 被抹掉，长指令丢失]** → stderr 打印**可直接复制的完整命令行**（含 change 名与 flag）；命令文档写明第一次必被拦是设计而非故障。
- **[与 PR #29 同改 `hooks.json` · `opsx-apply.md` · apply SKILL]** → 本 change 基于其分支开出，语义连贯；**合并顺序固定为 PR #29 先、本 change 后**，写入 proposal 的 Impact。
- **[`phase-gate.py` 与 `takeoff-gate.py` 有约 40 行形似的转录扫描]** → 刻意接受（D1），并记入 Open Questions 待两者稳定后评估抽取。
- **[阶段判定依赖 `<command-name>` 这一转录形状]** → 与 `takeoff-gate.py` 依赖同一形状，风险已存在且同源；形状变更时两者一起 fail-open（放行），不会静默误 deny。
- **[每次起飞多一次往返]** → 用户明确要求（Q2 选"每次都拦"）；不提供跳过开关，避免开关本身成为绕过路径。

## Migration Plan

1. PR #29 先合并进 `main`。
2. 本 change 预合并 `main` 后建 PR；`install.sh` 无需改动——`hooks.json` 是 hook 唯一真源，安装时幂等合并进目标 `settings.json`。
3. 已安装模板的仓库（如 `amc/gateway`）重跑 `install.sh` 即获得两道闸门。
4. **回退**：从 `hooks.json` 摘掉 `phase-gate.py` 两条注册即可完全停用，其余组件不受影响；命令文本中的边界描述退化为纯提醒（与本 change 之前的状态语义一致）。

## Open Questions

- `phase-gate.py` 与 `takeoff-gate.py` 的转录扫描是否抽成公共模块——待 PR #29 合并、两者各自稳定一个迭代后再评估；现在抽会扩大冲突面。
- `--confirm-model=` 是否需要支持 `--confirm-model=auto`（"就用当前的，别问了"）——本轮刻意不做，因为它会变成绕过路径；若日后人反馈往返成本过高再议。
- 本设计不建议修改任何在force ADR；`DRAFT-gate-evidence-not-self-reported` 的适用范围由"起飞那一刻"自然延伸到"起飞之前的整段路"，属延伸而非变更，无需 supersede。
