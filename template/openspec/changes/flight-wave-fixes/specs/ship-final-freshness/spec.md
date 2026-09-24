## ADDED Requirements

### Requirement: final 之后只改记账文件的 commit 不使 final 过期
`slice-gate.py ship` 判 final 新鲜度时，若 final 行记录的 commit 不等于 HEAD，SHALL 再判：该 commit 是 HEAD 的祖先，且二者之间改动的文件全部是 change 目录下的 `timeline.md`、`gate-report.md`、`evidence.log`、`review-findings.json`、`tasks.md` 之一 → 视为新鲜，不记「final 过期」。其余情况（改了任何其他文件、记录的 commit 不存在或不是祖先）SHALL 照旧记「final 过期：记录 X，HEAD Y」。
Feature: 收口顺序本身就是 final 之后才提交记账文件
Rule: 计划、规格、代码的任何改动都让 final 失效

#### Scenario: ship-ignores-bookkeeping-commits
- **GIVEN** S1 与 final 都在 commit F 记为 ok；之后的两个 commit 只改了 change 目录的 `gate-report.md`、`timeline.md`、`tasks.md`、`evidence.log`、`review-findings.json`
- **WHEN** 运行 `slice-gate.py ship --change-dir <dir>`
- **THEN** `ready` 为 true，`reasons` 里没有「过期」，退出码为 0

#### Scenario: ship-flags-code-change-after-final
- **GIVEN** final 在 commit F 记为 ok；之后的 commit 改了源码 `src/app.py`
- **WHEN** 运行 ship
- **THEN** `ready` 为 false，`reasons` 有一条含「过期」

#### Scenario: ship-flags-plan-change-after-final
- **GIVEN** final 在 commit F 记为 ok；之后的 commit 改了 change 目录的 `slices.json`
- **WHEN** 运行 ship
- **THEN** `ready` 为 false，`reasons` 有一条含「过期」
