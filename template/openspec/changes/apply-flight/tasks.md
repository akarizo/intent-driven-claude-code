> 本文件由 `slices.json` 生成（本 change 首次以切片格式规划）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`openspec schema validate intent-driven` 绿。

## S1 门禁核心 · deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py tests/test_intent_gate.py`

- [ ] S1 `slice-gate.py`（lint / waves / start / gate / final / baseline，JSON 契约）+ `intent-gate.py` 向上定根与所有权 DENY；scenarios：lint-accepts-valid-plan · lint-rejects-overlap · lint-rejects-depth · gate-pass-json · gate-ownership-violation · gate-missing-gwt · final-gate-reports-scenarios · intent-gate-worktree-root · intent-gate-ownership-deny

## S2 留痕与飞行记录 · deps: - · verify: `python3 -m pytest -q tests/test_evidence_timeline.py`

- [ ] S2 `test-evidence.py` / `timeline.py` / `stop-gate.py` / `session-decompose.py` + `hooks.json` 注册 + `settings.json`（`worktree.baseRef: head`）；scenarios：evidence-log-records-test-runs · stop-hook-blocks-red-flight · timeline-report · session-decompose-runs

## S3 agent 定义与工作流脚本 · deps: S1, S2 · verify: `python3 -m pytest -q tests/test_agents_workflow.py`

- [ ] S3 `agents/slice-executor.md` · `agents/integrator.md` · `agents/code-reviewer.md`（只留 full / follow-up，禁重跑测试，结构化 findings）· `workflows/opsx-apply.js`；scenarios：workflow-script-valid · executor-agent-contract · reviewer-no-rerun

## S4 spec.html 脚本渲染 · deps: S1, S2 · verify: `python3 -m pytest -q tests/test_spec_html.py`

- [ ] S4 `hooks/spec_html.py`（沿用 block 契约 + 新增 `block:flight`）· 模板加飞行计划区 · `spec-html-render` skill 与 `/spec-html` 退化为一行调用；scenarios：spec-html-renders-artifacts · spec-html-flight-block

## S5 命令 / skill / schema · deps: S3 · verify: `python3 -m pytest -q tests/test_template_docs.py`

- [ ] S5 `opsx-propose`（一次成稿 · 触发器 · slices.json + 切片包 + 骨架 · baseline · 脚本渲染）· `opsx-apply`（lint → waves → Workflow / 回退 → 收 JSON → 收口分解 → pr-ship；`--gate=per-task`）· `opsx-continue` / `opsx-verify` / `opsx-new` · `pr-ship`（去五处问询 · 单次评审 · ≤2 轮自动修）· `openspec-git-discipline`（临时切片 worktree carve-out）· `schema.yaml` + templates（tasks 产出 slices.json / 切片包 / 骨架）；scenarios：apply-command-zero-prompts · pr-ship-single-review · schema-tasks-produce-slices · propose-command-triggers

## S6 文档与铁律 · deps: S3 · verify: `python3 -m pytest -q tests/test_docs_iron_rules.py`

- [ ] S6 `README.md` · `docs/WORKFLOW_zh.md` · `template/CLAUDE.md.snippet`（铁律段 + 模型路由修正）· 仓库根 `CLAUDE.md`（仓库铁律）· `openspec-subagent-apply-change` → `skills/legacy/` · `install.sh` 确认 agents / workflows 随升级刷新；scenarios：legacy-mode-optional · claudemd-iron-rules · docs-updated
