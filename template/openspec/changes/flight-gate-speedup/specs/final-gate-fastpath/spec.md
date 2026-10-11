## ADDED Requirements

### Requirement: final 先判 G7，红则不跑全量测试
`slice-gate.py final` SHALL 先判 scenario 状态（G7），再跑 lint / typecheck；G7 有违规时 SHALL NOT 运行 `gate.test`，返回 ok 为 false，failed 含 G7 各项，warnings 含「G2 全量未跑」；G7 无违规时 SHALL 照常运行 `gate.test`。
Feature: afa 实测两次 final 在 G7 必红的情况下各跑满 33–35 分钟全量

#### Scenario: final-skips-full-suite-when-g7-red
- **GIVEN** cap#adds 的测试仍带 strict xfail 标记
- **AND** `gate.test` 运行时会在仓库根写下标记文件 ran-g2，`gate.lint` 运行时会写下 ran-lint
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 false，failed 含以 G7 开头且点名 cap#adds 的项
- **AND** ran-g2 不存在、ran-lint 存在
- **AND** warnings 含「G2 全量未跑」

#### Scenario: final-runs-g7-before-full-suite
- **GIVEN** cap#adds 的测试通过且无标记，运行时向 order.log 追加一行 g7
- **AND** `gate.test` 运行时向 order.log 追加一行 g2
- **WHEN** 运行 `slice-gate.py final`
- **THEN** ok 为 true
- **AND** order.log 依次为 g7、g2

### Requirement: final 复用新鲜的修复门禁结论
`slice-gate.py final --reuse-fix` SHALL 读取 change 账本里最后一条 slice 为 `fix` 的 gate 事件；它 ok 为 true、commit 是 HEAD 的祖先、且该 commit 到 HEAD 之间只改了 changes 根下的记账文件（与 ship 的 `_final_fresh` 同一判据）时，SHALL NOT 运行 `gate.test`，G7 与 lint / typecheck 照常判，warnings 写明复用了哪个 commit；否则 SHALL 与不带该参数时完全一致。读不了账本时 SHALL 按不复用处理，并在 warnings 里写明原因。
Feature: 新引擎里修复体收口门禁本身就是全量 final，合回后再跑一遍只多了记账提交

#### Scenario: final-reuses-fresh-fix-gate
- **GIVEN** 账本最后一条 slice fix 的 gate 事件 ok 为 true、commit 为 X
- **AND** X 之后只有一个改动 change 目录 timeline.md 的提交；cap#adds 的测试通过；`gate.test` 运行时会写下 ran-g2
- **WHEN** 运行 `slice-gate.py final --reuse-fix`
- **THEN** ok 为 true，ran-g2 不存在
- **AND** warnings 含 X 的前 10 位
- **AND** gate-report.md 新增一行 final ok，commit 为 HEAD 的前 10 位

#### Scenario: final-reuse-refused-after-code-change
- **GIVEN** 同上，但 X 之后还有一个改动 src/mod.py 的提交
- **WHEN** 运行 `slice-gate.py final --reuse-fix`
- **THEN** ran-g2 存在，warnings 不含「复用」

#### Scenario: final-reuse-needs-green-fix-gate
- **GIVEN** 账本最后一条 slice fix 的 gate 事件 ok 为 false，之后只有记账提交
- **WHEN** 运行 `slice-gate.py final --reuse-fix`
- **THEN** ran-g2 存在，warnings 不含「复用」

### Requirement: 新引擎的 final 动作请求复用，修复体收口门禁不复用
插件执行 final 动作时 SHALL 在 change worktree 里运行 `slice-gate.py final --change-dir <dir> --reuse-fix`；修复 agent 收口时在修复 worktree 里跑的 final SHALL NOT 带 `--reuse-fix`。
Feature: 复用只能发生在合回之后，修复门禁本身必须是实测

#### Scenario: landing-final-requests-fix-reuse
- **GIVEN** S1 已合回、评审结果为空列表
- **WHEN** 推进飞行到 final
- **THEN** slice-gate.py final 的调用在 change worktree 里运行，参数含 `--reuse-fix`

#### Scenario: fixer-stop-final-never-reuses
- **GIVEN** 修复 agent F 已派发，worktree 为修复 worktree
- **WHEN** 处理 F 的收口
- **THEN** slice-gate.py final 的调用在修复 worktree 里运行，参数不含 `--reuse-fix`
