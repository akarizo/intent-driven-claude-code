## Context

现行 in-force ADR `DRAFT-apply-as-flight` 已确立「机械门禁 + 评审离路径 + 一次批量修复 + final」。本 change 不改这条主线，只补它收口处漏掉的一环：**draft / ready 是一个门禁结论，却没有门禁脚本来下**。不需要新 ADR。

## Decisions

### D1 裁决点唯一：`slice-gate.py ship`

放进 `slice-gate.py` 而不是新脚本：它已有 `gate-report.md` 的读写函数、`load_plan`、`toplevel`、`git`，`ship` 只是在同一份真相上多一个只读视图。三条判据：

| 判据 | 数据源 | 不满足时的 reason |
|---|---|---|
| 每个切片最新行 ok | `gate-report.md` 按切片取最后一行 | `切片 S 门禁红：<failed>` / `切片 S 无门禁记录` |
| final 最新行 ok 且 commit 前缀 == HEAD | `gate-report.md` final 行 + `git rev-parse HEAD` | `final 未运行` / `final 红` / `final 过期：记录 X，HEAD Y` |
| 阻断 finding 为空 | `review-findings.json.blocking` | `N 条 CRITICAL/HIGH 评审未闭环` |

`review-findings.json.blocked` 原样带出，**不参与裁决**。理由：blocked 里的 infra 原因（agent 未返回 / integrator 冲突 / 依赖跳过）在 integrator 写回门禁后已经体现在 `gate-report.md` 里——切片真没跑就没有行，真红就是 red 行；再拿 blocked 裁决是重复且过严。

### D2 `blocked.kind` 只分两类

`gate`（切片门禁红）与 `infra`（其余）。分类只为 PR 正文可读，让人类 reviewer 一眼看出是代码问题还是流水线问题。不引入更细分类。

### D3 `--markdown` 由脚本渲染

PR 正文段落是固定格式，交给脚本零 token；`/pr-ship` 只做拼接。ready 且无 blocked 时输出空串，避免正文出现空标题。

### D4 双向转换写在 `/pr-ship`，不写在工作流

工作流在 PR 存在之前就结束了；ready ↔ draft 的第二次转换只能发生在 `/pr-ship` 的自动修复收尾。GitHub 用 `gh pr ready <num>` / `gh pr ready --undo <num>`，GitLab 用 `glab mr update <num> --ready` / `--draft`。每次转换记 timeline 事件 `pr-ready` / `pr-draft`。

### D5 `timeline` 记 `ship` 事件

`ship` 每次运行追加 `ship\tready` 或 `ship\tdraft: <reasons>`，飞行记录能回放「为什么当时是 draft」。

## Risks

- **`gate-report.md` 手工污染**：模型可以直接编辑它伪造 ok 行。现状同样存在（`final` 的确认也是读它），本 change 不扩大此面。
- **`review-findings.json` 缺失**：视为无阻断 finding。飞行收口一定写它；`/pr-ship` 单独使用（非飞行）时本来就没有评审结果可读。
- **短 SHA 前缀比对**：`gate-report.md` 存 10 位，与 `report_has_row` 同口径，10 位碰撞概率可忽略。
