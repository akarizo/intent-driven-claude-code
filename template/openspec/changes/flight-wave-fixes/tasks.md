<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->

> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数 Given / When / Then 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3 + S4（全部并行，owns 不相交）。只有一个 wave：本次飞行跑的是 main 上现有的工作流脚本，缺陷 A 不会触发；B 的「合回后自跑 final」发生在全部切片合回之后，也不会把后续 wave 的 scenario 当失败。

## 切片

- [x] S1 slice-gate：start --expect-branch 基点祖先校验 + ship 忽略 final 之后的记账 commit （deps: - · verify: `python3 -m pytest -q tests/test_slice_gate.py tests/test_ship_verdict.py`）
- [x] S2 工作流与执行体 / integrator 契约：每个执行体按分支名校验基点 + 合回用独立返回结构、不跑 final （deps: - · verify: `python3 -m pytest -q tests/test_agents_workflow.py tests/test_ship_verdict.py`）
- [x] S3 文档：apply 命令 / skill 传分支名、回退 effort 取 frontmatter；pr-ship 与评审员取 diff 拉不到回退本地 diff （deps: - · verify: `python3 -m pytest -q tests/test_template_docs.py tests/test_agents_workflow.py tests/test_ship_verdict.py`）
- [x] S4 安装：模板 openspec/.gitignore 忽略 .flight + install.sh 安装 / 升级时幂等补行 （deps: - · verify: `python3 -m pytest -q tests/test_install.py tests/test_docs_iron_rules.py`）
