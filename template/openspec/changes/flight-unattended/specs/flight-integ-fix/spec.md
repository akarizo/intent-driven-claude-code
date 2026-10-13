## ADDED Requirements

### Requirement: final 红时先派整合修复体
以下条件同时满足时，`closing()` SHALL 先返回 `heal`（kind `integ`，slice `integ`）：
- 全部计划切片已合回、没有 blocked；
- 本 attempt 最新 final 红且 `commit` 非空；
- 本 attempt 没有派过 slice 为 `integ` 的修复体；
- `healVerdict` 允许。

Feature: 用户定（2026-10-13）：final 红在跨片失配时，允许修复体改既有测试，但要加护栏。ship-ledger a1 就是这样被人工修好的。

账本已有这条 heal 时，SHALL 返回 `dispatch fixer`，`slice: 'integ'`、`findings: []`、`failed` 为该 final 的失败清单。任一条件不满足时，SHALL 照旧停飞，kind 为 `final`。

#### Scenario: final-red-dispatches-integ
- **GIVEN** waves `[[S1, S2]]` 全部合回、评审都无 CRITICAL/HIGH；本 attempt 最新 final 为 `{ok: false, commit: 'c9', failed: ['G2 test: exit 1（新增 3 条失败）\n…']}`；没有 heal
- **WHEN** 求 `next`；追加它返回的 heal 后再求 `next`
- **THEN** 第一次恰为 `heal {heal: 'integ', slice: 'integ'}`
- **AND** 第二次恰为派发修复体，slice 为 `integ`，findings 为空，failed 等于那条 final 的 failed
- **AND** 同样的账本若把 final 的 commit 改为空串，`next` 恰为停飞，kind 为 `final`

### Requirement: 整合修复先经专审再合回，合回后再跑 final
slice 为 `integ` 的修复体结束、收口门禁绿时，`next` SHALL 派评审员：`slice: 'integ'`、`mode: 'integ'`，范围为该修复体派发事件的 `base` 到门禁 commit。`review(integ)` 没有 CRITICAL/HIGH 时 SHALL 返回 `merge integ via fix`。integ 合回之后，若本 attempt 最新 final 早于这次合回，SHALL 返回 `final`。`review(integ)` 的 findings SHALL NOT 触发切片级修复（`fix`）。
Feature: 用户定：diff 要经复核员审；有 CRITICAL/HIGH 就停飞，不循环。

#### Scenario: integ-reviewed-before-merge
- **GIVEN** 承接 final-red-dispatches-integ：integ 修复体 fi 已派（dispatch 的 base 为 c9）、收口门禁绿（commit c10）、已 `ended`
- **WHEN** 求 `next`；追加 integ 评审员的派发与 `review {slice: 'integ', findings: [一条 MEDIUM]}` 后再求 `next`；追加 `merge {slice: 'integ', ok: true}` 后再求 `next`
- **THEN** 第一次恰为派发评审员，slice 为 `integ`、mode 为 `integ`，base 为 c9、commit 为 c10
- **AND** 第二次恰为 `merge integ via fix`，没有派发 slice 为 `fix` 的修复体
- **AND** 第三次恰为 `final`

### Requirement: 整合修复失败即停飞，每个 attempt 至多一轮
以下情况 SHALL 停飞：
- `review(integ)` 有 CRITICAL/HIGH：kind `integ`，原因含「整合修复复核未通过」；
- integ 修复体的收口门禁红用尽（与其它修复体同规则，记 `blocked integ`）：kind `integ`；
- integ 合回后最新 final 仍红：kind `final`，且 SHALL NOT 再派第二个 integ。

Feature: 用户定：整合修复至多 1 轮。

#### Scenario: integ-failures-halt
- **GIVEN** 三份承接 integ-reviewed-before-merge 的账本：
  - 甲：`review(integ)` 有 1 条 HIGH；
  - 乙：integ 修复体结束时收口门禁红，账本有 `blocked {slice: 'integ', kind: 'gate'}`；
  - 丙：integ 已合回，其后最新 final 红（commit c11）
- **WHEN** 分别求 `next`
- **THEN** 甲恰为停飞，kind 为 `integ`，原因含「整合修复复核未通过」
- **AND** 乙恰为停飞，kind 为 `integ`
- **AND** 丙恰为停飞，kind 为 `final`，没有 heal、没有派发

### Requirement: G9 整合护栏
`slice-gate.py final --integ-base <sha>` SHALL 在原有判据之外，对 `git diff <sha> HEAD` 加判 G9，失败项以 `G9 integ:` 开头并点名文件：
- **工件**：改动路径落在本 change 目录的 `proposal.md`、`design.md`、`tasks.md`、`slices.json`、`slices/`、`specs/` 下，或 `openspec/adr/` 下；
- **scenario 测试**：`scenario_tests` 映射的 pytest 函数，在 base 或 HEAD 版本里的行区间与 diff 的改动行有交集；
- **测试文件**（路径含 `tests/`，或文件名为 `test_*.py` / `*_test.py` / `*.test.ts` / `*.test.tsx`）里出现以下任一：
  - assert 行（`assert `、`expect(`）删除数大于新增数；
  - 新增 `pytest.mark.xfail`、`pytest.mark.skip`、`pytest.skip(`、`.skip(`、`.todo(`；
  - 测试函数（`def test_`、`test(`、`it(`）删除数大于新增数。

Feature: 用户定 Q5：可改 owns 并集，scenario 测试除外；测试只增不减；不加 xfail/skip。

不带 `--integ-base` 时 SHALL 与原行为相同。

#### Scenario: guard-rejects-artifact-and-scenario-edits
- **GIVEN** 一个 fixture 仓库，带 change 目录 D，`slices.json` 的 scenario_tests 映射 `tests/test_a.py::test_one`；base 提交之后又有两个分支：
  - 分支甲：改了 `D/specs/cap/spec.md` 与 `D/slices.json`；
  - 分支乙：改了 `tests/test_a.py` 里 `test_one` 函数体中的一行
- **WHEN** 分别在两个分支上运行 `slice-gate.py final --change-dir D --integ-base <base>`
- **THEN** 甲的 failed 含以 `G9 integ:` 开头、点名 `specs/cap/spec.md` 与 `slices.json` 的项
- **AND** 乙的 failed 含以 `G9 integ:` 开头、点名 `test_one` 的项
- **AND** 同一分支不带 `--integ-base` 运行时，failed 里没有 `G9` 项

#### Scenario: guard-rejects-weakened-tests
- **GIVEN** 同一 fixture 仓库，base 之后有四个分支：
  - 甲：删掉 `tests/test_b.py` 里两行 `assert`、只加一行；
  - 乙：在 `tests/test_b.py` 新增 `@pytest.mark.skip`；
  - 丙：删掉 `tests/test_b.py` 里一个 `def test_` 函数；
  - 丁：改生产代码 `src/x.py` 并在 `tests/test_b.py` 新增一个带 assert 的测试
- **WHEN** 分别运行 `slice-gate.py final --change-dir D --integ-base <base>`
- **THEN** 甲、乙、丙的 failed 各含一条 `G9 integ:` 项，分别点出 assert、skip、测试函数
- **AND** 丁的 failed 里没有 `G9` 项

### Requirement: 判定器声明 integ-guard，起飞时核对
`slice-gate.py features` SHALL 输出 `integ-guard`。插件的 `REQUIRED_FEATURES` SHALL 含 `integ-guard`，判定器缺它时起飞 SHALL 被拒，原因点名 `integ-guard`。
Feature: 沿用 #50 的判定器能力核对。

#### Scenario: features-declare-integ-guard
- **GIVEN** 本仓库的 `slice-gate.py`
- **WHEN** 运行 `slice-gate.py features`
- **THEN** 以 0 退出，输出的某一行恰为 `integ-guard`

#### Scenario: takeoff-requires-integ-guard
- **GIVEN** 测试世界里判定器的 `features` 输出缺 `integ-guard`、其余能力齐全
- **WHEN** 发 `/opsx-apply demo`
- **THEN** 回复含「integ-guard」，账本没有追加 takeoff
- **AND** `REQUIRED_FEATURES` 含 `integ-guard`

### Requirement: 整合修复的提示词写明失败清单与护栏
`integFixerPrompt({change, changeDir, failed, base})` SHALL：
- 逐条列出 failed；
- 写明 G9 的规则：不改 change 工件与 ADR、不碰 scenario 测试、测试只增不减、不加 xfail/skip、只写 owns 并集；
- 要求每处修复先有失败测试，修不了的在最后一行写明。

Feature: 门禁由控制面运行；提示词只交代任务与边界。

`integReviewPrompt({change, changeDir, base, commit})` SHALL 给出 `git diff <base> <commit>`，点名「是否以改弱测试换绿」，并要求经 submit_findings 提交。

#### Scenario: integ-prompts-state-guards
- **GIVEN** change demo、changeDir `template/openspec/changes/demo`、failed `['G2 test: exit 1（新增 1 条失败）\ntests/test_x.py::test_y']`、base `c9`、commit `c10`
- **WHEN** 分别生成 `integFixerPrompt` 与 `integReviewPrompt`
- **THEN** 前者含 `tests/test_x.py::test_y`，并含「scenario」「xfail」「owns」「先有失败测试」
- **AND** 后者含 `git diff c9 c10`、「改弱测试」与 `submit_findings`

### Requirement: 整合修复的收口带护栏、派发记下起点
`onLandingStop` 对 slice 为 `integ` 的修复体 SHALL 运行 `slice-gate.py final --change-dir <D> --integ-base <其派发事件的 base>`；对其它修复体 SHALL NOT 传 `--integ-base`。`runLandingAction` 派发 integ 修复体时：
- SHALL 用 `integFixerPrompt`；
- dispatch 事件 SHALL 记 `base`（派发时 change 分支的 HEAD）。

Feature: 用户定：G9 只在 integ 收口时判；其它修复体不变。

派发 `mode: 'integ'` 的评审员时：
- SHALL 用 `integReviewPrompt`；
- dispatch 事件 SHALL 记 `base` 与 `commit`。

#### Scenario: integ-gate-runs-guard
- **GIVEN** 落地测试世界：账本里有 integ 修复体 fi 的派发（base c9）与切片修复体 fx（slice fix）的派发
- **WHEN** 先后对 fi、fx 调用 `onLandingStop`
- **THEN** 对 fi 运行的 final 命令含 `--integ-base c9`
- **AND** 对 fx 运行的 final 命令不含 `--integ-base`

#### Scenario: integ-dispatch-records-base-and-range
- **GIVEN** 落地测试世界：change 分支 HEAD 为 c9
- **WHEN** 依次执行动作 `dispatch fixer {slice: 'integ', findings: [], failed: ['G2 test: …']}` 与 `dispatch reviewer {slice: 'integ', mode: 'integ', base: 'c9', commit: 'c10'}`
- **THEN** 修复体的提示词含「G2 test」与「scenario」，其 dispatch 事件 base 为 c9
- **AND** 评审员的提示词含 `git diff c9 c10`，其 dispatch 事件带 base c9 与 commit c10
