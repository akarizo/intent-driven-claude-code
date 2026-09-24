## Why

2026-09-18 在 `amc/gateway` 用飞行模式跑 change `scale-visibility-refine`（会话 `95eef968`，MR !39）：一个 change 派发 3 次才飞完，批准到 MR 打开 33.4 分钟。复盘（证据全在转录 / `gate-report.md` / `timeline.md` / git，见 `docs/flight-preflight-and-retry.html`）定位到 6 处 template 缺陷，全部是脚本级：

| # | 现象 | 根因 |
|---|---|---|
| 1 | 切片 lint 按整个 change 算文件：S0 只 owns `slice-gate.py`，却因 propose 阶段的 Rust 骨架被 rustfmt 判红，执行体去改别人的文件再撞 G6 | `slice-gate.py` `cmd_gate` 对 `gate.lint` 原样执行；无基线、无区间 |
| 2 | 重试时基准校验拒绝上一轮 commit：`G0 base: worktree HEAD 不是 c5134a6b31`（HEAD 正是 S0 上一轮 commit）；隔离模式重试拿到新 worktree，看不到上一轮 commit，S1 从头重做 3.5 分钟后撞同一堵墙 | `opsx-apply.js` 重试仍用起飞时的 `expectHead`；Workflow `agent()` 无复用 worktree 选项（已核实） |
| 3 | evidence hook 写错 change 目录：写进 `fix-kafka-ingest-loss/evidence.log`，S1 门禁报 G6 + 工作树脏 | `test-evidence.py` 无标记时按字母序取第一个 tasks.md 未勾完的 change，是猜测；gateway 有 11 个候选 |
| 4 | S3 verify 没排除既有错误：typecheck grep 命中自首个 commit 就存在的 18 处 TS 错误 | typecheck 无基线；verify 手搓 typecheck grep 而规划 lint 不拦；`baseline` 从不试跑 verify |
| 5 | 重试重跑 `start`：base 被重置成自己的 commit（区间为空，第一轮出现的 G3 第二轮消失），`red_count` 归零，之后 stop-gate 连拦主会话 6 次 | `cmd_start` 无条件覆盖标记 |
| 6 | 基线全量测试 `exit 101` 照常批准起飞；S1 最终因基线就有的 loco-openapi 随机 panic 记 `infra` blocked | `cmd_baseline` 退出码只是提示；apply 的 lint 与 takeoff-gate 都不看基线 |

四个停飞原因（骨架 lint 红 · verify 语法错 · 基线随机 panic · 既有 TS 错误）没有一个是设计想错，全是起飞前就能用脚本判定的事实。四种暂停例外里的「测试环境本身坏（verify 在改动前就不可运行）」目前要飞到半空才发现。

另一条同会话事实：主会话 09:38 自动串入 `/pr-ship`，评审回 1 个 HIGH 后未问询直接修、push、复核。这与 `pr-ship.md` step 10「自动修复，不问询」一致，但用户全局 CLAUDE.md 列举的授权（commit · push feature 分支 · 建 PR · 贴评论 · 转 draft/ready）里没有「按 AI 评审改代码并 push」。用户裁决（D5）：自动修之前问一次。

## What Changes

- **F2 起飞前预检**：`slice-gate.py baseline` 除全量测试外，再跑 `gate.lint` / `gate.typecheck`（只记基线行，不阻断）与**每片 `verify`**（骨架是 strict-xfail，基线上必须绿），产出 `<change>/gate-baseline.json`（`commit · at · plan_sha · ok · reasons · test · lint · typecheck · verify`）；红即 exit 1。新增子命令 `preflight`：规划 lint + 基线存在 / ok / `plan_sha` 未过期 / commit 是 HEAD 祖先，任一不满足 → 非 0 停飞；`/opsx-apply` step 3 在 lint 后跑它。
- **F1 门禁基线差分**：`gate` 与 `final` 的 G2 lint / typecheck 拿完整输出做规范化（去 ANSI · 数字串折叠 · 去空行），只对「基线没有的行」判红并只贴新增行；与基线一致但 exit ≠ 0 → warning「既有 N 行已按基线排除」；没有 `gate-baseline.json` 时行为与现在完全一致。
- **规划 lint 新规则**：`verify` 禁含 typecheck / lint 工具名（`tsc|typecheck|eslint|rustfmt|clippy|ruff|mypy|flake8|golangci`），错误信息指向 `gate.typecheck` / `gate.lint`。
- **F3 重试接续**：`start` 对同一切片幂等（已有标记则保留 `base` 与 `red_count`，timeline 记 `slice-start S (resume)`），新增 `--base`；`gate` JSON 带 `base`；`opsx-apply.js` 重试第零步改为「HEAD ≠ 上一轮 commit 则 `git cherry-pick <retryOf.commit>`，冲突 abort 返回 G0」，随后 `start <S> --base <retryOf.base>`；GATE schema 加 `base`。`opsx-apply.md` / `openspec-apply-change/SKILL.md` 回退路径同句同改。
- **F4 evidence 定位禁猜**：`test-evidence.py` 定位顺序改为 标记 → 当前分支 `worktree-<name>` 且 `openspec/changes/<name>` 存在 → 恰好一个未完成 change → 否则不写。
- **F5 pr-ship 自动修前问一次**：唯一一次问询从 step 11 挪到 step 10（自动修并 push / 只贴评论交人；无人应答默认只贴评论）。
- **文档**：`opsx-propose.md` / `openspec-propose/SKILL.md` step 4 基线红 → 停下报告；`schema.yaml` 切片规则加「verify 只跑测试」。

**不改**：G1、G3–G8 语义；`gate` JSON 既有字段；`takeoff-gate.py`（批准判据不动，预检放 `preflight`）；`stop-gate.py`（red_count ≥ 2 放行的既有规则靠 F3 才真正生效）；`TEST_RE` 被 sed / grep 命令文本误触发（记录，不修）；临时 worktree 缺 node_modules 的提示；template G7 不识别 Rust `#[test]`（gateway 本地已移植，另立 change 回流）。

## Capabilities

### New Capabilities

- **flight-preflight**：基线预检——`gate-baseline.json` 的产出与 ok 判据、`preflight` 的停飞判据、verify 禁含 typecheck 工具的规划 lint 规则。
- **gate-baseline-diff**：G2 lint / typecheck 的基线差分与无基线时的回退语义。
- **slice-retry-resume**：`start` 幂等与 `--base`、`gate` JSON 的 `base`、工作流与回退路径的重试接续。
- **evidence-change-resolution**：test-evidence hook 的 change 定位顺序与禁猜。
- **flight-doc-contracts**：pr-ship 自动修前问一次、propose 基线红即停、schema 的 verify 规则。

### Modified Capabilities

无既有 requirement 改动；`slice-gate` 既有 G1–G8 契约形状不变（`failed` 项仍以 `G<n>` 开头并点名对象）。

## Impact

- **代码**：`template/.claude/hooks/slice-gate.py`（baseline 扩展 + preflight + 差分 + start 幂等，约 120 行）· `template/.claude/hooks/test-evidence.py`（定位函数，约 20 行）· `template/.claude/workflows/opsx-apply.js`（重试 prompt 与 schema，约 15 行）。
- **契约**：新文件 `gate-baseline.json`（生成物，随工件提交；不是飞行记录，不进 `FLIGHT_RECORDS`）；`gate` JSON 新增可选 `base`；`start` 新增 `--base`；新子命令 `preflight`；`failed` 可能出现 `G2 lint: exit N（新增 M 行）`、`warnings` 可能出现「已按基线排除」。
- **流程**：`/opsx-propose` step 4 基线红即停（人类收窄 `gate.test` 或修环境后重跑，改计划文件会触发 takeoff-gate 重批）；`/opsx-apply` step 3 多一条 `preflight`；`/pr-ship` 的一次问询前移。
- **测试**：`tests/test_slice_gate.py` +12 · `tests/test_evidence_timeline.py` +3 · `tests/test_agents_workflow.py` +2 · `tests/test_template_docs.py` +3。既有 `test_pr_ship_single_review`（问询 ≤ 1）与 `test_apply_command_zero_prompts`（启动到 pr-ship 之间无问询，且仍含 `slice-gate.py lint`）必须继续通过。
- **代价**：预检 = 全量测试一次 + 各片 verify 各一次；gateway 本例约 3 分钟，对比三次派发。
- **依赖**：无新增，纯 stdlib。
