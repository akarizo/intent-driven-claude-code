> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2（并行，owns 不相交；S2 只在 prompt / 文档里引用 S1 的 `--resume-checkpoint`，测试互不调用）。

## S1 slice-gate：checkpoint 快照 + start --resume-checkpoint + 快照生命周期 · deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py`

- [x] S1 `template/.claude/hooks/slice-gate.py`：新子命令 `checkpoint`（读 hook 载荷，有标记时用临时 index 把 owns 内改动拍成 commit 写到 `refs/flight/<change>/<S>`，静默、fail-open）；`start --resume-checkpoint`（无同片标记、快照存在且 HEAD 是其祖先 → 恢复为未提交改动，JSON 带 `checkpoint.restored` / `note`）；首轮 `start` 删旧快照；`gate` 绿删快照；scenarios：checkpoint-snapshots-owned-changes · checkpoint-silent-without-marker · start-resume-restores-checkpoint · start-resume-skips-foreign-base · start-fresh-clears-stale-checkpoint · gate-ok-deletes-checkpoint

## S2 工作流未返回重派一次 + 同改 · deps: - · verify: `python3 -m pytest -q tests/test_agents_workflow.py`

- [x] S2 `template/.claude/workflows/opsx-apply.js`：`agent()` 为 null 也重派一次，重派 prompt 说明上一轮未返回、`start` 带 `--resume-checkpoint`、不 cherry-pick；仍为 null 记 infra blocked（reason 写明已重派）；`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` 回退路径同句同改；`slice-executor.md` 开工段补 `--resume-checkpoint` / `restored`；`hooks/hooks.json` 与根 `.claude/settings.json` 在 PostToolUse（Write|Edit|Bash）与 PostToolUseFailure（Bash）注册 `slice-gate.py checkpoint`；scenarios：workflow-retries-noreturn-with-checkpoint · workflow-noreturn-twice-blocks · apply-docs-mirror-noreturn-retry
