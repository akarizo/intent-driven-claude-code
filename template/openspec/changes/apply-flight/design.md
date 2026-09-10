## Context

现状（2026-09-10 实测，5 个工作流会话）：`/opsx-apply` 逐 task 守门 = 冷启动实现 subagent → 冷启动 reviewer → 冷启动修复 → follow-up，串行；每 task 22–106 min；review + fix 占子 agent 时间 64–80%；主会话把 4.5k 字符回报全量灌回上下文，峰值 619–847k。审批页 `docs/apply-speed-redesign.html`（第 3 版）记录了归因与方案。

现行 in-force ADR：`DRAFT-review-orchestration-watermark`（水位线增量模型）、`DRAFT-model-routing-defaults-for-template`。前者的前提是「多层评审必然存在、需去重」；本 change 把评审层减到一层（并行、离路径），水位线失去对象，故新 ADR 明确 supersede 它。后者关于 env 默认 sonnet 的决定保留，但其「env 压过一切」的事实陈述已被 Claude Code v2.1.251 改变，文档同步修正，不动 ADR。

## Goals / Non-Goals

**Goals:**
- 中等变更（约 5 切片）批准 → PR 打开的关键路径 ≈ 1 小时，且每次 apply 打印飞行记录可对照。
- 模板能力原则一条不丢；规格、TDD、门禁三条变硬。
- Workflow 不可用时有语义一致的回退。

**Non-Goals:**
- 不改 openspec 归档契约、不改 ADR 不可改原则、不自动 merge / push main。
- 不引入 `ultracode` 会话级开关。
- 不做跨仓库的 CI 集成（timeline 只落本地 markdown）。

## Decisions

### D1 调度引擎：命名 Workflow + Agent 回退
- 选择：`.claude/workflows/opsx-apply.js` 作为默认调度器；`/opsx-apply` 读 slices.json、算 waves、以 `args` 启动；检测到 Workflow 不可用（`disableWorkflows` / 命令不存在）时，主会话按同一 waves 用 `Agent` 工具并行派发同一批 agentType，回报同样只收 JSON。
- 备选：主会话逐个派发（现状，串行且上下文膨胀）；`ultracode`（每个任务都起 workflow，过重）。
- 理由：脚本持有 DAG 与循环，输出留在脚本变量，主会话只收最终 JSON；无中途人工输入是运行时事实；可续跑、可 diff。

### D2 可执行规格：tasks 阶段生成 xfail 骨架
- 选择：每个 scenario 一个 `pytest.mark.xfail(strict=True)`（或 `test.todo`）骨架，放在所属切片 owns 的测试文件内；`slices.json.scenario_tests` 记录映射；G7 检查标记已去且 G1 通过。
- 备选：执行体自己写测试，收口再核对映射（映射易漂移，RED 无法由构造保证）。
- 理由：完成判据机械化，删掉 spec compliance 评审与 RED 证据。

### D3 评审形态：每切片并行评审离路径 + 一次批量修复 + 机械整合检查
- 选择：评审 agent 在切片门禁绿后立即发起，不 await；Fix 阶段汇总 CRITICAL/HIGH 一次修复；final gate 机械检查 scenario 全 pass；reviewer 禁止重跑测试套件。
- 备选：末尾一次全量评审（路径上多 6 min）；保留逐 task 阻断（实测最大乘数）。

### D4 切片纪律
- 选择：1–9 片（中等变更建议 3–7）、DAG 深度 ≤ 3、同 wave 所有权不相交、每片 owns ≤ 12 条（glob 计一条）、`maxTurns: 40`；超预算即 blocked 并继续其它切片。
- 理由：所有权不相交是并行零冲突与范围控制的机械保证；轮次封顶阻止马拉松。

### D5 模型路由（按角色显式声明，铁律）
- 选择：`slice-executor` / `code-reviewer` = 会话主模型 + effort high；`integrator` / final-gate = sonnet + effort low；`/opsx-apply` 以 `args.models` 显式传入，脚本缺参即拒绝起飞（`throw`），每个 `agent()` 调用都带 `model` 与 `effort`；agent frontmatter 同步声明（`inherit` / `sonnet`）作为注册路径的第二道保险；收口飞行记录打印各 agent 实际模型与路由表对账。模板 `settings.json` 保留 env 默认 sonnet 只作未声明派发的安全网，禁设 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`。
- 备选：只靠 frontmatter `inherit`（agent 定义未注册时失效——本 change 自举 wave 3 实测：9 个 agent 全落 Sonnet）；只靠 env（把执行体也钉在低档模型）。
- 理由：错误的放大系数决定模型档位——执行体与评审员的错误会变成 fix 轮与漏审，机械角色的错误门禁会抓。v2.1.251 起参数 > frontmatter > env，显式参数是唯一在两条路径下都成立的通道。

### D6 门禁定根与所有权
- 选择：`intent-gate.py` 从目标文件向上找最近含 `openspec/` 的目录定根；根目录存在 `.openspec-slice` 标记时，对 owns 之外的源码写入 DENY。
- 理由：worktree 纪律（PR #22）之后 change 只存在于 worktree；所有权 DENY 零 token 防止顺手改进与并行冲突。

### D7 工件策略
- 选择：schema 的 `requires` 不改（openspec 兼容）；`opsx-propose` 按触发器决定 design / adr 写实质内容还是「跳过声明」；specs 保持必需（行为规格是本模板的核心）。
- 理由：保持 `openspec status` 完整与归档契约不变，同时省掉无意义的工件填充。

### D8 spec.html 脚本渲染
- 选择：`spec_html.py` 确定性渲染，沿用 `spec.html.tmpl` 的 block 契约，新增 `block:flight`；skill 与命令退化为一行调用。
- 理由：渲染是纯输出，模型逐字写 1000 行 HTML 没有信息增益。

### D9 度量内建
- 选择：`timeline.py` 记录 approve / slice-start / gate / review / fix / final / pr-open；`session-decompose.py` 收口打印归因；`/opsx-apply` 收口报告固定含批准→PR 用时、子 agent 数、门禁红次数、主会话峰值上下文。

### D10 铁律落地
- 选择：本仓库根 `CLAUDE.md` 写「仓库铁律」（模板能力原则 + 本仓库开发纪律）；`CLAUDE.md.snippet` 写下发给用户项目的铁律段；实现完成后派独立 reviewer 按铁律审 diff。

## Risks / Trade-offs

- [规划器切片质量差：所有权漏文件 / DAG 太深] → lint 当场报；执行体遇 DENY 返回 `failed: ["G6 ownership: path"]`，主会话把该文件加入 owns 后重跑该切片，不绕过。
- [验收骨架写早了，design 后接口仍变] → 骨架只锁 THEN 的可观测结果；执行体可改骨架但须在 JSON `summary` 申报，reviewer 核对。
- [一次批量修复漏修] → final gate 必须全绿；否则 PR 以 draft 打开并列 blocked 项。
- [Workflow 的临时 worktree 从默认分支分叉] → 模板 `settings.json` 设 `worktree.baseRef: "head"`；本 change wave 3 实证。
- [非 bypass 模式下权限提示让 wave 停住] → 安装说明要求把 gate 命令加入 allow 规则；`/opsx-apply` 启动前自检。
- [token 上升] → 冷启动从 30–100 次降到约 8 次，回报不灌主上下文；以 timeline 对账一轮再定。

## Migration Plan

1. 本 change 自举：wave 1（S1 门禁核心 + S2 留痕 / 时间线 / 收口）与 wave 2（S3 agents + workflow）由主会话按 TDD 直接实现；wave 3（S4 渲染器 / S5 命令与 schema / S6 文档与铁律）用新 workflow 跑，验证 §4 待实证项。
2. 旧模式 `openspec-subagent-apply-change` 移入 `skills/legacy/`，`--gate=per-task` 可选；`review-log.md` 不再生成，已有的由 legacy 路径读取。
3. `install.sh --upgrade` 刷新 `.claude/`（含 agents / workflows / hooks）；用户项目需要在 allow 规则加入测试命令。
4. 回滚：删除 `.claude/workflows/opsx-apply.js` 与新 hooks 注册即回到主会话派发；legacy skill 仍在。

## Open Questions

- Workflow 内 `isolation: 'worktree'` 是否遵守 `worktree.baseRef: "head"`（文档写在 subagent 章节）——wave 3 实证。
- `maxTurns` 到顶返回 partial 时 `schema` 输出如何表现——wave 3 实证。
- 建议 supersede `DRAFT-review-orchestration-watermark`：多层评审去重的前提已不存在（本 change 的 adr 步骤处理）。
