## ADDED Requirements

### Requirement: 计划指纹只覆盖定义计划的内容
`plan_fp.py` SHALL 以 change 目录中的 `proposal.md`、`design.md`、`slices.json`、`specs/**/spec.md`、`slices/*.md`（`_interfaces.md` 除外）为输入计算 sha256 指纹；文本统一按 UTF-8 解码并把 CRLF 规范为 LF；`slices.json` SHALL 解析后去掉 `gate.full_suite_sec` 再以排序键的紧凑 JSON 参与计算；指纹 = 「相对路径 TAB 文件内容 sha256」逐行按路径排序后再取 sha256。执行记录（`tasks.md`、`spec.html`、`timeline.md`、`gate-report.md`、`gate-baseline.json`、`evidence.log`、`review-findings.json`、`.flight`、`slices/_interfaces.md`）SHALL NOT 影响指纹。
Feature: 人批准的是计划内容本身
Rule: 执行过程中的记账不让批准失效，改计划一定让批准失效

#### Scenario: fp-ignores-execution-records
- **GIVEN** 一个计划工件齐全的 change 目录及其指纹 F
- **WHEN** 勾选 `tasks.md`、重渲染 `spec.html`，并写入 `timeline.md`、`gate-report.md`、`gate-baseline.json`、`evidence.log`、`review-findings.json`、`.flight` 与 `slices/_interfaces.md`
- **THEN** 重新计算的指纹仍等于 F

#### Scenario: fp-changes-on-plan-edit
- **GIVEN** 一个计划工件齐全的 change 目录及其指纹 F
- **WHEN** 分别只改 `proposal.md`、`design.md`、某个 `specs/<cap>/spec.md`、`slices.json` 中某片的 `owns`、某个 `slices/S<n>.md` 中的一个字
- **THEN** 每一次重新计算的指纹都不等于 F

#### Scenario: fp-ignores-measured-suite-time
- **GIVEN** 一个 change 目录及其指纹 F
- **WHEN** 基线步骤把 `slices.json` 的 `gate.full_suite_sec` 从 9.6 改写为 12.3
- **THEN** 重新计算的指纹仍等于 F

#### Scenario: fp-normalizes-line-endings
- **GIVEN** 内容相同的两份 change 目录，一份所有文本文件用 LF 换行，另一份用 CRLF
- **WHEN** 分别计算指纹
- **THEN** 两个指纹相等

### Requirement: 指纹命令行与审批面板展示
`plan_fp.py --change-dir DIR` SHALL 在 stdout 打印 64 位小写十六进制指纹并以 0 退出；加 `--short` SHALL 只打印前 8 位；目录不存在或其中没有任何计划文件 SHALL 以 2 退出并在 stderr 说明原因。`spec_html.py` 渲染的 `spec.html` SHALL 显示「计划指纹」与其前 8 位，与 `plan_fp.py --short` 的输出一致。
Feature: 人在审批面板与批准带上看到同一个指纹

#### Scenario: fp-cli-short-is-prefix
- **GIVEN** 一个计划工件齐全的 change 目录，以及一个不存在的目录
- **WHEN** 对前者分别以默认与 `--short` 运行 `plan_fp.py`，再对后者运行一次
- **THEN** 默认输出是 64 位小写十六进制，`--short` 输出是它的前 8 位，两次都以 0 退出
- **AND** 对不存在的目录以 2 退出且 stderr 非空

#### Scenario: spec-html-shows-fingerprint
- **GIVEN** 一个计划工件齐全的 change 目录
- **WHEN** 运行 `spec_html.py` 渲染审批面板
- **THEN** 生成的 `spec.html` 含「计划指纹」字样与 `plan_fp.py --short` 输出的 8 位指纹
