<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1。0.3.1 的第一次实战（冒烟）：飞行期间主会话停在作废的 `.worktrees/flight-envelope-followups`、不 cd；执行体开工先跑探针 `pwd && git rev-parse --abbrev-ref HEAD`。

## 切片

- [x] S1 重复批准同样预填起飞命令；版本 0.3.2 （deps: - · verify: `python3 -m pytest -q tests/test_flight_plugin.py`）
