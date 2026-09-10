> **TDD 适用**：本 change 含生产代码 `slice-gate.py ship`。测试落点 `tests/test_ship_verdict.py`（仓库根，不进 `template/`）。scenario ↔ 测试映射见各测试 docstring。
> **执行方式**：主会话直接实现（单切片、无并行需求），不生成 slices.json；门禁用 `python3 -m pytest -q tests` 全绿 + `compileall` + `openspec schema validate intent-driven`。

## 1. ship 子命令（scenario: ship-verdict#全绿对齐 HEAD 判 ready / 切片门禁红判 draft / final 过期判 draft / 阻断 finding 未闭环判 draft / blocked 只作说明不作裁决 / 非飞行模式直接 ready / draft 时输出 reasons 段落）

- [x] 1.1 先写 `tests/test_ship_verdict.py` 七个 ship 场景测试；验证：全部 RED（子命令不存在）
- [x] 1.2 在 `slice-gate.py` 加 `read_report_latest()` 与 `cmd_ship()`，注册 `ship` 子命令（`--change-dir`、`--markdown`）；验证：1.1 全绿，既有 `test_slice_gate.py` 不变

## 2. blocked 分类落盘（scenario: ship-verdict#工作流 blocked 条目带 kind）

- [x] 2.1 先写工作流文本测试：每处 `blocked.push` 带 `kind`，取值只有 gate / infra；验证：RED
- [x] 2.2 改 `opsx-apply.js` 四处 `blocked.push`；验证：2.1 绿，`node --check` 过

## 3. 命令与 skill 同步（scenario: ship-verdict#命令文本包含双向转换 / opsx-apply 收口写全量 review-findings 并调用 ship）

- [x] 3.1 先写文本测试：`pr-ship.md` 含 `slice-gate.py ship`、`gh pr ready`、`gh pr ready --undo`、`record pr-ready`；`opsx-apply.md` 与 skill 含 `blocked` 写入 review-findings.json、含 `slice-gate.py ship`、不含「final 未绿或有 blocked 切片」散文；验证：RED
- [x] 3.2 改 `pr-ship.md` 步骤 7 与步骤 10；改 `opsx-apply.md` 步骤 6/7 与 skill 步骤 5/6；验证：3.1 绿，既有 `test_template_docs.py` 不变
