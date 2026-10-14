<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` / `// Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1。
>
> **飞行条件**：在已安装的插件 0.13.0 上飞；只在本会话起飞；飞行中会话停在本 change 的 worktree，不要 cd。注意：本 change 修的正是 0.13.0 的续派缺陷，S1 首个执行体门禁红后的续派仍会受它影响，执行体须在第一次收口前自己跑一遍 verify 确认全绿。

## 切片

- [ ] S1 插件：同一 attempt 内续派执行体沿用首个执行体的起点；插件 0.13.1 （deps: - · verify: `python3 -m pytest -q tests/test_flight_redispatch_base.py tests/test_flight_plugin.py tests/test_flight_plugin_suite.py tests/test_flight_core.py tests/test_flight_orchestrator.py tests/test_flight_resume.py`）
