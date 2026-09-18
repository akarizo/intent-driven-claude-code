## ADDED Requirements

### Requirement: 同一切片重复 start 不得重置区间与红计数
`slice-gate.py start <S>` 在根目录已有 `.openspec-slice` 且其 `slice` 等于 `<S>` 时 SHALL 保留既有 `base` 与 `red_count`，只在 timeline 追加 `slice-start <S> (resume)`；新增 `--base <sha>` 参数，SHALL 用它替代 `HEAD` 作为新标记的基准。`gate` 输出的 JSON SHALL 新增字段 `base`（本次判定所用的基准 sha）。
Feature: 重试判的是整个切片的工作，不是最后一次改动
Rule: 标记只在门禁绿时删除，红计数只增不减

#### Scenario: start-idempotent-same-slice
- **GIVEN** 根目录 `.openspec-slice` 为 `{"slice":"S1","base":"<X>","red_count":1,…}`，此后又有一个新 commit
- **WHEN** 再次运行 `python3 .claude/hooks/slice-gate.py start S1 --change-dir <dir>`
- **THEN** 退出码为 0，标记的 `base` 仍为 `<X>`、`red_count` 仍为 1
- **AND** timeline 最后一行事件为 `slice-start`，备注含 `S1` 与 `resume`

#### Scenario: start-accepts-base-flag
- **GIVEN** 根目录没有标记；`<X>` 是 HEAD 的父 commit
- **WHEN** 运行 `start S1 --change-dir <dir> --base <X>`
- **THEN** 标记的 `base` 等于 `<X>`，而不是 HEAD
- **AND** 不传 `--base` 时 `base` 仍等于 HEAD（既有行为）

#### Scenario: gate-json-carries-base
- **GIVEN** 一个已 `start` 的切片，标记 `base` 为 `<X>`
- **WHEN** 运行切片门禁
- **THEN** 打印的 JSON 含字段 `base`，值等于 `<X>`
- **AND** `commit` 字段仍为当前 HEAD

### Requirement: 重试必须接着上一轮的 commit 与基准继续
`opsx-apply.js` 对门禁红的切片重派时，SHALL 让执行体先核对 HEAD 是否为上一轮门禁 JSON 的 `commit`，不是则 `git cherry-pick` 它（冲突则 abort 并以 `G0 base` 失败返回），再以 `--base <上一轮 base>` 运行 `start`；首轮派发仍以 `expectHead` 校验基分支。GATE 结构化输出 schema SHALL 声明可选字段 `base`。`/opsx-apply` 命令与 `openspec-apply-change` skill 的回退路径 SHALL 描述同一重试语义，并在 step 3 的 `lint` 之后运行 `preflight`。
Feature: 隔离与不隔离两种模式下重试语义一致
Rule: 命令与同名 skill 同改，不漂移

#### Scenario: workflow-retry-cherry-picks-previous-commit
- **GIVEN** `template/.claude/workflows/opsx-apply.js`
- **WHEN** 读取 `executorPrompt` 与 GATE schema
- **THEN** 重试分支的 prompt 含 `git cherry-pick`、引用 `retryOf.commit`，并以 `--base` 传 `retryOf.base` 给 `start`
- **AND** 首轮分支仍含 `expectHead` 校验；GATE schema 的 `properties` 含 `base`；`node --check` 通过

#### Scenario: apply-docs-mirror-retry-and-preflight
- **GIVEN** `template/.claude/commands/opsx-apply.md` 与 `template/.claude/skills/openspec-apply-change/SKILL.md`
- **WHEN** 读取两者的 step 3 与回退路径段
- **THEN** 两者都在 `slice-gate.py lint` 之后运行 `slice-gate.py preflight`，并说明非 0 停飞
- **AND** 两者的回退路径都含 `cherry-pick` 与 `--base`，且提到的 hook 脚本集合一致
