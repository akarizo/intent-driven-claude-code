## ADDED Requirements

### Requirement: 回退派发的 effort 由 agent frontmatter 决定
`/opsx-apply` 命令与 `openspec-apply-change` skill 的回退路径 SHALL NOT 把 `effort` 写成 Agent 工具的派发参数，SHALL 写明 effort 由 agent frontmatter 决定（Agent 工具没有 effort 参数）。
Rule: 文档描述的调用必须是工具真实支持的调用

#### Scenario: fallback-effort-from-frontmatter
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 读取两者的回退路径段（从「Workflow 不可用」到「两条路径」）
- **THEN** 两段都不含 `effort: high` 与 `effort: low`
- **AND** 两段都写明 effort 由 agent frontmatter 决定
