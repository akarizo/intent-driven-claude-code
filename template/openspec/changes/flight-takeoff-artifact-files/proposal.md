## Why

2026-10-14 在 afa 起飞 `dlib-post-hooks-root-to-data-dir`，人连发三次命令都被同一句拒绝挡回：

| 输入 | 插件回复 |
|---|---|
| `/opsx-apply dlib-post-hooks-root-to-data-dir` | 工作区不干净，不起飞（工件之外的未提交改动）：`executor/tests/af_dlib/post_hook_helpers.py`、`openspec/adr/INDEX.md` |
| `/opsx-apply dlib-post-hooks-root-to-data-dir 授权提交`（两次） | 同上 |

第四次改用自然语言「授权提交」，模型才在 change 分支上手动提交这两个文件，之后起飞通过。

两个文件都是 propose 阶段的正当产出：前者是 scenario 骨架测试 import 的辅助模块，后者是 afa 约定的 ADR 索引（新 DRAFT 要登记一行）。插件只认三类工件（change 目录、`adr/DRAFT-*.md`、`scenario_tests` 映射到的测试文件），这类周边文件无处声明，碰到就必然拒飞。拒绝信息又只列路径，没说「授权提交」管不到这些文件，也没给出路，人自然会反复重试。

「工件之外一律拒飞、授权提交也不放行」是 `flight-takeoff-commit` 有意的 fail-closed 设计，本 change 保留它；要补的是合法周边文件的声明渠道，以及拒绝时可照做的出路。

## What Changes

- **`slices.json` 新增可选字段 `artifact_files`**：路径数组，相对 change worktree 根（与 `scenario_tests` 的路径同一基准），精确路径、不支持通配。起飞时列出的文件与三类工件同等对待：随「授权提交」或批准带按键一并提交；未声明的照旧算工件之外。`slices.json` 在计划指纹白名单内，声明须经人批准。
- **lint 校验 `artifact_files`**：必须是字符串数组；每项非空、不是绝对路径、不含 `..` 段、不含通配符（`*` `?` `[`）、不是已编号 ADR（`adr/NNNN-*.md`，ADR 不可改）。缺省时行为不变。
- **审批面板列出 `artifact_files`**：spec.html 飞行计划区单列一表，让人批准时看得到哪些工件之外的文件会被一并提交。
- **工件之外的拒绝信息给出路**：仍只列工件之外的路径，后面补两行：「授权提交」只提交本 change 的工件、不覆盖上面这些文件；处理办法是自行提交或撤销，或者属于本 change 的就列进 `artifact_files`、重新批准后起飞。起飞待命仍把这条拒绝归为只能人处理。
- **批准带的工件计数**含 `artifact_files` 中未提交的文件。
- **文档**：`opsx-apply` 命令与 `openspec-apply-change` skill、`opsx-propose` 命令与 `openspec-propose` skill 同改；schema 的 tasks instruction 写明 `artifact_files` 的用途；README 的飞行说明同步。
- 插件补丁版本 +1（0.10.4，见 Impact 的顺序）。

无 BREAKING：不写 `artifact_files` 的计划行为与现在相同，只有工件之外拒绝信息多了出路说明。

## Capabilities

### New Capabilities
- `flight-takeoff-artifact-files`：计划内声明工件之外的本 change 文件（`artifact_files`），起飞时按工件一并提交；lint 校验、审批面板列出；工件之外拒绝时给出可照做的出路。

### Modified Capabilities
（无：`openspec/specs/` 下还没有已归档的 spec；`flight-takeoff-commit` 的工件判定在本 capability 内扩展，原有三类不变。）

## Impact

- 插件：`template/plugins/flight/hooks/land.ts`（`classifyDirty` 增加声明文件入参）、`hooks/orchestrator.tsx`（读 `artifact_files`、拒绝文案）、`hooks/register.tsx`（批准带计数）、`.claude-plugin/plugin.json`。
- 判定器与渲染：`template/.claude/hooks/slice-gate.py`（lint）、`template/.claude/hooks/spec_html.py`。
- schema：`template/openspec/schemas/intent-driven/schema.yaml` 的 tasks instruction（只改说明文字）。
- 文档：`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`template/.claude/commands/opsx-propose.md`、`template/.claude/skills/openspec-propose/SKILL.md`、`README.md`。
- 测试：新增 `tests/test_flight_artifact_files.py`、`tests/test_artifact_files_plan.py`、`tests/test_artifact_files_docs.py`；TS 测试追加在 `land.test.ts`、`orchestrator.test.tsx`、`flight.test.tsx`。
- **顺序**：`flight-dispatch-followups`（正在飞）同样改 `orchestrator.tsx`、`register.tsx`、`flight.test.tsx` 与 `plugin.json`（0.10.3）。本 change 等它合入 main 后再起飞：起飞前把 main 预合并进本分支并重跑 baseline；S3 届时把它的版本断言 `tests/test_dispatch_followups_docs.py` 改成 0.10.4。
