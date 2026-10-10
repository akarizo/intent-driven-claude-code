## ADDED Requirements

### Requirement: final 新鲜度放行任一 change 的记账文件
`slice-gate.py ship` 判定 final 是否过期时，final 记录的提交到 HEAD 之间，若只改了**同一 changes 根目录下任一 change** 的记账文件，SHALL 仍判 final 新鲜。记账文件为 timeline.md、gate-report.md、evidence.log、review-findings.json、tasks.md、slices/_interfaces.md。改了其他任何文件，SHALL 判过期。
Feature: 一个分支上有两个 change 时，记录提交不该互相让对方的 final 过期（PR #39 实测）

#### Scenario: final-fresh-ignores-other-change-bookkeeping
- **GIVEN** 同一仓库的 changes 目录下有 a、b 两个 change，a 的 final 记在提交 X 且 ok
- **AND** X 之后的一次提交只改了 b 的 gate-report.md 与 timeline.md
- **WHEN** 对 a 运行 `slice-gate.py ship`
- **THEN** reasons 里没有「过期」
- **BUT** 之后再有一次提交改了 `src/x.py` 时，对 a 运行 ship，reasons 含「过期」

#### Scenario: final-fresh-ignores-interfaces-summary
- **GIVEN** change a 的 final 记在提交 X 且 ok
- **AND** X 之后的一次提交只改了 a 的 `slices/_interfaces.md`
- **WHEN** 对 a 运行 `slice-gate.py ship`
- **THEN** reasons 里没有「过期」
