## ADDED Requirements

### Requirement: 规格可执行
tasks 工件 SHALL 产出 slices.json、切片包与每个 scenario 的测试骨架。
Feature: scenario → 测试骨架 → 切片
Rule: 批准 spec.html 即批准验收测试；apply 完成判据是机械的

#### Scenario: schema-tasks-produce-slices
- **GIVEN** `template/openspec/schemas/intent-driven/schema.yaml`
- **WHEN** 读取 tasks 工件的 instruction
- **THEN** 要求产出 `slices.json`（含 gate / slices[owns, deps, verify, scenarios] / scenario_tests）、`slices/<S>.md` 切片包、每个 scenario 一个 `xfail(strict)` 测试骨架放在所属切片 owns 的测试文件内，以及由 slices.json 生成的 `tasks.md`
- **AND** 切片规则写明：1–9 片、DAG 深度 ≤ 3、同 wave 所有权不相交、每片 owns ≤ 12 条

#### Scenario: propose-command-triggers
- **GIVEN** `template/.claude/commands/opsx-propose.md` 与 `skills/openspec-propose/SKILL.md`
- **WHEN** 阅读步骤
- **THEN** 一次读取全部工件 instructions、一次写出全部工件，再一次 `openspec status`
- **AND** 含触发器表：行为变化 → specs；架构 / 新依赖 / 数据模型 → design；长期决策 → adr；未命中者写入带理由的跳过声明
- **AND** 含基线门禁步骤 `slice-gate.py baseline`（记录全量测试耗时）与 `spec_html.py` 渲染步骤

### Requirement: spec.html 脚本渲染
spec.html SHALL 由脚本确定性渲染，且 MUST NOT 由模型逐字生成。
Feature: 零 token 渲染审批面板

#### Scenario: spec-html-renders-artifacts
- **GIVEN** 一个 change 目录含 proposal.md、specs/*/spec.md、design.md、tasks.md
- **WHEN** 运行 `spec_html.py --change-dir <dir> --out <file>`
- **THEN** 输出文件的 why / specs / tasks 块含对应内容（Requirement / Scenario / GIVEN 关键字与任务勾选状态），未提供的块保留占位

#### Scenario: spec-html-flight-block
- **GIVEN** change 目录含 slices.json 与 timeline.md
- **WHEN** 渲染
- **THEN** 输出含「飞行计划」区：每个切片 id 与标题、wave 分组、owns、scenario 映射与状态、已记录的时间事件

### Requirement: 铁律落地
本仓库根 CLAUDE.md 与模板 snippet SHALL 各含一段铁律，任何提速手段 MUST NOT 破坏其中任一条。
Feature: 加速不得破坏能力原则

#### Scenario: claudemd-iron-rules
- **GIVEN** 本仓库根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet`
- **WHEN** 读取
- **THEN** 两者各含一段「铁律」，覆盖：先意图后代码 · 规格即验收 · TDD 与 hook 留痕 · 独立评审必有 · 门禁只加严不绕过 · Git 边界与 ADR 不可改 · 两处人类审批 · 度量必打印 · 零 token 优先 · 回退路径必存在
- **AND** 本仓库根 `CLAUDE.md` 另含仓库自身纪律：命令与 skill 同改、`openspec schema validate` 绿、pytest 绿、无假名谚文

#### Scenario: docs-updated
- **GIVEN** `README.md`、`docs/WORKFLOW_zh.md`、`template/CLAUDE.md.snippet`
- **WHEN** 读取
- **THEN** 不再把「逐 task 守门」「review 水位线」描述为默认机制（仅在 legacy 段提及）
- **AND** 描述飞行流程：slices.json、切片包、门禁、workflow、评审离路径、飞行记录
- **AND** 模型路由段写明 v2.1.251 起的解析顺序，不再声称 env 压过一切
