## ADDED Requirements

### Requirement: wave 合回只合回，不跑全量门禁
`opsx-apply.js` 为多切片 wave 派发的合回 SHALL 使用只含合回结论的返回结构（必填 `ok` 与 `failed`，不要求门禁 JSON 的 `slice` / `commit`），prompt SHALL 明令不要运行 integrator 定义的第 3 项（全量门禁）；合回成功时 SHALL NOT 记 wave 级 blocked。`integrator.md` 的第 3 项 SHALL 写明仅当 prompt 点名时运行。
Feature: 后续 wave 的 scenario 尚未解锁，wave 级 final 必然红，不能当作合回失败
Rule: 全量门禁只在 Finalize 跑一次

#### Scenario: merge-dispatch-forbids-final
- **GIVEN** 参数 waves 为 `[[S1, S2], [S3]]`，全部切片与合回都成功
- **WHEN** 用 mock agent 驱动工作流跑完，取 wave 1 的合回派发
- **THEN** 合回派发的返回结构必填项含 `ok` 与 `failed`，不含 `slice` 与 `commit`
- **AND** 合回 prompt 含「不要运行第 3 项」
- **AND** 结果的 `blocked` 里没有以 `wave` 开头的条目

#### Scenario: integrator-final-only-when-named
- **GIVEN** `template/.claude/agents/integrator.md`
- **WHEN** 读取第 3 项「全量门禁」段
- **THEN** 该段写明仅当 prompt 点名才运行、wave 合回时不跑
- **AND** 仍给出 `slice-gate.py final` 命令
