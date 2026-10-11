<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4 · wave 2 = S5。在已安装的插件 0.4.0 上飞，这是**测量协议的首飞**：执行体先让 scenario 测试红并调用 `measure`，G5 按账本判定；飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd，只在本会话起飞。

## 切片

- [x] S1 包络余项：带路径或引号的前缀、目录参数里的 shell 展开、中性的拒绝理由 （deps: - · verify: `python3 -m pytest -q tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [x] S2 core：续接只限同一份计划；dispatch 记分支、agentOf 返回分支 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py tests/test_flight_plugin.py`）
- [x] S3 io / land：freshWorktree 另起 worktree；合回、解冲突、修复合回按传入的分支 （deps: - · verify: `python3 -m pytest -q tests/test_flight_io.py tests/test_flight_land.py tests/test_flight_plugin.py`）
- [x] S4 提示词给出上一次的分支；pr-ship 预合并改用 merge-tree --write-tree；opsx-apply 与 skill 写明 --takeover 与另起 worktree （deps: - · verify: `python3 -m pytest -q tests/test_measure_followups_docs.py tests/test_flight_agents.py tests/test_template_docs.py tests/test_opsx_apply_engine.py`）
- [x] S5 接线：派发另起 worktree 并按记下的分支合回、修复体与解冲突同理、跨会话拒飞与 --takeover、测量判不出的提示；版本 0.4.1 （deps: S2, S3, S4 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_landing.py tests/test_flight_land.py tests/test_flight_plugin.py`）
