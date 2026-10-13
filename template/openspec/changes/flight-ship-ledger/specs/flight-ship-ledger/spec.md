## ADDED Requirements

### Requirement: ship 只从账本裁决
`slice-gate.py ship --change-dir <dir>` SHALL 只读账本 `refs/flight/<change>/ledger`、`slices.json` 与 git，SHALL NOT 读 `gate-report.md` 与 `review-findings.json`，SHALL NOT 写 `timeline.md`。判据 SHALL 按 design D3 的表依次累积 reasons；任一条成立即判 draft（退出 1），全不成立即判 ready（退出 0）。stdout SHALL 为 JSON `{ready, commit, reasons, blocked, blocking, deferred, fix, review}`；`--markdown` SHALL 照旧打印 reasons 与 blocked 段落。
Feature: 已定（2026-10-13）：ship 只读账本

#### Scenario: ship-ignores-record-files
- **GIVEN** 两个仓库，账本都有 takeoff（attempt 1，model opus）、S1 的 ok merge、final ok（commit 为 HEAD）、全量评审员派发（slice whole，commit 为 HEAD）
- **AND** 仓库甲的 whole review 没有 finding，但 change 目录的 `gate-report.md` 写 S1 红，`review-findings.json` 的 blocking 有 1 条 HIGH
- **AND** 仓库乙的 whole review 有 1 条 HIGH，两个文件都写全绿、blocking 为空
- **WHEN** 分别运行 `slice-gate.py ship --change-dir`
- **THEN** 甲退出 0，JSON 的 ready 为 true、reasons 为空
- **AND** 乙退出 1，reasons 含「1 条 CRITICAL/HIGH 评审未闭环」，blocking 恰为那条 HIGH
- **AND** 两次运行后 `timeline.md` 都没有被改动

### Requirement: blocking 取全量评审最新一轮
本 attempt 有全量评审（slice 为 `whole`、`whole-r1`、`whole-r2` 的 review 事件）时，blocking SHALL 取最新一轮 review 的 CRITICAL/HIGH，并 SHALL 加上路由对账的 HIGH。没有全量评审时，SHALL 取全部切片评审的 CRITICAL/HIGH。合回了第 j 轮修复却没有 `whole-r<j>` 的 review 时，SHALL 判 draft，reason 为「第 j 轮修复未经复核」；有 blocked `review:whole*` 且同轮没有 review 时，SHALL 判 draft，reason 含「全量评审未返回」。
Feature: 用户定（2026-10-13）：C1-A · C2-A

#### Scenario: ship-follows-latest-whole-round
- **GIVEN** 四份账本，都有 takeoff、S1 的 ok merge，且最新 final ok 的 commit 为 HEAD：
  - 甲：whole 有 1 条 HIGH，fix-r1 合回 ok，whole-r1 没有 finding（复核员派发的 commit 为 HEAD）；
  - 乙：同甲，但 whole-r1 有 1 条 HIGH；
  - 丙：whole 有 1 条 HIGH，fix-r1 合回 ok，没有 whole-r1；
  - 丁：只有 blocked `review:whole`（infra），没有任何 whole review
- **WHEN** 分别运行 ship
- **THEN** 甲 ready
- **AND** 乙 draft，reasons 含「1 条 CRITICAL/HIGH 评审未闭环」
- **AND** 丙 draft，reasons 含「第 1 轮修复未经复核」
- **AND** 丁 draft，reasons 含「全量评审未返回」

### Requirement: 路由对账与评审新鲜度
每条 ended 事件的实际模型 SHALL 包含该 attempt 起飞时的主模型（不区分大小写），否则 blocking SHALL 增加一条 HIGH，`file` 为 `routing`、`line` 为 0、summary 含「路由不符」。最新一轮全量评审派发时记下的 commit，既不是 HEAD、也不满足「之后只有记账改动」时，SHALL 判 draft，reason 含「全量评审过期」。
Feature: 铁律 11 · 已定（2026-10-13）：ship 只读账本

#### Scenario: ship-checks-routing-and-review-freshness
- **GIVEN** 两份账本，其余全绿，whole review 没有 finding：
  - 甲：起飞主模型 opus，一条 ended 事件的 model 为 `claude-sonnet-5-5`；
  - 乙：whole 派发的 commit 为 X，X 之后有一次改了 `src/a.py` 的提交，最新 final ok 记在新 HEAD
- **WHEN** 分别运行 ship
- **THEN** 甲 draft，blocking 恰有一条 `file` 为 `routing`、`line` 为 0、summary 含「路由不符」的 HIGH
- **AND** 乙 draft，reasons 含「全量评审过期」

### Requirement: 判定器认识 ship 事件并声明能力
`ledger.py` SHALL 认识 ship 事件（必需字段 attempt、pr（非空字符串）、verdict（ready / draft）、commit（字符串）），`ledger.py events` SHALL 列出 ship。`slice-gate.py features` SHALL 列出 `ship-ledger`。`timeline.py report` 的「批准 → PR 打开」SHALL 优先取账本里第一条 ship 事件的时间；没有 ship 事件时照旧取 timeline 的 pr-open 行。
Feature: 已定（2026-10-13）：ship 事件进账本

#### Scenario: judges-know-ship-event
- **GIVEN** 一个 change，timeline.md 有 10:00:00 的 approve 行、没有 pr-open 行；账本有 takeoff 与一条 10:30:00 的 ship 事件（pr 为 `https://x/pull/7`、verdict 为 ready）
- **WHEN** 运行 `ledger.py events`、`ledger.py show`、`slice-gate.py features` 与 `timeline.py report`
- **THEN** events 含 ship；show 退出 0 并打印那条 ship 事件
- **AND** features 含 ship-ledger
- **AND** report 含「批准 → PR 打开：30.0 min」

### Requirement: final 复用修复轮的门禁
`slice-gate.py final --reuse-fix` SHALL 把 slice 为 `fix` 或 `fix-r<k>` 的 gate 事件都当作修复门禁，取其中最后一条判断能否复用。
Feature: 用户定（2026-10-13）：C2-A 修复轮

#### Scenario: final-reuses-fix-round-gate
- **GIVEN** 账本最后一条修复门禁是 slice `fix-r1` 的 gate，ok、commit 为 F；F 之后只有记账改动
- **WHEN** 运行 `slice-gate.py final --change-dir --reuse-fix`
- **THEN** 退出 0，warnings 含「复用修复门禁」与 F 的前 10 位，没有跑全量测试
