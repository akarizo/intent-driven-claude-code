<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->

> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1（单片）。

## 切片

- [ ] S1 install.sh 对 openspec/ 只下发种子，并列出疑似旧版误拷的开发工件 （deps: - · verify: `python3 -m pytest -q tests/test_install.py`）
