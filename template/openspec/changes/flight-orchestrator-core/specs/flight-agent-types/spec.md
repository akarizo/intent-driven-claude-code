## ADDED Requirements

### Requirement: 执行体、评审员、修复 agent 的定义随插件发布
flight 插件 SHALL 在 `agents/` 下发布三份 agent 定义，类型名分别为 `flight:executor`、`flight:reviewer`、`flight:fixer`：
- **executor**：tools 恰为 Read、Edit、Write、Bash、Grep、Glob；effort 为 high；maxTurns 为 40；预加载 test-driven-development skill。
- **fixer**：tools 与 executor 相同；effort 为 high；maxTurns 为 40。它同时承担批量修复和解合回冲突两种任务。
- **reviewer**：tools 为 Read、Grep、Glob、Bash 与 `mcp__flight__submit_findings`，不含 Edit、Write；effort 为 high。

三份定义都 SHALL NOT 写 `model` 字段：模型由每次派发显式指定。定义正文 SHALL 写明：
- 门禁由控制面在收口时运行，agent 不自己跑 `slice-gate.py start` / `gate` / `record`；
- executor 与 fixer 只写 owns 内文件、每切片一个 commit，不 push、不 merge、不切分支；
- reviewer 必须用 `submit_findings` 提交，没有问题也提交空列表。
Feature: 定义放在插件里，不放在模型可改的仓库里

#### Scenario: agent-files-declare-flight-types
- **GIVEN** `template/plugins/flight/agents/` 下的三份文件
- **WHEN** 解析它们的 frontmatter
- **THEN** name 分别为 executor、reviewer、fixer，effort 都是 high，都没有 model 字段
- **AND** executor 与 fixer 的 tools 恰为 Read、Edit、Write、Bash、Grep、Glob，maxTurns 为 40
- **AND** reviewer 的 tools 含 `mcp__flight__submit_findings`，不含 Edit 与 Write

#### Scenario: agent-bodies-leave-gate-to-control-plane
- **GIVEN** 同上三份文件
- **WHEN** 读它们的正文
- **THEN** executor 与 fixer 的正文含「控制面」，且不含 `slice-gate.py start`、`slice-gate.py gate`、`slice-gate.py record`
- **AND** reviewer 的正文含 `submit_findings` 与「空列表」

### Requirement: 提示词由纯函数生成
插件 SHALL 用不调用 `$` 的函数生成每次派发的提示词：
- **执行体**：首次与续接两种。都含切片包路径、owns 纪律和「门禁由控制面在你收口时运行」。续接提示词 SHALL 另含上一个执行体未正常收口的原因，以及最近一次门禁的 failed 项。
- **评审员**：含被审 commit、切片包路径和 `submit_findings`。
- **解冲突**：含冲突文件列表与 `git commit --no-edit`。
- **批量修复**：含 findings 清单。
Feature: 提示词是协议的一部分，要能被测试钉住

#### Scenario: prompts-executor-and-continuation
- **GIVEN** change demo、切片 S2、切片包 `template/openspec/changes/demo/slices/S2.md`
- **AND** 上一个执行体未经收口结束，最近一次门禁的 failed 为 ["G7 demo#s2"]
- **WHEN** 分别生成首次与续接的执行体提示词
- **THEN** 两者都含该切片包路径，以及「门禁由控制面在你收口时运行」
- **AND** 只有续接提示词含「未正常收口」与 "G7 demo#s2"

#### Scenario: prompts-reviewer-resolver-fixer
- **GIVEN** S1 合回后的 commit c1、合回 S2 时的冲突文件 [a.py]、一条 HIGH finding
- **WHEN** 分别生成评审员、解冲突与批量修复提示词
- **THEN** 评审员提示词含 c1、S1 的切片包路径与 `submit_findings`
- **AND** 解冲突提示词含 a.py 与 `git commit --no-edit`
- **AND** 批量修复提示词含该 finding 的 summary
