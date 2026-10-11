## Why

2026-10-11 起飞 `flight-gate-speedup` 时，人连发三次 `/opsx-apply`，都没起飞：

| 输入 | 插件回复 | 原因 |
|---|---|---|
| `/opsx-apply flight-gate-speedup授权提交` | 找不到分支为 `worktree-flight-gate-speedup授权提交` 的 worktree | 参数按空白切分，第一个不以 `--` 开头的词就是 change 名，粘在一起的「授权提交」被当成了名字的一部分 |
| `/opsx-apply flight-gate-speedup 授权提交`（两次） | 工作区不干净，不起飞（列出 24 个未提交文件） | `takeoff()` 只会自动提交上一次飞行遗留的记录文件；「授权提交」被直接丢掉。未提交的全是 `/opsx-propose` 刚写好的工件与 scenario 骨架 |

`/opsx-propose` 收尾时只提示「把工件单独 commit」，插件起飞又要求工作区干净。人已经在命令里写明授权提交，却还得等模型或自己手动提交，再重发一次命令。

## What Changes

- **「授权提交」**：`/opsx-apply <change> 授权提交`（或者把「授权提交」直接粘在 change 名后面）起飞时，插件先过起飞守卫（批准与指纹）。之后如果未提交的改动全是本 change 的工件，插件就只提交这些文件，然后照常起飞。
- **工件的机械判定**：
  - change 目录下的文件（飞行记录文件仍按现有逻辑单独提交）；
  - 同一 openspec 根下的 `adr/DRAFT-*.md`；
  - `slices.json` 里 `scenario_tests` 映射到的测试文件。

  其余一律算工件之外，包括已编号的 ADR。
- **拒绝信息更具体**：
  - 不带「授权提交」、但未提交的全是工件 → 仍拒绝，并提示可以改发 `/opsx-apply <change> 授权提交`；
  - 有工件之外的未提交改动 → 不论带不带「授权提交」都拒绝，只列出工件之外的文件。
- **文档**：`opsx-apply` 命令与 `openspec-apply-change` skill 的 Input 段写明「授权提交」；`opsx-propose` 命令与 `openspec-propose` skill 的硬交接写明可以直接发 `/opsx-apply <name> 授权提交`。两对命令与 skill 同改。
- 插件补丁版本 +1。

无 BREAKING：不带「授权提交」时，只有拒绝信息的措辞变了。

## Capabilities

### New Capabilities
- `flight-takeoff-commit`：起飞时经「授权提交」只提交本 change 的工件；工件的机械判定；未授权或有工件之外改动时拒绝，并给出具体提示。

### Modified Capabilities
（无：`openspec/specs/` 下还没有已归档的 spec。）

## Impact

- `template/plugins/flight/hooks/land.ts`（新增纯函数 `classifyDirty` 与 `commitArtifacts`）、`template/plugins/flight/hooks/orchestrator.tsx`（`takeoff()` 的参数解析与脏工作区处理）、插件补丁版本 +1。
- 文档：`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`template/.claude/commands/opsx-propose.md`、`template/.claude/skills/openspec-propose/SKILL.md`。
- 测试：新增 `tests/test_flight_takeoff_commit.py`、`tests/test_takeoff_commit_docs.py`；TS 测试追加在 `land.test.ts` 与 `orchestrator.test.tsx`。
- **顺序**（人已选定，2026-10-11）：等 `flight-measure`（正在飞，S7 也改 `takeoff()`）合入后再起飞。起飞前把 main 预合并进本分支并重跑 baseline。`flight-gate-speedup` 的 S5 也改 `opsx-propose` 命令与 skill，同样在预合并时解决。
