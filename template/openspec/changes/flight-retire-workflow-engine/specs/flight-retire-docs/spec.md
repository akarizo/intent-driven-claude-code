## ADDED Requirements

### Requirement: /opsx-apply 只讲插件路径
`/opsx-apply` 命令与 `openspec-apply-change` skill SHALL NOT 出现 `--engine=workflow`、`opsx-apply.js`、`integrator`、`slice-executor`、`session-decompose`；SHALL 写明模型读到本命令即说明插件缺席、未加载或版本不符，必须停飞并给出安装与 `/reload-plugins` 指引；`--gate=per-task` 与 `--takeover` 的说明 SHALL 保留。
Feature: DRAFT-flight-control-plane-in-mod 第 4 条：控制面缺席即停飞，不维护第二实现

#### Scenario: apply-docs-plugin-only
- **GIVEN** 本 change 合入后的 opsx-apply.md 与 openspec-apply-change/SKILL.md
- **WHEN** 逐份读取
- **THEN** 都不含 `--engine=workflow`、`opsx-apply.js`、`integrator`、`slice-executor`、`session-decompose`
- **AND** 都含「停飞」「/reload-plugins」「flight@intent-driven」「--gate=per-task」「--takeover」

### Requirement: git 纪律 skill 描述插件的 worktree
`openspec-git-discipline` skill 的飞行 carve-out SHALL 描述插件的切片 worktree（`.claude/worktrees/flight-<change>-<S>`）、分支（`flight/<change>/<S>`）与控制面合回，SHALL NOT 出现 Workflow 回退与 integrator。
Feature: 插件 io.ts 的 worktree 与分支命名

#### Scenario: git-discipline-describes-plugin-worktrees
- **GIVEN** 本 change 合入后的 openspec-git-discipline/SKILL.md
- **WHEN** 读取飞行 carve-out 一段
- **THEN** 含 `.claude/worktrees/flight-` 与 `flight/<change>/`
- **AND** 全文不含 `integrator`、`opsx-apply.js`

### Requirement: evidence.log 指飞行外
`/pr-ship` 与 `agents/code-reviewer.md` 提到 evidence.log 时 SHALL 说明它是飞行外（主会话修复等）的留痕，SHALL NOT 再称「Workflow 回退路径」。
Feature: 用户定：evidence.log 保留作飞行外的留痕

#### Scenario: evidence-log-means-outside-flight
- **GIVEN** 本 change 合入后的 pr-ship.md 与 code-reviewer.md
- **WHEN** 逐份读取
- **THEN** 都含 `evidence.log` 与「飞行外」
- **AND** 都不含「Workflow 回退」
