## ADDED Requirements

### Requirement: start 按 change 分支的实时位置校验基点
`slice-gate.py start <S>` SHALL 接受可选参数 `--expect-branch <branch>`。给出该参数时，SHALL 在读写标记之前（含同片 resume 的情形）校验「该分支当前指向的 commit 是 HEAD 的祖先」：成立则行为与不带该参数时完全一致；不成立或分支不存在时，SHALL 在 stdout 打印 `{"slice": "<S>", "ok": false, "commit": "", "failed": ["G0 base: …"], …}`（`failed` 首项以 `G0 base` 开头并点名分支），以非 0 退出，且不写标记。
Feature: 基点真值来自 git，由脚本判定
Rule: 分支每个 wave 都会前进，校验只看祖先关系，不比对某个固定 sha

#### Scenario: start-accepts-head-at-branch-tip
- **GIVEN** change 计划已提交，分支 `worktree-c` 指向当前 HEAD
- **WHEN** 运行 `slice-gate.py start S1 --change-dir <dir> --expect-branch worktree-c`
- **THEN** 退出码为 0
- **AND** 标记的 `slice` 为 `S1`、`base` 为 HEAD

#### Scenario: start-accepts-head-ahead-of-branch
- **GIVEN** 分支 `worktree-c` 指向 T，HEAD 在 T 之上多一个 commit（重试时 cherry-pick 了上一轮的 commit）
- **WHEN** 运行 `start S1 --change-dir <dir> --base T --expect-branch worktree-c`
- **THEN** 退出码为 0，标记的 `base` 为 T

#### Scenario: start-refuses-head-off-branch
- **GIVEN** 分支 `worktree-c` 已前进一个 commit，而 HEAD 仍停在它之前的 commit；另有一个不存在的分支名
- **WHEN** 分别以 `--expect-branch worktree-c` 与 `--expect-branch no-such-branch` 运行 `start S1`
- **THEN** 两次都以非 0 退出，stdout 是 JSON：`slice` 为 `S1`、`ok` 为 false、`commit` 为空串、`failed` 首项以 `G0 base` 开头并含该分支名
- **AND** 根目录没有写出标记，随后对 S1 运行 `gate` 以非 0 退出

### Requirement: 工作流的每个执行体都把分支名交给 start
`opsx-apply.js` SHALL 从参数 `branch` 取 change 分支名，并在每一次执行体派发（每个 wave、首轮与重派）的 start 命令上带 `--expect-branch <branch>`；SHALL NOT 再读取参数 `expectHead`，也不在 prompt 里比对某个固定的 HEAD。上一轮以 G0 失败（`commit` 为空）的重派 SHALL 按首轮处理，不 cherry-pick。
Feature: 多 wave 飞行里，基点校验不随 wave 失效

#### Scenario: workflow-passes-branch-to-start
- **GIVEN** 参数 `branch` 为 `worktree-c`，waves 为 `[[S1, S2], [S3]]`；S1 首轮被 start 以 G0 拒绝（`commit` 为空），S2 首轮门禁红（带上一轮 commit 与 base），两者重派后都绿
- **WHEN** 用 mock agent 驱动工作流跑完
- **THEN** S1、S1 重派、S2、S2 重派、S3 五次执行体派发的 start 命令都带 `--expect-branch worktree-c`
- **AND** S1 重派的 prompt 不含 `cherry-pick`；S2 重派的 prompt 含 `cherry-pick`，其 start 带上一轮的 `--base`
- **AND** 脚本全文不再出现 `expectHead`

### Requirement: 执行体遇到 start 拒绝时原样返回
`slice-executor.md` 的开工段 SHALL 写明 start 可能带 `--expect-branch` 做基点校验；start 以非 0 退出时，执行体 SHALL 不做任何改动，把 start 打印的 JSON 原样作为最终输出。

#### Scenario: executor-returns-start-refusal
- **GIVEN** `template/.claude/agents/slice-executor.md`
- **WHEN** 读取「开工」段
- **THEN** 该段含 `--expect-branch`，并写明 start 非 0 时不做任何改动、把它打印的 JSON 原样返回

### Requirement: apply 命令与 skill 用分支名起飞
`/opsx-apply` 命令与 `openspec-apply-change` skill 的工作流参数 SHALL 用 `branch: "<git branch --show-current>"` 取代 `expectHead`；回退路径 SHALL 写明 start 带 `--expect-branch`，start 非 0 时执行体原样返回其 JSON。
Rule: 命令与同名 skill 同改，不漂移

#### Scenario: apply-docs-pass-branch
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 读取两者的工作流参数与回退路径段
- **THEN** 两者都含 `branch: "<git branch --show-current>"`，全文不再出现 `expectHead`
- **AND** 两者的回退路径段都含 `--expect-branch` 与「原样」
