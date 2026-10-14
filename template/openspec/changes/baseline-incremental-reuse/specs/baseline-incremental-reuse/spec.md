## ADDED Requirements

### Requirement: 基线记录内容指纹
`slice-gate.py baseline` 结束时 SHALL 在 `gate-baseline.json` 写入：
- `mode`（`full` 或 `incremental`）；
- `snapshot`：基线结束时工作区相对 HEAD 的未提交改动，路径映射到 git blob id，删除为 null。不含字节码与 `.pytest_cache`；不含本 change 的计划工件，即 proposal.md、design.md、tasks.md、slices.json、spec.html、gate-baseline.json、.openspec.yaml、记账文件、`specs/` 与 `slices/`；
- `cmd_key`：全量命令指纹。取 `gate.test` 文本，把本 change 目录相对路径换成占位符 `<change>`，再加上命令里每个指向仓库内已存在文件的词所对应的文件内容（只算命令里直接写出的仓库内文件，不追踪它 source / import 的文件，仓外文件如解释器不计）；
- 每片 verify 的 `exit` 与 `cmd`。

基线运行期间（开始与结束各取一次快照对比），运行开始时就存在的文件（已跟踪或未跟踪）或测试文件内容有变 → 基线 SHALL 判红，原因含「重跑 baseline」。运行期间新出现的非测试文件 SHALL 只记一条警告，并照常记入 `snapshot`。

#### Scenario: baseline-records-snapshot
- **GIVEN** change `c` 的计划已提交；工作区里未跟踪的 `tests/test_new.py` 含一个 strict-xfail 用例；`gate.test` 是本 change 目录下的全量脚本
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 0；`gate-baseline.json` 的 `mode` 为 `full`
- **AND** `snapshot` 含 `tests/test_new.py`，值等于该文件的 `git hash-object`；不含 `slices.json`
- **AND** `cmd_key` 为非空字符串，`verify.S1.cmd` 等于 S1 的 verify 命令

#### Scenario: baseline-red-when-tracked-file-edited-while-running
- **GIVEN** `gate.test` 运行时会改写已跟踪的 `src/mod.py`
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出非 0；`reasons` 有一项同时含 `src/mod.py` 与「重跑 baseline」

#### Scenario: baseline-tolerates-new-byproduct
- **GIVEN** `gate.test` 运行时在仓库里新建未跟踪的 `out/report.txt`
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 0；`warnings` 有一项含 `out/report.txt`
- **AND** `snapshot` 含 `out/report.txt`

### Requirement: 只改测试文件时复用全量
有可复用的全量结果时，`slice-gate.py baseline` SHALL 不跑 `gate.test`，改走增量。

差异 Δ 的定义：
- 按内容比较 → 候选所测的代码树（候选 commit 加上候选的 `snapshot`）与当前代码树（HEAD 加上工作区）；
- 不计 → 字节码、`.pytest_cache`、`<changes 根>/**`；
- 例外 → 候选来自本 change 时，本 change 目录里计划工件以外的文件照计。

复用条件（全部满足）：
- 候选基线 ok，且测试结果可度量（exit 0，或记有 `test.failed`）；
- `cmd_key` 与当前相同；
- 候选 commit 是当前 HEAD 的祖先；
- 没有给 `--full`；
- Δ 里的路径全是文件名匹配 `test_*.py` 的文件；
- 候选 `test.failed` 里没有哪条的 classname 以点分段后含 Δ 中某个测试文件的文件名主干；
- Δ 里现存的测试文件用 `gate.pytest` 前缀补跑一次，没有 FAILED / ERROR、没有超时，退出码为 0 或 5。

复用时：
- `test` 沿用候选的 `exit`、`sec`、`failed`；
- 记 `mode: incremental` 与 `incremental: {from: {change, commit, at}, files, sec}`；
- lint / typecheck 照跑；
- 不改已有的 `gate.full_suite_sec`；本 change 还没有时，写入候选的 `test.sec`。

任一条件不满足 → 跑全量，`mode: full`。

#### Scenario: incremental-when-only-test-file-changed
- **GIVEN** change `c` 已有一次全量绿基线：预存红 1 条，在 `tests/test_old.py`；之后只往 `tests/test_cap.py` 末尾追加一个 strict-xfail 用例；`gate.lint` 运行时会写一个标记文件
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** 退出 0；`gate.test` 没有运行（全量标记文件不存在）；lint 标记文件存在
- **AND** `mode` 为 `incremental`，`incremental.files` 等于 `["tests/test_cap.py"]`，`incremental.from.change` 为 `c`
- **AND** `test.failed` 与第一次相同；`slices.json` 的 `gate.full_suite_sec` 与第一次相同

#### Scenario: incremental-noop-when-only-plan-changed
- **GIVEN** change `c` 已有一次全量绿基线；之后只改了本 change 的 proposal.md、`specs/` 下的 spec.md 与 `slices/S1.md`
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** 退出 0；`gate.test` 没有运行；`mode` 为 `incremental`，`incremental.files` 为空列表

#### Scenario: full-when-non-test-file-changed
- **GIVEN** change `c` 已有一次全量绿基线；之后改了 `src/mod.py`
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** `gate.test` 运行了；`mode` 为 `full`

#### Scenario: full-when-changed-test-file-fails
- **GIVEN** change `c` 已有一次全量绿基线；之后往 `tests/test_cap.py` 追加一个会失败的用例（不带 xfail）
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** `gate.test` 运行了；`mode` 为 `full`；`test.failed` 含新用例

#### Scenario: full-when-test-file-had-preexisting-red
- **GIVEN** change `c` 已有一次全量绿基线：预存红 1 条，在 `tests/test_old.py`；之后往 `tests/test_old.py` 追加一个通过的用例
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** `gate.test` 运行了；`mode` 为 `full`

#### Scenario: full-flag-forces-full
- **GIVEN** change `c` 已有一次全量绿基线，之后没有任何改动
- **WHEN** 运行 `slice-gate.py baseline --full`
- **THEN** `gate.test` 运行了；`mode` 为 `full`

#### Scenario: full-when-gate-script-changed
- **GIVEN** change `c` 已有一次全量绿基线；之后改了 `gate.test` 引用的本 change 目录下全量脚本的内容（命令文本不变）
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** `gate.test` 运行了；`mode` 为 `full`

### Requirement: 跨 change 复用全量
每次全量基线绿、且测试结果可度量时，`slice-gate.py baseline` SHALL 把这次结果写进基线池：git common dir 下的 `flight-baseline-pool/`，同一仓库的各 worktree 共享。每条记录含 change、commit、at、`cmd_key`、`snapshot`、`test`，按 at 最多保留最新 30 条。

选候选的顺序：
1. 本 change 现有的 `gate-baseline.json`；
2. 池里 `cmd_key` 相同的条目，按 at 由新到旧，最多看 10 条。

逐个按上一条 Requirement 的复用条件判断，取第一个满足的。

#### Scenario: cross-change-reuse-same-tree
- **GIVEN** change `c` 跑过一次全量绿基线（预存红 1 条）；同一仓库里另有 change `d`，它的全量脚本与 `c` 的内容相同、命令只差 change 目录名，`d` 还没有基线；`c` 的工件与门禁脚本都没有提交
- **WHEN** 对 `d` 运行 `slice-gate.py baseline`
- **THEN** 退出 0；`gate.test` 没有运行；`d` 的 `mode` 为 `incremental`，`incremental.from.change` 为 `c`
- **AND** `d` 的 `test.failed` 与 `c` 相同；`d` 的 `slices.json` 里 `gate.full_suite_sec` 等于 `c` 基线的 `test.sec`

#### Scenario: cross-change-reuse-after-test-only-commit
- **GIVEN** change `c` 跑过一次全量绿基线；之后提交了一个只新增 `tests/test_more.py`（用例通过）的 commit；change `d` 的全量脚本与 `c` 的内容相同
- **WHEN** 对 `d` 运行 `slice-gate.py baseline`
- **THEN** `gate.test` 没有运行；`mode` 为 `incremental`，`incremental.files` 等于 `["tests/test_more.py"]`

#### Scenario: cross-change-refused-when-script-differs
- **GIVEN** change `c` 跑过一次全量绿基线；change `d` 的全量脚本比 `c` 的多一行注释
- **WHEN** 对 `d` 运行 `slice-gate.py baseline`
- **THEN** `gate.test` 运行了；`mode` 为 `full`

#### Scenario: cross-change-ignores-sourced-files
- **GIVEN** change `c` 跑过一次全量绿基线；change `d` 的全量脚本与 `c` 的内容相同，但两者各自 source 的 `verify/_env.sh` 内容不同
- **WHEN** 对 `d` 运行 `slice-gate.py baseline`
- **THEN** `gate.test` 没有运行；`mode` 为 `incremental`，`incremental.from.change` 为 `c`

### Requirement: verify 按需重跑
增量基线 SHALL 只重跑下面这些片的 verify，其余沿用本 change 上一次基线的 `exit` 并标 `reused: true`：
- 上一次没有记录（包括候选来自别的 change）、或记录的 `cmd` 与当前不同的片；
- 命令里有路径覆盖到 Δ 中某个文件的片。命令按 shell 规则切词，每个词去掉 `::` 之后的部分；它指向已存在的路径或等于 Δ 里的路径时算路径。Δ 文件等于它、或位于它这个目录下，即为覆盖；
- 命令里一个路径都认不出的片。

全量基线照旧重跑全部 verify。

#### Scenario: verify-rerun-only-covering-slices
- **GIVEN** change `c` 有三片：S1 的 verify 只跑 `tests/test_a.py`；S2 的 verify 只跑 `tests/test_b.py`；S3 的 verify 命令里没有路径。三片的 verify 运行时各写一个自己的标记文件。已有一次全量绿基线，之后只往 `tests/test_a.py` 追加一个 strict-xfail 用例，并清掉三个标记文件
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** `mode` 为 `incremental`；S1、S3 的标记文件存在，S2 的不存在
- **AND** `verify.S2.reused` 为 true，`verify.S2.exit` 为 0

#### Scenario: verify-rerun-when-command-changed
- **GIVEN** 同上的三片与一次全量绿基线；之后只把 S2 的 verify 命令改成多带一个 `-q` 参数，并清掉三个标记文件
- **WHEN** 再运行 `slice-gate.py baseline`
- **THEN** S2 的标记文件存在；`verify.S2` 没有 `reused`

### Requirement: preflight 按内容判过期
满足下面三条时，`slice-gate.py preflight` SHALL 在原有四项校验之外按内容判过期：基线带 `snapshot`；本 change 的账本里没有 takeoff 事件；账本读不出时按没有处理。判法：以本 change 现有基线为候选求 Δ，Δ 非空 → 退出非 0，stderr 含「基线过期」，并列出至多 8 个 Δ 路径。

旧格式基线（没有 `snapshot`）与已经起飞过的 change，SHALL 保持原有四项校验。

#### Scenario: preflight-stale-when-test-file-changed-after-baseline
- **GIVEN** change `c` 有一次全量绿基线，之后往 `tests/test_cap.py` 追加了一个用例；gate 与 verify 命令都没变
- **WHEN** 运行 `slice-gate.py preflight`
- **THEN** 退出非 0；stderr 含「基线过期」与 `tests/test_cap.py`

#### Scenario: preflight-passes-after-artifact-commit
- **GIVEN** change `c` 在未跟踪的 `tests/test_new.py` 存在时跑过一次全量绿基线；之后把工作区全部提交，内容不变
- **WHEN** 运行 `slice-gate.py preflight`
- **THEN** 退出 0

#### Scenario: preflight-skips-content-check-after-takeoff
- **GIVEN** change `c` 有一次全量绿基线；账本里已有一条 takeoff 事件；之后改了 `src/mod.py` 并提交
- **WHEN** 运行 `slice-gate.py preflight`
- **THEN** 退出 0

#### Scenario: preflight-old-baseline-compatible
- **GIVEN** change `c` 的 `gate-baseline.json` 是旧格式（有 commit、ok、plan_sha，没有 snapshot），plan_sha 与当前计划一致；之后改了 `tests/test_cap.py`
- **WHEN** 运行 `slice-gate.py preflight`
- **THEN** 退出 0

### Requirement: 记录与文档写明增量基线
`timeline.py` 渲染的 baseline 行：`mode` 为 `incremental` 时 SHALL 含「增量」与复用来源 change。

`opsx-propose.md` 与 `openspec-propose/SKILL.md` 的基线步骤 SHALL 写明以下内容：
- 改完计划后重跑 `slice-gate.py baseline`，全量还是增量由脚本判定，模型不自行判断要不要重跑；
- `--full` 强制全量；
- 跨 change 复用全量结果；
- 完成后的一行报告带上模式。

README SHALL 提到基线的增量复用。

#### Scenario: timeline-marks-incremental-baseline
- **GIVEN** `gate-baseline.json` 为 `mode: incremental`，`incremental.from.change` 为 `c`，`incremental.files` 有 1 个文件
- **WHEN** 运行 `timeline.py render`
- **THEN** `timeline.md` 的 baseline 行同时含「增量」与 `c`

#### Scenario: propose-docs-describe-incremental
- **GIVEN** `template/.claude/commands/opsx-propose.md`、`template/.claude/skills/openspec-propose/SKILL.md` 与 `README.md`
- **WHEN** 读取全文
- **THEN** 前两份都含 `--full`、「增量」与「跨 change」；各有一行同时含「改完计划」与 `baseline`
- **AND** README 有一行同时含「基线」与「增量」
