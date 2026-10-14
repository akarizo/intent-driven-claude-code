<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3。`flight-dispatch-followups` 合入前后都可起飞（处理见 design Risks）；起飞前 `/reload-plugins` 并确认插件版本。

## 切片

- [ ] S1 插件：artifact_files 并入工件、批准带计数、工件之外拒绝给出路 （deps: - · verify: `python3 -m pytest -q tests/test_flight_artifact_files.py tests/test_flight_takeoff_commit.py tests/test_flight_land.py tests/test_flight_orchestrator.py tests/test_flight_resume.py tests/test_flight_armed.py tests/test_flight_plugin.py`）
- [ ] S2 判定器与审批面板：lint 校验 artifact_files，spec.html 列出声明文件 （deps: - · verify: `python3 -m pytest -q tests/test_artifact_files_plan.py tests/test_slice_gate.py tests/test_spec_html.py`）
- [ ] S3 文档与版本：apply / propose 命令与 skill、schema、README 写明 artifact_files；插件 0.10.4 （deps: - · verify: `python3 -m pytest -q tests/test_artifact_files_docs.py tests/test_takeoff_commit_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
