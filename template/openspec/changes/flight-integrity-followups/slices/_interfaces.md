# 公开接口摘要

## S1 · template/.claude/hooks/slice-gate.py
- `_g7_runner(gate) -> (argv_prefix, warning|None)`：gate.pytest > 由 gate.test 推导 > 退回 sys.executable -m pytest
- `_g7_timeout(gate) -> 秒数`：FLIGHT_G7_TIMEOUT > max(120, 3*full_suite_sec) > 600
- `_pytest_outcomes(root, targets, gate=None) -> (outcomes, rc, out_text, timed_out)`
- `_g7_diag(text)`：取诊断行（截断 200 字符）
- `scenario_status(root, data, slice_ids=None) -> (violations, total, passed, warnings)`

## S2 · template/.claude/workflows/opsx-apply.js
- `export const meta`：工作流元信息；integrator / final-gate 抛错重派一次，评审员抛错只记录
