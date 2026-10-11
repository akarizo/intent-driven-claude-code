## ADDED Requirements

### Requirement: gate.test 必须显式写在 slices.json
`slice-gate.py lint` SHALL 在 `gate.test` 缺失或为空时判违规，错误信息点名 `gate.test`。
Feature: baseline 自动探测测试命令时会改写 slices.json 的 gate.test，审批页先于 baseline 生成后，这会让计划指纹失效

#### Scenario: lint-requires-gate-test
- **GIVEN** slices.json 合法，但 gate 里没有 test
- **WHEN** 运行 `slice-gate.py lint`
- **THEN** 退出码非 0，stderr 含 gate.test

### Requirement: baseline 运行期间留下标记，preflight 据此拒绝起飞
`slice-gate.py baseline` SHALL 在运行任何命令之前把 `gate-baseline.json` 写成含 `running: true`、本进程 `pid` 与开始时间的标记，结束时用最终结果整体覆盖（不再含 `running`）。`slice-gate.py preflight` 读到 `running` 为 true 时 SHALL 退出非 0：pid 仍存活 → stderr 含「仍在跑」与已运行时长；pid 已不存在 → stderr 含「中断」并提示重跑 baseline。
Feature: 审批与 baseline 并行后，人可能在 baseline 跑完前就批准并发出 /opsx-apply

#### Scenario: baseline-marks-running
- **GIVEN** `gate.test` 是一个读取 gate-baseline.json、`running` 为 true 才退出 0 的脚本
- **WHEN** 运行 `slice-gate.py baseline`
- **THEN** 退出 0
- **AND** 结束后 gate-baseline.json 的 ok 为 true，且没有 running 字段

#### Scenario: preflight-reports-running-baseline
- **GIVEN** gate-baseline.json 为 running 标记，pid 是一个仍存活的进程
- **WHEN** 运行 `slice-gate.py preflight`
- **THEN** 退出码非 0，stderr 含「仍在跑」

#### Scenario: preflight-reports-interrupted-baseline
- **GIVEN** gate-baseline.json 为 running 标记，pid 是一个已经退出的进程
- **WHEN** 运行 `slice-gate.py preflight`
- **THEN** 退出码非 0，stderr 含「中断」与 baseline

### Requirement: propose 先交审批页，baseline 后台运行
`opsx-propose` 命令与 `openspec-propose` skill SHALL 在 lint 通过后先渲染 `spec.html`、交接给人，再在后台运行 `slice-gate.py baseline`；baseline 结束时 SHALL 只报告一行结论（红则列出 reasons）；交接 SHALL 写明 baseline 跑完前起飞会被 preflight 拒绝、工件在 baseline 报告之后再 commit。schema 的 tasks 说明 SHALL 写明 `gate.test` 必填，以及 pytest 的预存红按基线差分、无需手写 deselect。
Feature: afa 实测审批页 12:35 才出，你审了 39 分钟；这段本可与基线重叠

#### Scenario: propose-renders-panel-before-baseline
- **GIVEN** opsx-propose.md 与 openspec-propose/SKILL.md
- **WHEN** 读取两者的步骤
- **THEN** 两者都是 spec_html.py 的步骤在 slice-gate.py baseline 的步骤之前
- **AND** baseline 步骤写明后台运行、跑完报告一行
- **AND** 交接写明 baseline 跑完前起飞会被 preflight 拒绝
- **AND** 两者提到的 hook 脚本集合一致

#### Scenario: schema-requires-gate-test
- **GIVEN** schema.yaml 的 tasks 工件说明
- **WHEN** 读取其中关于 gate 的说明
- **THEN** 写明 gate.test 必填，并写明预存红按基线差分、无需手写 deselect
