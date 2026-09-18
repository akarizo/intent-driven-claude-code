## ADDED Requirements

### Requirement: pr-ship 自动修代码之前必须问一次
`/pr-ship` 的 CRITICAL/HIGH 处置 SHALL 在自动修复之前用唯一一次 `AskUserQuestion` 让人类选择「自动修并 push」或「只贴评论交人」；无人应答或选择后者时 MUST 只贴评论、保留 `review-findings.json.blocking`、由 `ship` 照常裁 draft。收尾 step MUST NOT 再问询，全文问询次数仍 ≤ 1。
Feature: PR 地址给出后不再有未经同意的代码改动
Rule: 与用户全局授权列举一致（commit · push feature · 建 PR · 贴评论 · 转 draft/ready）

#### Scenario: pr-ship-asks-before-autofix
- **GIVEN** `template/.claude/commands/pr-ship.md`
- **WHEN** 读取 step 10 与 step 11 以及 Guardrails
- **THEN** step 10 在「自动修复」之前含 `AskUserQuestion`，并写明默认为只贴评论
- **AND** step 11 与 Guardrails 不再描述「收尾问是否人工复核」；全文 `AskUserQuestion` 出现次数 ≤ 1

### Requirement: 基线红即停，verify 只跑测试
`/opsx-propose` 命令与 `openspec-propose` skill 的 step 4 SHALL 写明 `baseline` 退出非 0 时停下报告 `reasons`，不渲染、不交接，由人类修 `gate.test` / `verify` / 环境后重跑；`schema.yaml` 的切片规则 SHALL 写明 `verify` 只跑测试、禁含 typecheck / lint 工具，既有错误的排除由门禁按基线差分完成。
Feature: 起飞前预检有文档承载，作者写 verify 时就知道规则
Rule: 命令与 skill 同改

#### Scenario: propose-baseline-red-stops
- **GIVEN** `template/.claude/commands/opsx-propose.md` 与 `template/.claude/skills/openspec-propose/SKILL.md`
- **WHEN** 读取两者的 step 4
- **THEN** 两者都含 `slice-gate.py baseline`、`gate-baseline.json` 与「停下报告」
- **AND** 两者都说明 verify 在基线上必须绿，且提到的 hook 脚本集合一致

#### Scenario: schema-verify-excludes-typecheck
- **GIVEN** `template/openspec/schemas/intent-driven/schema.yaml` 的 tasks 工件 instruction
- **WHEN** 读取 Slicing rules 段
- **THEN** 含「verify 只跑测试」类规则，并点名 `typecheck` 与 `gate.lint` / `gate.typecheck`
- **AND** `cd template && openspec schema validate intent-driven` 通过
