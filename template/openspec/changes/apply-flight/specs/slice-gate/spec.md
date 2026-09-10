## ADDED Requirements

### Requirement: 切片规划 lint
系统 SHALL 在起飞前校验 slices.json，并对不合法的规划返回非零退出码。
Feature: slices.json 规划校验
Rule: 规划不合法就不能起飞；同一 wave 内的切片所有权必须不相交

#### Scenario: lint-accepts-valid-plan
- **GIVEN** 一份 slices.json 含 6 个切片，deps 无环且深度为 3，同一 wave 内 owns 两两不相交，每片 verify 非空
- **WHEN** 运行 `slice-gate.py lint --change-dir <dir>`
- **THEN** 退出码为 0
- **AND** 标准输出打印 waves JSON：`[["S1","S2"],["S3"],["S4","S5","S6"]]`

#### Scenario: lint-rejects-overlap
- **GIVEN** 两个无依赖关系（同一 wave）的切片在 owns 中声明了同一路径
- **WHEN** 运行 lint
- **THEN** 退出码非 0
- **AND** 错误信息同时点名两个切片 id 与重叠路径

#### Scenario: lint-rejects-depth
- **GIVEN** deps 链深度为 4，或切片数超过 9，或某片 owns 条目超过 12
- **WHEN** 运行 lint
- **THEN** 退出码非 0
- **AND** 错误信息点名被违反的规则名（depth / count / owns）

### Requirement: 切片门禁
门禁 SHALL 以 JSON 契约 `{slice, ok, commit, failed[], warnings[], summary}` 输出结论，并 SHALL 把每次结论追加到 gate-report.md。
Feature: 每切片零 token 门禁
Rule: 门禁输出 JSON 契约 `{slice, ok, commit, failed[], warnings[], summary}` 并追加 gate-report.md

#### Scenario: gate-pass-json
- **GIVEN** 切片已 `start`（存在 `.openspec-slice` 标记，记录 base commit），verify 命令通过，改动的源文件在同区间有配对测试文件改动，测试函数含按序的 Given / When / Then 注释，改动全部在 owns 内，scenario 骨架已去掉 xfail 标记
- **WHEN** 运行 `slice-gate.py gate <S> --change-dir <dir>`
- **THEN** 标准输出是一个 JSON，`ok` 为 true，`failed` 为空数组，`commit` 为当前 HEAD
- **AND** `<dir>/gate-report.md` 追加一行含切片 id、结论与时间
- **AND** `.openspec-slice` 标记被移除

#### Scenario: gate-ownership-violation
- **GIVEN** 切片已 start，区间内有 commit 改动了 owns 之外的源文件
- **WHEN** 运行 gate
- **THEN** `ok` 为 false
- **AND** `failed` 含一项以 `G6` 开头并点名该路径

#### Scenario: gate-missing-gwt
- **GIVEN** 区间内改动的测试文件里有一个测试函数缺少 `Then:` 注释
- **WHEN** 运行 gate
- **THEN** `ok` 为 false
- **AND** `failed` 含一项以 `G4` 开头并点名该函数

#### Scenario: final-gate-reports-scenarios
- **GIVEN** slices.json 的 `scenario_tests` 把每个 scenario 映射到 `path::function`
- **WHEN** 运行 `slice-gate.py final --change-dir <dir>`
- **THEN** 输出 JSON 含 `scenarios.total` 与 `scenarios.passed`
- **AND** `ok` 为 true 当且仅当全量测试、lint 与全部 scenario 都通过

### Requirement: intent-gate 定根与所有权
门禁 SHALL 按目标文件向上查找最近的 `openspec/` 目录定根，并 SHALL 在切片进行中拒绝 owns 之外的源码写入。
Feature: PreToolUse 门禁在 worktree 与切片场景下的判定

#### Scenario: intent-gate-worktree-root
- **GIVEN** 会话的 `CLAUDE_PROJECT_DIR` 是主仓库根，活跃 change 只存在于 `.worktrees/x/openspec/changes/` 内
- **WHEN** 对 `.worktrees/x/src/a.py` 发起 Write
- **THEN** 门禁按目标文件向上找到最近的 `openspec/` 定根并放行

#### Scenario: intent-gate-ownership-deny
- **GIVEN** 根目录存在 `.openspec-slice` 标记指向切片 S1，S1 的 owns 不含 `src/other.py`
- **WHEN** 对 `src/other.py` 发起 Write
- **THEN** 门禁返回 deny，理由点名切片 id 与该路径

### Requirement: 测试运行留痕与收口阻断
系统 SHALL 由 hook 记录每次测试运行的结果，并 SHALL 在切片门禁未绿时阻止会话收口。
Feature: hook 留痕代替模型自述

#### Scenario: evidence-log-records-test-runs
- **GIVEN** 一条 PostToolUse（或 PostToolUseFailure）的 Bash 事件，命令匹配测试运行器，且根目录有 `.openspec-slice` 标记
- **WHEN** 运行 `test-evidence.py`
- **THEN** `<change>/evidence.log` 追加一行含时间、切片 id、PASS 或 FAIL、命令

#### Scenario: stop-hook-blocks-red-flight
- **GIVEN** 根目录存在 `.openspec-slice` 标记（切片已 start 且门禁未绿）
- **WHEN** Stop 或 SubagentStop 事件触发 `stop-gate.py`，且 `stop_hook_active` 为 false
- **THEN** 输出 `{"decision":"block","reason":...}`
- **AND** 当 `stop_hook_active` 为 true 时不输出 block
