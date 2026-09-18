## ADDED Requirements

### Requirement: G2 lint / typecheck 只为本 change 新引入的问题判红
切片门禁 `gate` 与全量门禁 `final` 运行 `gate.lint` / `gate.typecheck` 时，若 `<change>/gate-baseline.json` 记录了同类基线行，SHALL 把本次输出规范化（去 ANSI、连续数字折叠为 `#`、去首尾空白、丢空行）后与基线行集比较：新增行为空 → MUST NOT 判红，只在 `warnings` 追加「既有 N 行已按基线排除」；新增行非空 → `failed` 追加 `G2 <kind>: exit N（新增 M 行）` 并只贴新增行。没有基线时行为 MUST 与现在一致（退出码非 0 即红）。
Feature: 切片不为 propose 阶段或仓库原有的问题买单
Rule: 少报优先于误报；final 与 CI 兜底

#### Scenario: gate-lint-ignores-baseline-lines
- **GIVEN** 一个已 `start` 的切片；`gate-baseline.json` 的 `lint.lines` 含 `a.ts(#,#): error TS# x` 这样的规范化行；`gate.lint` 本次退出 1 并输出 `a.ts(190,41): error TS2339 x`（只有行列号与基线不同）
- **WHEN** 运行切片门禁
- **THEN** `failed` 里没有以 `G2 lint` 开头的项
- **AND** `warnings` 含一项以 `G2 lint` 开头并含「已按基线排除」

#### Scenario: gate-lint-flags-new-lines
- **GIVEN** 同上基线，但本次 `gate.lint` 输出基线行之外还多了一行 `b.ts(3,1): error TS2304 y`
- **WHEN** 运行切片门禁
- **THEN** `ok` 为 `false`，`failed` 含一项以 `G2 lint` 开头、含「新增」并含 `b.ts`
- **AND** 该项文本不含基线里已有的 `a.ts` 行

#### Scenario: gate-without-baseline-unchanged
- **GIVEN** 同上切片，但 `gate-baseline.json` 不存在，`gate.lint` 退出 1
- **WHEN** 运行切片门禁
- **THEN** `failed` 含一项以 `G2 lint: exit 1` 开头（与判据引入前完全一致）
- **AND** `warnings` 不含「已按基线排除」

#### Scenario: final-typecheck-uses-baseline
- **GIVEN** `gate-baseline.json` 的 `typecheck.lines` 记录了两行既有错误；`gate.typecheck` 在 `final` 时退出 1 且输出只有这两行（行号漂移）
- **WHEN** 运行 `python3 .claude/hooks/slice-gate.py final --change-dir <dir>`
- **THEN** `failed` 里没有以 `G2 typecheck` 开头的项，`warnings` 含「已按基线排除」
- **AND** 若输出多出一行新错误，`failed` 含以 `G2 typecheck` 开头且含「新增」的项
