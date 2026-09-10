## Why

`/opsx-apply` 的「逐 task 守门」模式把一个中等变更拖到 12–24h。2026-09-10 对本机 5 个正在跑该模式的会话（约 100h wall clock、283 个子 agent 转录）做逐段归因：等子 agent占工作时间 63–82%，子 agent 时间里 review + fix 占 64–80%（真正的实现只占 20–36%），fix 子 agent 数 ≥ impl 数（1.3–3.1×），每 task 链路 22–106 min；实现类子 agent 42–84 轮而工具执行不到 1 分钟；主会话上下文峰值 619–847k，>400k 时每轮延迟是 100–200k 时的 3–4 倍。等人只是过夜空档，不是工作期内的机制。

目标：**一个中等变更（约 5 切片 / 500 行）从批准到 PR 打开 ≈ 1 小时**，且模板的能力原则一条不丢。

## What Changes

- **规格可执行**：tasks 阶段为每个 Gherkin scenario 生成待通过的测试骨架（`xfail(strict)`），批准 spec.html 即批准验收测试；apply 完成判据 = 全部 scenario 测试由 xfail 变 pass。
- **切片有所有权**：tasks.md 由 `slices.json` 生成。每片声明 `owns` / `deps` / `verify` / `scenarios`；同 wave 内所有权不相交（lint 校验）；门禁对 `owns` 之外的写入 DENY。
- **切片包**：规划器一次生成 `slices/<S>.md`（scenario 原文、骨架路径、owns、design 摘录、verify、依赖切片接口摘要），执行体起步上下文 ≤ 25k。
- **调度用确定性脚本**：新增命名工作流 `.claude/workflows/opsx-apply.js`（wave 内并行、切片门禁、评审离关键路径、一次批量修复、全量门禁）；Workflow 不可用时 `/opsx-apply` 回退为主会话 `Agent` 并行派发，语义一致。
- **机械门禁** `slice-gate.py`（lint / waves / start / gate / final / baseline）+ `test-evidence.py`（hook 留痕测试运行）+ `timeline.py`（飞行记录）+ `stop-gate.py`（切片未过门禁不许收口）+ `session-decompose.py`（收口分解，与本 change 的实测同法）。
- **spec.html 改脚本渲染** `spec_html.py`，新增「飞行计划」区（切片 / wave / 所有权 / scenario↔test 映射 / 实时状态）。
- **执行体与评审员成为 agent 定义**：`slice-executor`（inherit · maxTurns 40 · acceptEdits · 一轮多动作 · 只回 JSON）、`integrator`（sonnet · 合回 wave · 抽接口 · 全量门禁）、`code-reviewer`（保留 full / follow-up，禁重跑测试，结构化 findings）。
- **删除**：逐 task 阻断式守门作为默认、review 水位线簿记、整合审位置问询、apply 模式问询、pr-ship 逐步 Accept、模型渲染 HTML。旧模式移入 `skills/legacy/`，`--gate=per-task` 可选。
- **修 bug**：`intent-gate.py` 按目标文件向上找最近 `openspec/` 定根（会话从主仓库根 `cd` 进 worktree 后写源码不再被误拒）。
- **修正过期表述**：`CLAUDE_CODE_SUBAGENT_MODEL` 自 Claude Code v2.1.251 起只是默认值（参数 > frontmatter > env），snippet / README 同步。
- **铁律落 CLAUDE.md**：本仓库根 `CLAUDE.md` 与模板 `CLAUDE.md.snippet` 各写一段「铁律」，加速手段不得破坏。

## Capabilities

### New Capabilities

- `slice-gate`: 切片规划的 lint（片数 / DAG 深度 / 所有权不相交 / verify 必填）、切片门禁 G1–G7 的判定与 JSON 契约、门禁的 worktree 定根与所有权 DENY、测试运行留痕、收口阻断。
- `flight-apply`: apply 作为一次「飞行」的编排契约——wave 并行、门禁红重试一次否则 blocked、评审离关键路径、一次批量修复、全量门禁、零问询、回退路径；执行体 / 评审员 / 集成员的 agent 契约；飞行记录与收口分解。
- `executable-specs`: scenario → 测试骨架的生成与映射、tasks 产出 slices.json 与切片包、spec.html 飞行计划区的脚本渲染、铁律在 CLAUDE.md 的落地。

### Modified Capabilities

<!-- 无。`template/openspec/specs/` 下尚无已归档 specs；`review-orchestration`（dedup-code-review 的 delta spec）未归档入主 specs，本 change 以 legacy 方式保留其 skill，不修改其 delta。 -->

## Impact

- **新增**：`template/.claude/hooks/{slice-gate,test-evidence,timeline,stop-gate,session-decompose,spec_html}.py`、`template/.claude/agents/{slice-executor,integrator}.md`、`template/.claude/workflows/opsx-apply.js`、`tests/`（本仓库自身的 pytest，不下发）。
- **修改**：`intent-gate.py`、`hooks.json`、`settings.json`、`code-reviewer.md`、`opsx-{propose,apply,continue,verify}.md` 与对应 skill、`pr-ship.md`、`spec-html.md` 与 `spec-html-render` skill 及模板、`schema.yaml` 与 templates、`openspec-git-discipline` skill（临时切片 worktree carve-out）、`CLAUDE.md.snippet`、`README.md`、`docs/WORKFLOW_zh.md`、`install.sh`（确认 agents / workflows 目录随升级刷新）、本仓库根 `CLAUDE.md`。
- **降级**：`skills/openspec-subagent-apply-change` → `skills/legacy/`。
- **不影响**：ADR 不可改原则、openspec 归档契约（`### Requirement` / `#### Scenario` 层级）、`/opsx-archive`、`/opsx-sync`、`/opsx-bulk-apply`、`/claudemd-*`、`claudemd-lint`。
- **依赖**：Claude Code ≥ 2.1.251（模型解析顺序）与 Workflow 可用（付费计划；Pro 需在 `/config` 打开）；不可用时自动回退。
