<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` / `// Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S4 + S5 + S6 + S8 · wave 2 = S2 + S3 + S7。在已安装的插件 0.3.2 上飞（测量协议合入前不生效，本次 G5 仍是旧的警告语义）；飞行期间主会话停在 `.worktrees/flight-envelope-followups`（停车位）、不 cd。

## 切片

- [ ] S1 判定器：measure 子命令、measure 事件与 events 子命令、严格 XPASS （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py tests/test_ledger.py`）
- [ ] S2 G5 账本判据；start 与 gate 的 --evidence ledger、--measure-base （deps: S1 · verify: `python3 -m pytest -q tests/test_slice_gate.py`）
- [ ] S3 门禁红次数与测量统计取自账本；test-evidence 对账本模式切片让位 （deps: S1 · verify: `python3 -m pytest -q tests/test_evidence_timeline.py`）
- [ ] S4 包络补漏：解释器 -c 与 eval、换目录写法、GIT_* 环境变量、共享 config 与 fetch、Glob pattern （deps: - · verify: `python3 -m pytest -q tests/test_flight_envelope.py tests/test_flight_plugin.py`）
- [ ] S5 io.ts：在飞账本读失败判不出、measure 事件写入校验、导出事件类型表 （deps: - · verify: `python3 -m pytest -q tests/test_flight_io.py tests/test_flight_plugin.py`）
- [ ] S6 versions.ts：插件副本核对与判定器事件表核对（纯函数） （deps: - · verify: `python3 -m pytest -q tests/test_flight_versions.py tests/test_flight_plugin.py`）
- [ ] S7 接线：测量工具、起点测量、门禁的证据模式与 base、起飞核对版本、归属判不出拒写；版本 0.4.0 （deps: S5, S6 · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_io.py tests/test_flight_versions.py tests/test_flight_plugin.py`）
- [ ] S8 铁律 3、新 ADR、执行体定义与提示词、评审参考材料写明测量协议 （deps: - · verify: `python3 -m pytest -q tests/test_docs_iron_rules.py tests/test_flight_agents.py tests/test_template_docs.py tests/test_opsx_apply_engine.py`）
