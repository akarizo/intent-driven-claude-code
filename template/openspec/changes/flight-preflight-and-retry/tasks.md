> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S4（并行，owns 不相交）；wave 2 = S3（依赖 S1 的 `start --base` 与 `gate.base` 契约）。

## S1 slice-gate：baseline 预检 + preflight + G2 基线差分 + start 幂等 · deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py`

- [ ] S1 `template/.claude/hooks/slice-gate.py`：`baseline` 加跑 lint / typecheck 基线行与每片 verify，产出 `gate-baseline.json`（`ok` = test 绿 ∧ 各 verify 绿）；新子命令 `preflight`（lint + 基线存在 / ok / `plan_sha` / 祖先）；G2 lint / typecheck 按基线差分（数字折叠行集，只贴新增行；无基线行为不变）；`lint` 拒绝含 typecheck / lint 工具的 verify；`start` 同片幂等 + `--base`；`gate` JSON 带 `base`；scenarios：baseline-writes-gate-baseline-json · baseline-red-verify-blocks · preflight-refuses-without-green-baseline · preflight-refuses-stale-baseline · lint-rejects-verify-with-typecheck-tool · gate-lint-ignores-baseline-lines · gate-lint-flags-new-lines · gate-without-baseline-unchanged · final-typecheck-uses-baseline · start-idempotent-same-slice · start-accepts-base-flag · gate-json-carries-base

## S2 test-evidence 定位禁猜 · deps: - · verify: `python3 -m pytest -q tests/test_evidence_timeline.py`

- [ ] S2 `template/.claude/hooks/test-evidence.py` `find_change`：标记 → 分支 `worktree-<name>` → 恰好一个未完成 change → 不写；scenarios：evidence-resolves-change-from-branch · evidence-refuses-ambiguous-change · evidence-single-candidate-fallback

## S3 工作流重试接续 · deps: S1 · verify: `python3 -m pytest -q tests/test_agents_workflow.py`

- [ ] S3 `template/.claude/workflows/opsx-apply.js` 重试第零步 cherry-pick 上一轮 `commit` + `start --base <上一轮 base>`，GATE schema 加可选 `base`；`slice-executor.md` 开工段补重派接续一句；`opsx-apply.md` 与 `openspec-apply-change/SKILL.md` step 3 加 `preflight`、回退路径同句改重试语义；scenarios：workflow-retry-cherry-picks-previous-commit · apply-docs-mirror-retry-and-preflight

## S4 文档契约 · deps: - · verify: `sh -c 'python3 -m pytest -q tests/test_template_docs.py && cd template && openspec schema validate intent-driven'`

- [ ] S4 `pr-ship.md` 唯一一次问询前移到 step 10 自动修复前（默认只贴评论），step 11 不再问；`opsx-propose.md` / `openspec-propose/SKILL.md` step 4 基线红即停下报告；`schema.yaml` Slicing rules 加「verify 只跑测试」；scenarios：pr-ship-asks-before-autofix · propose-baseline-red-stops · schema-verify-excludes-typecheck
