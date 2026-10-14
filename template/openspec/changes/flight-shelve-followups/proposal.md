## Why

2026-10-14 人反馈批准带「一直弹出」`flight-review-followups` 与 `flight-hardening`。查明：
- `flight-review-followups` 在 2026-10-11 批准后从未起飞。批准带对「已批准、尚未起飞」的项永远显示「起飞」，没有任何撤下入口；它的计划基于 #45，落后 main 12 个 PR，误按会在旧代码上起飞。人只能手动删 change 目录。
- `flight-hardening` 只在 0.9.0 及更早的插件下显示（先判停飞、后判落地），0.10.x 已不显示，不在本 change 范围。

删掉的 `flight-review-followups` 里有 3 个问题在 main（`ed53487`）上仍未修（其余 2 项已由 #47 做掉或已过时）：

| # | 来源 | 问题 |
|---|---|---|
| 1 | #44 评审 MEDIUM | `classifyDirty` 把 porcelain 改名行（`a -> b`）当成工件：`git add` 失败后报「提交工件失败」。`flight-dispatch-followups` 记进 backlog 的「Y 位改名」是同一类 |
| 2 | #44 评审 MEDIUM | 人要「确认无误」，却只看得到工件个数：手打命令的拒绝信息、起飞回复、批准带说明行都只写「N 个」 |
| 3 | #45 评审 MEDIUM | 基线已有预存红时，pytest-cov 覆盖率未达标会被放过：它把退出码改成 1，失败用例数不变，差分后判绿 |

人在 2026-10-14 选定：四项合成一个 change；撤下入口做成批准带上的「搁置」按钮，在账本记事件；与 `flight-dispatch-followups` 并行，从当前 main 切。

## What Changes

- **批准带「搁置」**（新）：
  - 可操作的项（没有问题、不在进行中）在主按钮旁多一个次要按钮「搁置」；
  - 按下后，插件在账本记一条 `shelve` 事件，带当前计划指纹；
  - 搁置后：这个指纹不再出现在批准带上，此前的批准作废，起飞守卫拒飞并说明「已搁置」；
  - 计划一改（指纹变化），批准带重新显示「批准起飞」（停飞的显示「批准修订并续飞」）；
  - 主检出的判定器不认识 `shelve` 时拒绝搁置，不写账本，避免旧判定器把账本判成损坏。
- **批准带读账本改用主检出的判定器**：与起飞一致；主检出没有判定器时沿用 change 所在 worktree 的（同现状）。这样，基于旧 main 的陈旧 worktree 被搁置后，账本不会被它自带的旧 `ledger.py` 判成损坏。
- **改名行归为工件之外**（问题 1）：路径含 ` -> ` 的一律归为工件之外（X 位、Y 位都算），起飞按「工件之外」拒绝，不提交任何文件。
- **逐行列出工件**（问题 2）：
  - 手打 `/opsx-apply <change>` 因只有工件而拒绝时，逐行列出工件；
  - 经「授权提交」起飞的回复逐行列出已提交的工件；
  - 批准带说明行之下逐行列出将被提交的工件，最多 5 行，其余写「…另 N 个」。
- **覆盖率未达标不可度量**（问题 3）：`gate.test` 的输出含 pytest-cov 的覆盖率失败标记时，判不可度量、按退出码判红，理由写「覆盖率」并提示 `--no-cov`。
- **文档**：`opsx-apply` 命令与 `openspec-apply-change` skill 同改，写明「搁置」与「已搁置」。
- **ADR**：新增 `DRAFT-approval-revocable-by-shelve`，supersede `DRAFT-approval-bound-to-plan-fingerprint`（批准判据加上「其后未被搁置」）。
- 插件补丁版本 +1（不写死版本号；与 `flight-dispatch-followups` 的 0.10.3 后合者解冲突）。

**BREAKING**（对插件使用方）：账本新增事件类型 `shelve`。插件起飞要求判定器认识全部事件类型，所以升级插件后须同步更新主检出的 `.claude/hooks/`（与以往新增事件相同）。

## Capabilities

### New Capabilities
- `flight-band-shelve`：批准带「搁置」；`shelve` 事件撤销批准；起飞守卫拒飞「已搁置」；改计划后重新出现；判定器不认识时拒绝；批准带读账本用主检出的判定器。
- `takeoff-dirty-reporting`：改名行归为工件之外；拒绝信息、起飞回复、批准带逐行列出工件。
- `test-gate-coverage-failure`：pytest-cov 覆盖率未达标时全量测试不可度量、按退出码判红。
- `flight-shelve-followups-docs`：命令与 skill 写明「搁置」；插件版本高于 0.10.2。

### Modified Capabilities
- 无（仓库没有主 specs 目录，以上都以 ADDED 记在本 change 目录）。

## Impact

- **判定器**：`template/.claude/hooks/ledger.py`（`shelve` 事件、`latest_decision`）、`takeoff-gate.py`（「已搁置」）、`slice-gate.py`（`run_test_gate`）。
- **插件**：
  - `template/plugins/flight/hooks/register.tsx`（搁置按钮与按键、读账本的判定器、列工件）；
  - `io.ts`（事件表加 `shelve`）、`land.ts`（`classifyDirty`）、`orchestrator.tsx`（拒绝信息与起飞回复）、`types/index.d.ts`；
  - `.claude-plugin/plugin.json`（补丁版本 +1）。
- **文档**：`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`。
- **ADR**：`template/openspec/adr/DRAFT-approval-revocable-by-shelve.md`。
- **测试**：新增 5 个 pytest 文件；TS 测试追加在 `flight.test.tsx`、`orchestrator.test.tsx`；`io.test.ts` 的事件类型清单、`test_dispatch_origin_docs.py` 的版本断言随之更新。
- **与 `flight-dispatch-followups`（待批准）重叠**：都改 `register.tsx`、`orchestrator.tsx`、`types/index.d.ts`、`plugin.json`、`test_dispatch_origin_docs.py`；后合入的一方预合并 main 时解冲突并重跑 baseline。
