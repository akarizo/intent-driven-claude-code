## ADDED Requirements

### Requirement: 判定器声明能力
`slice-gate.py features` SHALL 以 0 退出，每行打印一项能力名，至少包括 `evidence-ledger-only`、`g5-per-target`、`guards`。
Feature: 用户定：判定器声明能力、插件核对（#48、#49 两次飞行都由旧判定器判而无人察觉）

#### Scenario: judges-declare-features
- **GIVEN** 本 change 合入后的 `slice-gate.py`
- **WHEN** 运行 `slice-gate.py features`
- **THEN** 退出 0
- **AND** 输出的行含 `evidence-ledger-only`、`g5-per-target`、`guards`

### Requirement: 起飞核对判定器能力
插件起飞前的判定器核对 SHALL 在 `ledger.py events` 之后运行 `slice-gate.py features`：子命令不存在（非 0 退出）时 SHALL 拒飞，原因含「判定器过旧」与「主检出」；缺少所需能力（`evidence-ledger-only`、`g5-per-target`、`guards`）中的任一项时 SHALL 拒飞，原因列出缺少的能力并含「主检出」；齐全时通过。
Feature: 零 token 的机械检查取代「起飞前记得快进主检出」

#### Scenario: takeoff-refuses-stale-judges
- **GIVEN** 三个判定器目录，`ledger.py events` 都列全了事件类型：
  - 一个的 `slice-gate.py features` 以 2 退出；
  - 一个只列出 `evidence-ledger-only`；
  - 一个列出全部三项
- **WHEN** 分别运行 `checkJudges`
- **THEN** 前两个不通过：第一个的原因含「判定器过旧」与「主检出」，第二个的原因含 `g5-per-target`、`guards` 与「主检出」
- **AND** 第三个通过
