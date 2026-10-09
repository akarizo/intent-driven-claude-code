## ADDED Requirements

### Requirement: 执行体未返回也重派一次
`opsx-apply.js` 在执行体 `agent()` 解析为 null（未产出门禁 JSON，多为撞 `maxTurns`）时 SHALL 与门禁红一样重派同一切片一次（label `<S>:retry`）。重派 prompt SHALL 说明上一轮未返回、没有门禁结论，`start` 命令 SHALL 带 `--resume-checkpoint`（仍带 `--expect-branch`），SHALL NOT 要求 cherry-pick；首轮派发的 `start` SHALL NOT 带 `--resume-checkpoint`。重派仍为 null 时 SHALL 记 `{slice, kind: "infra"}` blocked，reason 写明未返回且已重派。门禁红的既有重试 prompt（cherry-pick 上一轮 commit、`--base`）保持不变；每个切片最多重派一次。
Feature: 撞上限不再等于整片作废
Rule: 未返回与门禁红共用一次重派预算

#### Scenario: workflow-retries-noreturn-with-checkpoint
- **GIVEN** waves `[[S1, S2], [S3]]`、S3 依赖 S1；S1 首轮 `agent()` 得 null，重派后门禁绿；S2、S3 一次绿
- **WHEN** 用 mock agent 跑完整个工作流
- **THEN** 执行体派发恰为 S1、S1:retry、S2、S3
- **AND** S1:retry 的 `start` 命令带 `--resume-checkpoint` 与 `--expect-branch worktree-c`，prompt 不含 `cherry-pick`、含「未返回」；S1 首轮的 prompt 不含 `--resume-checkpoint`
- **AND** 工作流结果的 `blocked` 为空

#### Scenario: workflow-noreturn-twice-blocks
- **GIVEN** waves `[[S1, S2], [S3]]`、S3 依赖 S1；S1 首轮与重派都得 null
- **WHEN** 用 mock agent 跑完整个工作流
- **THEN** S1 与 S1:retry 各派发一次
- **AND** `blocked` 中 S1 的 `kind` 为 `infra`，reason 含「未返回」与「重派」
- **AND** S3 因依赖记 blocked 且未派发

### Requirement: 回退路径、执行体契约与 hook 注册同改
`/opsx-apply` 命令与 `openspec-apply-change` skill 的 Agent 回退路径 SHALL 写明：执行体未返回门禁 JSON 也重派一次、`start` 带 `--resume-checkpoint`，与工作流语义一致。`slice-executor.md` 开工段 SHALL 说明 `--resume-checkpoint` 的含义与 `checkpoint.restored` 输出。`template/.claude/hooks/hooks.json` SHALL 在 `PostToolUse`（matcher 覆盖 Write、Edit、Bash）与 `PostToolUseFailure`（Bash）上注册 `slice-gate.py checkpoint`。
Feature: 两条派发路径语义一致
Rule: 命令与同名 skill 同改，不漂移

#### Scenario: apply-docs-mirror-noreturn-retry
- **GIVEN** `opsx-apply.md`、`openspec-apply-change/SKILL.md`、`slice-executor.md` 与 `hooks/hooks.json`
- **WHEN** 读取两份回退路径段、执行体开工段与 hook 注册
- **THEN** 两份回退路径都含「未返回」与 `--resume-checkpoint`
- **AND** 执行体开工段含 `--resume-checkpoint` 与 `restored`
- **AND** hooks.json 的 `PostToolUse` 有一条 matcher 同时覆盖 Write、Edit、Bash 的 `slice-gate.py checkpoint`，`PostToolUseFailure` 也注册了它
