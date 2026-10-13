## ADDED Requirements

### Requirement: 判定器在飞行中不写记录
`slice-gate.py` 的 `gate`、`final`、`baseline` SHALL 只打印 JSON（`baseline` 另写 `gate-baseline.json`），SHALL NOT 创建或改动 `timeline.md`、`gate-report.md`，SHALL NOT 写 `.openspec-slice`。`start`、`record` 子命令 SHALL 不存在。`features` SHALL 含 `ledger-records`。
Feature: 用户定（2026-10-13）：D1-A 账本为唯一事实

#### Scenario: judges-write-no-records
- **GIVEN** 一个单片计划（S1）的仓库，change 目录里没有 `timeline.md` 与 `gate-report.md`，S1 的 verify 通过
- **WHEN** 依次运行 `slice-gate.py baseline`、`slice-gate.py gate S1 --base <HEAD>`、`slice-gate.py final`
- **THEN** 三次运行都打印 JSON
- **AND** change 目录里仍没有 `timeline.md` 与 `gate-report.md`
- **AND** 仓库根没有 `.openspec-slice`

### Requirement: base 子命令取代 start
`slice-gate.py base <S> --change-dir <D> [--base <X>] [--expect-branch <B>]` SHALL 只读：成功时 SHALL 打印 `{"slice": S, "base": <X 或 HEAD>}` 并退出 0；带 `--expect-branch` 且 G0 不过时 SHALL 打印 `ok` 为 false、`failed` 含「G0 base」的 JSON 并退出 1。它 SHALL NOT 写任何文件。
Feature: 用户定（2026-10-13）：D1-A 门禁的区间起点由插件传参

#### Scenario: base-replaces-start
- **GIVEN** 仓库在分支 `worktree-demo`，HEAD 为 H；另有分支 `ahead`，其 tip 不是 H 的祖先
- **WHEN** 分别运行 `base S1 --expect-branch worktree-demo`、`base S1 --base X1`、`base S1 --expect-branch ahead`、`start S1`、`record --json {}`、`features`
- **THEN** 第一次退出 0，打印 `{"slice": "S1", "base": H}`
- **AND** 第二次打印的 base 为 X1
- **AND** 第三次退出 1，failed 含「G0 base」
- **AND** `start` 与 `record` 都以 argparse 错误退出 2
- **AND** `features` 的输出含 `ledger-records`
- **AND** 以上运行后，工作区的 `git status --porcelain` 为空

### Requirement: 门禁的区间起点必须显式给出
`slice-gate.py gate` 与 `slice-gate.py measure` SHALL 要求 `--base`，缺省时 SHALL 以非 0 退出且不运行任何检查；仓库里遗留的 `.openspec-slice` SHALL 被忽略。
Feature: 用户定（2026-10-13）：D1-A `.openspec-slice` 标记退役

#### Scenario: gate-requires-explicit-base
- **GIVEN** 仓库根有一个遗留的 `.openspec-slice`，内容为 `{"slice": "S1", "base": <HEAD>, "change_dir": <D>}`
- **WHEN** 运行不带 `--base` 的 `gate S1` 与 `measure S1`
- **THEN** 两次都以非 0 退出，stderr 含 `--base`
- **AND** S1 的 verify 命令没有被运行
- **AND** `.openspec-slice` 原样保留

### Requirement: 落地记录从账本生成
`timeline.py render --change-dir <D>` SHALL 从账本与 `gate-baseline.json` 整份重写 `timeline.md` 与 `gate-report.md`，格式见 design D2；SHALL 幂等；账本读不出时 SHALL 退出 1 且不写任何文件。`timeline.py record` SHALL 不存在。
Feature: 用户定（2026-10-13）：D1-A 落地时由插件从账本一次生成记录

#### Scenario: render-records-from-ledger
- **GIVEN** change 目录的 `gate-baseline.json` 记 `at` 为 T0、test exit 0、111.2 秒、ok
- **AND** 账本依次有：approve、takeoff（attempt 1、主模型 opus）、S1 执行体派发、S1 的 measure（目标 2 个、红 2 个）、S1 gate red（failed「G1 verify: exit 1」）、S1 gate ok（warnings「w1」，ceilings 一条 `["src/a.py", 3, "上限", "升级条件"]`）、S1 merge ok、S1 review（1 条 HIGH）、final ok（warnings「G2 预存红」）、land ready
- **AND** change 目录已有一份手写的 `timeline.md`（内容为「junk」）
- **WHEN** 连续运行两次 `timeline.py render`
- **THEN** 两次都退出 0，stdout 的 events 为 10
- **AND** `timeline.md` 首行是生成说明的注释，其后第一行为 baseline（备注 `exit 0, 111.2s ok`），再往后 10 行的事件列依次为 approve、takeoff、dispatch、measure、gate、gate、merge、review、final、land，且不含「junk」
- **AND** `gate-report.md` 的门禁表恰有 3 行，依次为 S1 red、S1 ok（warnings 列为 `w1`）、final ok（warnings 列为 `G2 预存红`）
- **AND** 天花板表含 `src/a.py:3`
- **AND** 第二次运行后，两个文件与第一次逐字节相同

#### Scenario: report-reads-ledger
- **GIVEN** change 目录没有 `timeline.md`
- **AND** 账本有：approve（10:00:00）、takeoff、S1 执行体派发（10:01:00）、S1 gate ok（10:07:00）、final red、final ok、land（10:20:00）、ship（10:30:00）、一条 diag
- **WHEN** 运行 `timeline.py report`，再运行 `timeline.py record approve --change-dir <D>`
- **THEN** report 的输出含「批准 → apply 完成：20.0 min」「批准 → PR 打开：30.0 min」「切片 S1：派发 → 门禁绿 6.0 min」「门禁红次数：1（账本：切片门禁 0 · final 1）」「诊断：1 条」
- **AND** `record` 以 argparse 错误退出 2，change 目录仍没有 `timeline.md`

### Requirement: 账本认识 diag 事件
`ledger.py` SHALL 接受 `diag` 事件，必填 `attempt`（整数）、`where`（非空字符串）、`error`（字符串）；`ledger.py events` SHALL 列出 `diag`。
Feature: 用户定（2026-10-13）：D4 第 5 项「python3 aborted」先留证据

#### Scenario: ledger-knows-diag-event
- **GIVEN** 账本已有一条 takeoff
- **WHEN** 追加 `diag {attempt: 1, where: "SubagentStop", error: "aborted", kind: "timeout", budget: 10000}`，运行 `ledger.py show` 与 `ledger.py events`；再在另一个账本追加缺 `where` 的 diag 并运行 show
- **THEN** 第一次 show 退出 0，并打印那条 diag
- **AND** events 含 `diag`
- **AND** 第二个账本的 show 以非 0 退出，原因含 `where`

### Requirement: 飞行 worktree 不写 evidence.log
`test-evidence.py` SHALL 在 git toplevel 的当前分支以 `flight/` 开头时不写 `evidence.log`，SHALL NOT 读 `.openspec-slice`。
Feature: 用户定（2026-10-13）：D1-A 标记退役后，飞行识别改看分支

#### Scenario: evidence-skips-flight-branches
- **GIVEN** 仓库甲在分支 `flight/demo/S1`，有 `openspec/changes/demo`（tasks.md 有未勾项）
- **AND** 仓库乙在分支 `worktree-demo`，有同样的 change，根目录另有一个写明 `evidence: "ledger"` 的遗留 `.openspec-slice`
- **AND** 两边都是跑 pytest、输出「1 passed」的 Bash 载荷
- **WHEN** 分别运行 `test-evidence.py`
- **THEN** 甲的 change 目录没有 `evidence.log`
- **AND** 乙的 `evidence.log` 恰好新增一行

### Requirement: 落地时先记 land，再生成并提交记录
落地 SHALL 依次：跑 ship 并写 `review-findings.json`、勾选 `tasks.md` → 追加 land 事件 → 在 change worktree 运行 `timeline.py render` → 以 `chore(flight): 收口` 提交记录 → 打印飞行记录 → 交接 `/flight:pr-ship`。生成或提交失败 SHALL NOT 改变 verdict，SHALL 记入飞行记录并 toast。合回（切片、解冲突、修复）SHALL NOT 调用 `slice-gate.py record` 或 `timeline.py record`。final 事件 SHALL 带门禁 JSON 的 warnings。
Feature: 用户定（2026-10-13）：D1-A

#### Scenario: land-renders-records
- **GIVEN** S1 已合回、评审为空列表；final 输出 ok true，warnings 为「G2 预存红」；全量评审员 W 以空列表返回；slice-gate ship 为 ready
- **AND** 另一个世界与之相同，但 `timeline.py render` 以 1 退出，stderr 为「boom」
- **WHEN** 分别推进飞行到落地
- **THEN** 世界一的调用顺序为：slice-gate ship → 账本追加 land → `timeline.py render --change-dir <D>`（cwd 为 change worktree）→ git commit `chore(flight): 收口`（提交的路径含 `timeline.md`、`gate-report.md`、`review-findings.json`、`tasks.md`）→ 打印飞行记录 → 运行 `/flight:pr-ship`
- **AND** 世界一账本里的 final 事件 warnings 为 `["G2 预存红"]`
- **AND** 两个世界都没有任何 `timeline.py record` 或 `slice-gate.py record` 调用
- **AND** 世界二的账本末条为 land（verdict ready），飞行记录含「落地记录生成失败：boom」，toast 含「落地记录生成失败」，且仍运行了 `/flight:pr-ship`

#### Scenario: merges-write-no-records
- **GIVEN** 切片 S1 的分支可干净合并；修复分支 `flight/demo/fix-r1` 可干净合并
- **WHEN** 合回 S1（via branch），再以 `mergeFix(io, f, 'blocking=1', undefined, 'fix-r1')` 合回修复
- **THEN** 两次都返回 ok 与 HEAD
- **AND** 全程没有 `slice-gate.py record` 与 `timeline.py` 调用

### Requirement: 起飞不写 timeline
首次起飞 SHALL NOT 调用 `timeline.py`，SHALL NOT 提交 `chore(flight): approve`；takeoff 事件照常写入账本。
Feature: 用户定（2026-10-13）：D1-A

#### Scenario: takeoff-writes-no-timeline
- **GIVEN** change demo 已批准（账本有 approve，指纹匹配），从未起飞，工作区干净
- **WHEN** 人发 `/opsx-apply demo`
- **THEN** 回复以「✈ 起飞 demo」开头，账本新增 takeoff（attempt 1）
- **AND** 没有任何 `timeline.py` 调用
- **AND** 没有 message 为 `chore(flight): approve` 的 git commit

### Requirement: 起飞核对 ledger-records
`REQUIRED_FEATURES` SHALL 含 `ledger-records`；判定器的 `features` 缺它时 SHALL 拒绝起飞并点名。
Feature: 用户定（2026-10-13）：沿用 #50 的判定器能力核对

#### Scenario: judges-need-ledger-records
- **GIVEN** 判定器 `slice-gate.py features` 的输出为除 `ledger-records` 外的全部能力
- **WHEN** 起飞核对判定器
- **THEN** 核对失败，原因含 `ledger-records`
- **AND** 导出的 `REQUIRED_FEATURES` 含 `ledger-records`
