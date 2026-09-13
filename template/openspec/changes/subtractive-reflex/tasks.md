> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2（并行，owns 不相交，互无依赖）。

## S1 slice-gate G8 · deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py`

- [ ] S1 `template/.claude/hooks/slice-gate.py` 新增 `ceiling_rows(root, base)`：解析 `git diff --unified=0 <base>..HEAD` 的新增行（先判 `+++`/`---`/`@@` 文件头再判内容行），排除 `is_doc_or_config` 与 `NON_SOURCE_PREFIX`，只匹配行首注释紧跟 `ceiling:`，限制与升级路径两段 strip 后各 ≥ 4 字符，缺段 → `failed` 点名 `文件:行号`；合规行汇总进 `gate-report.md` 的「天花板」表；只接 `cmd_gate`，`cmd_final` 不动；⚠ 实现时不得写出 `# ceiling: …` 形状的说明注释（自举自触发）；scenarios：ceiling-marker-passes-gate · ceiling-missing-upgrade-path · ceiling-missing-limit · no-marker-no-gate

## S2 执行体与评审员的减法契约 · deps: - · verify: `python3 -m pytest -q tests/test_agents_workflow.py`

- [ ] S2 `template/.claude/agents/slice-executor.md` 纪律段在 TDD 之前加三条（先查已有再写 · 修在汇流处 grep 全部 caller · 切角标 `ceiling:` 天花板，措辞照切片包契约原文）；`template/.claude/agents/code-reviewer.md`「正确性」维度加「症状修复」一条，既有 7 维度与可维护性条目一条不减；`tests/test_agents_workflow.py` 只新增两个测试函数，不动既有断言；scenarios：executor-carries-subtractive-rules · reviewer-flags-symptom-fix
