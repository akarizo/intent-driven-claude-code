## ADDED Requirements

### Requirement: 落地交接到 /flight:pr-ship
落地后插件 SHALL 运行命令 `flight:pr-ship`，参数 SHALL 为 `--worktree <change worktree 绝对路径> --change-dir <change 目录（相对 worktree）> --judges <判定器目录绝对路径>`。运行失败时插件 SHALL 不停飞，log SHALL 含「接 /flight:pr-ship 失败」，toast SHALL 含「请手动运行 /flight:pr-ship」与上述参数。
Feature: 用户定（2026-10-12）：pr-ship 迁入插件

#### Scenario: landing-hands-off-to-flight-pr-ship
- **GIVEN** demo 全部切片已合回、final 绿；change worktree 为 `/repo/.worktrees/demo`，change 目录为 `template/openspec/changes/demo`，判定器目录为 `/repo/template/.claude/hooks`
- **WHEN** 控制面执行落地；再在另一个世界里让运行命令抛出「no command named /flight:pr-ship」后执行落地
- **THEN** 第一个世界运行的命令恰为一条：`flight:pr-ship --worktree /repo/.worktrees/demo --change-dir template/openspec/changes/demo --judges /repo/template/.claude/hooks`
- **AND** 第二个世界账本末条为 land，toast 含「请手动运行 /flight:pr-ship --worktree /repo/.worktrees/demo」

### Requirement: 主会话可派发 flight:code-reviewer
派发守卫 SHALL 允许非插件来源派发 `flight:code-reviewer`，条件是显式指定 `model`。不带 `model` 时 SHALL 拒绝（铁律 11）；父 agent 在飞且来源不是插件时 SHALL 拒绝。其他 `flight:*` 类型 SHALL 仍只能由 flight 控制面派发。
Feature: 用户定（2026-10-12）：pr-ship 与 code-reviewer 迁入插件

#### Scenario: main-session-spawns-code-reviewer
- **GIVEN** 派发守卫 `spawnVerdict`
- **WHEN** 分别判定四种派发：
  - 主会话（来源非插件）以 model opus 派发 `flight:code-reviewer`；
  - 主会话不带 model 派发 `flight:code-reviewer`；
  - 在飞 agent（来源非插件）以 model opus 派发 `flight:code-reviewer`；
  - 主会话以 model opus 派发 `flight:reviewer`
- **THEN** 第一种放行
- **AND** 第二种的拒绝理由含「铁律 11」，第三种含「飞行中的 agent 不得再派发子 agent」，第四种含「只能由 flight 控制面派发」
