## ADDED Requirements

### Requirement: 命令认领 hook 保留下游原始错误
批准带对 `/opsx-*`、`/flight` 命令的认领 hook 在下游已执行且抛错时，回复 SHALL 含下游错误的首行，形如「flight：命令执行出错：<首行>」；SHALL NOT 只回笼统的「flight：命令执行出错」。下游未执行时照旧交给下游。

Feature: #61 评审 LOW：`/opsx-propose` 等 markdown 命令的错误被换成 flight 的笼统文字，错误被记到 flight 头上。测试里无法用「插件之下抛错的 hook」构造下游错误：引擎会跳过抛错的 hook（fail-open），落到下游无实现（2026-10-14 S5 实测）；因此以「插件之下没有实现」构造下游错误。

#### Scenario: claim-hook-keeps-downstream-error
- **GIVEN** 插件之下没有 `/opsx-propose` 的实现（下游以「no implementation for command.run」拒绝）
- **WHEN** 人发出 `/opsx-propose demo`
- **THEN** 回复含「flight：命令执行出错」与「no implementation for command.run」

### Requirement: 改名行的拒绝出路
起飞因「工件之外的未提交改动」被拒时：工件之外的路径全是 porcelain 改名行（含 ` -> `）→ 回复 SHALL 给出「`git mv` 回原名，或自行提交这次改名」的出路，SHALL NOT 建议列进 `artifact_files`；混有其他路径时两条出路都给。

Feature: 改名行无论是否声明都被归为工件之外（#60），原先的「列进 artifact_files」对它不可行。

#### Scenario: rename-refusal-advice
- **GIVEN** demo 已批准、账本为空；porcelain 只有 `R  <cd>/a.md -> <cd>/b.md` 与 `?? <cd>/proposal.md`
- **WHEN** 人发出 `/opsx-apply demo 授权提交`
- **THEN** 回复含「工件之外」、改名行原文与「git mv」
- **AND** 回复不含「artifact_files」；没有提交，账本没有 takeoff
