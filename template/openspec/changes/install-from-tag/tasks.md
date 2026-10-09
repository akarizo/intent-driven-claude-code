<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->

> 切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1（单片）。

## 切片

- [x] S1 install.sh pipe 模式认 tag 并交给归档自带的 install.sh + README 安装指定版本 （deps: - · verify: `python3 -m pytest -q tests/test_install.py`）

## R PR #38 review 修复 · 2026-10-09 用户授权追加（不在切片计划内；来源：PR #38 评审与 S1 切片评审的 MEDIUM）

- [x] R0 交接前校验归档里有 `template/`：缺失则 `[err]` 并以 4 退出、不交接，防止子进程判不出本地模式而无界递归下载；spec「pipe 模式交给该版本自带的 install.sh」补 scenario `pipe-archive-without-template-exits-4`，design D4 同步（ee37dd1）
