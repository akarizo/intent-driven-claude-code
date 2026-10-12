<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4 · wave 2 = S5（依赖 S4：全新安装不再带 pr-ship / code-reviewer）。在已安装的插件 0.6.0 上飞；主检出须在 5a9064e（判定器带 features）。起飞入口靠本仓库根目录 `.claude/commands/opsx-apply.md` 软链；落地交接照旧失败，由主会话手动走 pr-ship。飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd，只在本会话起飞。

## 切片

- [ ] S1 /opsx-apply 注册加拦截；写账本的入口只认人或宿主程序（composer · bridge · sdk） （deps: - · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_takeoff_commit.py tests/test_flight_plugin.py`）
- [ ] S2 落地交接 /flight:pr-ship（--worktree · --change-dir · --judges）；0.7.0 （deps: - · verify: `python3 -m pytest -q tests/test_flight_landing.py tests/test_flight_plugin.py`）
- [ ] S3 派发守卫放行主会话派发 flight:code-reviewer（仍须 model） （deps: - · verify: `python3 -m pytest -q tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [ ] S4 pr-ship 与 code-reviewer 迁入插件（参数化路径、flight:code-reviewer）；apply 命令与 skill 指向 /flight:pr-ship 并写明来源规则 （deps: - · verify: `python3 -m pytest -q tests/test_code_reviewer_agent.py tests/test_template_docs.py tests/test_ship_verdict.py tests/test_docs_iron_rules.py tests/test_retire_workflow_docs.py tests/test_measure_followups_docs.py tests/test_flight_interaction_docs.py tests/test_opsx_apply_engine.py tests/test_flight_plugin.py`）
- [ ] S5 安装器列出已迁入插件的旧副本；README · WORKFLOW · legacy skill · CLAUDE.md 改用 /flight:pr-ship 与 flight:code-reviewer （deps: S4 · verify: `python3 -m pytest -q tests/test_flight_entry_docs.py tests/test_install.py tests/test_docs_iron_rules.py tests/test_retire_workflow_docs.py`）
