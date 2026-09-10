> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S3（并行，所有权不相交）· wave 2 = S2 + S4（都依赖 S1 的 `alias_of` / `find_transcript`）。

## S1 判定脚本 · deps: - · verify: `python3 -m pytest -q tests/test_session_model.py`

- [x] S1 `template/.claude/hooks/session-model.py`：`CLAUDE_CODE_SESSION_ID` → glob 转录 → 最后一条主循环 assistant 的 `message.model` → 别名（子串归一，`[1m]` 归基座）；`--session` / `--json`；判定不出一律 exit 3 + stderr 点名，绝不给默认值；公开 `alias_of()` 与 `find_transcript()` 供 S2 / S4 复用；scenarios：session-model-resolves-alias · session-model-latest-wins · session-model-skips-sidechain · session-model-fails-closed

## S2 收口路由对账 · deps: S1 · verify: `python3 -m pytest -q tests/test_evidence_timeline.py`

- [x] S2 `session-decompose.py` 增 `--expect-models <json>`：以 `importlib` 载 `alias_of` 归一各 agent 实际模型，按阶段映射角色（Implement/Fix→executor · Review→reviewer · Finalize→integrator）逐条对账；不符 → ❌ 行并 exit 3；不传该参数行为不变；scenarios：route-audit-flags-mismatch · route-audit-passes-on-match

## S3 接线与文档 · deps: - · verify: `python3 -m pytest -q tests/test_template_docs.py tests/test_docs_iron_rules.py`

- [x] S3 `/opsx-apply` 命令与 `openspec-apply-change` skill 同改（step 0 跑 `takeoff-gate.py` · `<main>` 取自 `session-model.py` · 失败停飞 · `--model=` 覆盖 · `.flight` 记 approval + 路由 · 收口带 `--expect-models`）；`/pr-ship` 两处评审派发同源；README / `docs/WORKFLOW_zh.md` / `template/CLAUDE.md.snippet` / 仓库根 `CLAUDE.md`（铁律 7 / 11 各加"判据不得由模型自证"）/ `install.sh`；scenarios：apply-resolves-main-model · pr-ship-resolves-main-model · docs-state-mechanical-resolution · apply-checks-approval-gate

## S4 起飞批准门禁 · deps: S1 · verify: `python3 -m pytest -q tests/test_approval_gate.py`

- [x] S4 `template/.claude/hooks/takeoff-gate.py`（CLI 模式判定人类批准证据 + 新鲜度；stdin 模式作 PreToolUse hook，命中 `openspec/changes/<name>` 的 Workflow / Agent 派发才判定，未批准 deny，异常放行）+ `hooks.json` 注册 + `/opsx-propose` 与 `openspec-propose` 硬交接收尾；scenarios：approval-gate-accepts-human-command · approval-gate-rejects-self-start · approval-gate-requires-fresh-approval · takeoff-hook-denies-unapproved-dispatch · takeoff-hook-ignores-unrelated-dispatch · propose-ends-with-handoff
