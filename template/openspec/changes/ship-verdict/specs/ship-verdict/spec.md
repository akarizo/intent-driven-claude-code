# ship-verdict

飞行模式收口时 PR 以 draft 还是 ready 打开、以及事后在两者之间的转换，MUST 由脚本按仓库内的门禁真相裁决，不由模型读散文判断。裁决依据只有三样：`gate-report.md` 中每个切片的最新行、final 行是否 ok 且对齐当前 HEAD、`review-findings.json` 中的阻断 finding。工作流返回的 `blocked` 列表只作说明，不作裁决。

## ADDED Requirements

### Requirement: ship 裁决只读门禁真相

`slice-gate.py ship --change-dir <dir>` MUST 输出 JSON `{ready, commit, reasons, blocked}`，并以退出码 0 表示 ready、1 表示 draft。`reasons` MUST 逐条说明为何不 ready；`ready` 为 true 当且仅当 `reasons` 为空。裁决 MUST 只依据 `gate-report.md`、当前 HEAD 与 `review-findings.json`，不得读取 timeline 或工作流返回值。

Feature: Mechanical ship verdict
Rule: ready 当且仅当每个切片最新门禁 ok、final ok 且对齐 HEAD、无阻断 finding

#### Scenario: 全绿对齐 HEAD 判 ready

- GIVEN slices.json 定义了切片 S1
- AND gate-report.md 中 S1 最新行为 ok
- AND gate-report.md 中 final 最新行为 ok 且 commit 等于当前 HEAD
- AND review-findings.json 不存在或 blocking 为空
- WHEN 运行 slice-gate.py ship
- THEN 输出 ready 为 true、reasons 为空
- AND 退出码为 0

#### Scenario: 切片门禁红判 draft

- GIVEN gate-report.md 中 S1 最新行为 red
- AND final 最新行为 ok 且对齐 HEAD
- WHEN 运行 slice-gate.py ship
- THEN ready 为 false 且 reasons 中有一条点名 S1
- AND 退出码为 1

#### Scenario: final 过期判 draft

- GIVEN gate-report.md 中 final 最新行为 ok 但 commit 不是当前 HEAD
- WHEN 运行 slice-gate.py ship
- THEN ready 为 false 且 reasons 中有一条指出 final 过期并同时给出记录 commit 与 HEAD

#### Scenario: 阻断 finding 未闭环判 draft

- GIVEN 门禁全绿且 final 对齐 HEAD
- AND review-findings.json 的 blocking 含 1 条 finding
- WHEN 运行 slice-gate.py ship
- THEN ready 为 false 且 reasons 中有一条给出未闭环的 CRITICAL/HIGH 数量

#### Scenario: blocked 只作说明不作裁决

- GIVEN 门禁全绿且 final 对齐 HEAD
- AND review-findings.json 的 blocked 含一条 kind 为 infra 的条目
- WHEN 运行 slice-gate.py ship
- THEN ready 为 true
- AND 输出的 blocked 原样带出该条目

#### Scenario: 非飞行模式直接 ready

- GIVEN change 目录下没有 slices.json
- WHEN 运行 slice-gate.py ship
- THEN ready 为 true 且退出码为 0

### Requirement: ship 产出 PR 正文段落

`ship --markdown` MUST 在 stdout 打印可直接贴入 PR 正文的 markdown：不 ready 时以「## 飞行门禁未全绿」开头逐条列 reasons；`blocked` 非空时附「### 飞行中记 blocked 的切片」并逐条带 kind 与 reason；ready 且 blocked 为空时打印空串。

Feature: PR body section
Rule: 不 ready 列 reasons；blocked 列说明；全绿无 blocked 输出为空

#### Scenario: draft 时输出 reasons 段落

- GIVEN ship 裁决为 draft 且 reasons 有 2 条
- WHEN 运行 slice-gate.py ship --markdown
- THEN stdout 以「## 飞行门禁未全绿」开头
- AND 两条 reasons 各占一行

### Requirement: pr-ship 双向转换

`/pr-ship` MUST 在建 PR 前运行 `ship` 决定是否 `--draft`；在自动修复收尾 MUST 重跑 `final` 与 `ship`，ready 且 PR 为 draft 时 MUST 转 ready 并记 `pr-ready` 事件；两轮后仍有 CRITICAL/HIGH 且 PR 为 ready 时 MUST 退回 draft。命令文本中不得再出现由模型自判「门禁未全绿」的散文。

Feature: Bidirectional draft/ready transition
Rule: 建前裁决、修后复裁、阻断退回

#### Scenario: 命令文本包含双向转换

- GIVEN template/.claude/commands/pr-ship.md
- WHEN 检查其文本
- THEN 建 PR 步骤引用 slice-gate.py ship
- AND 自动修复步骤引用 gh pr ready 与 gh pr ready --undo
- AND 记录 pr-ready 事件

#### Scenario: opsx-apply 收口写全量 review-findings 并调用 ship

- GIVEN template/.claude/commands/opsx-apply.md 与同名 skill
- WHEN 检查其文本
- THEN 收口步骤把 blocked 一起写入 review-findings.json
- AND 引用 slice-gate.py ship
- AND 不再有「final 未绿或有 blocked 切片 → draft」的模型自判散文

#### Scenario: 工作流 blocked 条目带 kind

- GIVEN template/.claude/workflows/opsx-apply.js
- WHEN 检查其文本
- THEN 每处 blocked.push 都带 kind 字段
- AND kind 取值只有 gate 与 infra
