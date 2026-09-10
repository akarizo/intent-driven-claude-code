## Why

apply 收口后 PR 是 draft 还是 ready，目前由 `/pr-ship` 的模型**读散文自行判断**（"final 未绿或有 blocked 切片 → `--draft`"），判定依据是工作流一次性返回的内存值，不是仓库里的门禁真相。结果是三处不连贯：

1. **判定不落盘**：工作流返回的 `blocked` 只写进 `timeline.md` 的 note，`/pr-ship` 拿不到结构化数据，只能凭模型记忆；违反铁律 9「能用脚本判定的不交给模型」。
2. **只有单向转换**：draft 建出来后，`/pr-ship` 的两轮 CRITICAL/HIGH 自动修复即使把一切修绿，PR 也永远停在 draft；反过来，先以 ready 建出的 PR 在评审后仍有 CRITICAL/HIGH 时也不会退回 draft，违反铁律 4。
3. **blocked 混淆两类原因**：执行体没返回 JSON、integrator 合回冲突、依赖跳过这类**基础设施原因**与**门禁红**同列，一律触发 draft；而门禁真相（`gate-report.md` 每切片最新行 + final 行是否对齐 HEAD）根本没人机械核对。

## What Changes

- **新增 `slice-gate.py ship` 子命令**：唯一的 draft / ready 裁决点。只读仓库真相：`gate-report.md` 每个切片的最新行、final 行是否 ok 且 commit 对齐当前 HEAD、`review-findings.json` 的 `blocking` 是否为空。输出 `{ready, commit, reasons, blocked}`，退出码 0 = ready、1 = draft；`--markdown` 直接产出 PR 正文段落。
- **`blocked` 落盘并分类**：工作流与回退路径给每条 blocked 加 `kind: gate | infra`；收口把 `{blocked, blocking, deferred, fix}` 一起写入 `review-findings.json`。`ship` 把 blocked 当**说明**列入 PR 正文，不当裁决依据；裁决只看门禁真相。
- **`/pr-ship` 双向转换**：建 PR 前跑 `ship` 决定 `--draft`；自动修复收尾再跑一次 `final` + `ship`，ready 则 `gh pr ready` / `glab mr update --ready` 并记 `pr-ready` 事件；两轮后仍有 CRITICAL/HIGH 则把 ready PR 退回 draft（`gh pr ready --undo` / `glab mr update --draft`）。
- **opsx-apply 命令与 skill 同步**：收口步骤改为写全量 `review-findings.json` 并调用 `ship`，删除模型自判 draft 的散文。

## Capabilities

### New Capabilities

- `ship-verdict`: 飞行模式收口的机械化 draft / ready 裁决——裁决依据、退出码契约、PR 正文段落、以及 `/pr-ship` 的双向转换规则。

### Modified Capabilities

<!-- 无。flight-apply 的 blocked 结构只加 kind 字段，不改既有行为。 -->

## Impact

- **hook（1）**：`template/.claude/hooks/slice-gate.py` 新增 `ship` 子命令（只读，不改既有子命令）。
- **工作流（1）**：`template/.claude/workflows/opsx-apply.js` blocked 条目加 `kind`。
- **命令 / skill（3）**：`commands/opsx-apply.md`、`skills/openspec-apply-change/SKILL.md`、`commands/pr-ship.md`。
- **测试**：`tests/test_slice_gate.py`、`tests/test_template_docs.py`、`tests/test_agents_workflow.py`。
- **不影响**：`gate` / `final` / `record` 的判据与输出；无 `slices.json` 的仓库 `ship` 直接判 ready（非飞行模式 no-op）。
