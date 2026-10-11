<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4。在已安装的插件 0.4.1 上飞，本 change 由主检出的旧判定器（整片 G5）判、不使用 `guards`；执行体照新规矩先写全部测试、测一次红再实现。飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd，只在本会话起飞。

## 切片

- [ ] S1 slice-gate：G5 逐目标先红、护栏须起点已通过；lint 校验 guards；measure 输出列出护栏目标 （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py tests/test_slice_gate_final.py tests/test_slice_gate_reuse_preflight.py`）
- [ ] S2 envelope：命令名与 git 词先做 shell 去引号；命令名位置的展开判为无法判定 （deps: - · verify: `python3 -m pytest -q tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [ ] S3 core / prompts / measure.ts：续接只认同一 agent 的门禁；提示词禁止造红；测量回复提示非护栏目标提前通过；版本 0.4.2 （deps: - · verify: `python3 -m pytest -q tests/test_flight_core.py tests/test_flight_agents.py tests/test_flight_orchestrator.py tests/test_flight_plugin.py`）
- [ ] S4 审批页标出护栏；schema、/opsx-propose、/opsx-continue 与同名 skill、执行体定义、测量协议 ADR 写明护栏规则 （deps: - · verify: `python3 -m pytest -q tests/test_measure_strict_docs.py tests/test_spec_html.py tests/test_template_docs.py tests/test_docs_iron_rules.py tests/test_agents_workflow.py tests/test_takeoff_commit_docs.py tests/test_flight_agents.py`）
