<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓纪律：先写失败测试（骨架已在 propose 阶段落盘：`xfail(strict=True)`），测试函数体 `# Given:` `# When:` `# Then:` 三段中文注释；`python3 -m pytest -q tests` 全绿、`python3 -m compileall -q template/.claude/hooks` 过。
> waves：W1 = S1 · W2 = S2 ∥ S3。
> ⚠ 本 change 基于 `worktree-mechanical-takeoff-gates`（PR #29）开出；合并顺序固定为 PR #29 先、本 change 后。

## 切片

- [ ] S1 phase-gate.py：阶段越界 deny + 起飞模型确认阻断 （deps: - · verify: `python3 -m pytest -q tests/test_phase_gate.py`）
- [ ] S2 hooks.json 注册 + explore / apply 命令与 skill 同改 （deps: S1 · verify: `python3 -m pytest -q tests/test_template_docs.py`）
- [ ] S3 铁律与文档：CLAUDE.md · snippet · README · WORKFLOW_zh （deps: S1 · verify: `python3 -m pytest -q tests/test_docs_iron_rules.py`）
