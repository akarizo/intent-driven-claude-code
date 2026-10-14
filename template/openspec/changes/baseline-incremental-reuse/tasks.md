<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1 + S3；wave 2 = S2（与 S1 同改 `slice-gate.py`）。
>
> **飞行条件**：在已安装的插件 0.13.0 上飞；只在本会话起飞；飞行中会话停在本 change 的 worktree，不要 cd。

## 切片

- [ ] S1 判定器：基线内容指纹、同一 change 增量复用、verify 按需重跑、preflight 按内容判过期、--full （deps: - · verify: `python3 -m pytest -q tests/test_baseline_incremental.py tests/test_slice_gate.py tests/test_slice_gate_reuse_preflight.py tests/test_slice_gate_final.py tests/test_slice_gate_coverage.py`）
- [ ] S2 判定器：基线池（git common dir）与跨 change 复用 （deps: S1 · verify: `python3 -m pytest -q tests/test_baseline_pool.py tests/test_baseline_incremental.py tests/test_slice_gate.py tests/test_slice_gate_reuse_preflight.py tests/test_slice_gate_final.py`）
- [ ] S3 记录与文档：timeline 标出增量基线；propose 命令与 skill、README 写明增量基线 （deps: - · verify: `python3 -m pytest -q tests/test_baseline_incremental_docs.py tests/test_timeline_render.py tests/test_template_docs.py tests/test_docs_iron_rules.py`）
