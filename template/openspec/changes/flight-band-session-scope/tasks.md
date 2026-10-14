<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` / `// Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1 + S2，owns 互不相交，并行。
>
> **飞行条件**：
> - 在已安装的插件 0.10.3 上飞，主检出须在 `4cbff0d` 或更新；
> - 只在本会话起飞；起飞前会话停在本 change 的 worktree，飞行中不要 cd。

## 切片

- [ ] S1 批准带会话认领：写入与人发命令即认领，refresh 只评估已认领的 change （deps: - · verify: `python3 -m pytest -q tests/test_flight_band_scope.py tests/test_flight_plugin.py tests/test_flight_resume.py tests/test_flight_orchestrator.py tests/test_flight_takeoff_commit.py tests/test_flight_armed.py`）
- [ ] S2 文档写明本会话认领，发布 0.11.0 （deps: - · verify: `python3 -m pytest -q tests/test_band_session_scope_docs.py tests/test_dispatch_followups_docs.py tests/test_dispatch_origin_docs.py tests/test_armed_followups_docs.py tests/test_armed_docs.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_takeoff_commit_docs.py tests/test_measure_strict_docs.py`）
