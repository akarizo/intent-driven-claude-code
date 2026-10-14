<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` / `// Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1 + S2。
>
> **飞行条件**：在已安装的插件 0.12.0 上飞；只在本会话起飞；飞行中会话停在本 change 的 worktree，不要 cd。

## 切片

- [ ] S1 插件：读出诊断结论、诊断为改计划即计划缺陷、交主会话修订计划 （deps: - · verify: `python3 -m pytest -q tests/test_flight_replan_handoff.py tests/test_flight_plugin.py tests/test_flight_plugin_suite.py tests/test_flight_orchestrator.py tests/test_flight_core.py tests/test_flight_resume.py tests/test_flight_plan_defect_band.py`）
- [ ] S2 文档与版本：命令与 skill 写明诊断为改计划时交主会话修订，README 同步；插件 0.13.0 （deps: - · verify: `python3 -m pytest -q tests/test_replan_handoff_docs.py tests/test_premerge_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
