## Why

阶段 3 的状态机已经接管飞行（#39 起），测量协议与包络也已就位（#40–#48）。旧的 Workflow 引擎却还完整留在仓库里，并且仍有两条入口：
- 人显式加 `--engine=workflow`；
- 插件没拦下命令时，模型照着 `/opsx-apply` 的 step 0–7 走下去，等于一条隐式回退。

这和已接受的 `DRAFT-flight-control-plane-in-mod` 第 4 条冲突：控制面缺席即停飞，不维护一条语义可能漂移的第二实现。仓库铁律也和实际做法不一致：
- 铁律 10 还写着「回退必存在（Workflow → Agent 派发）」；
- 铁律 3 的「回退路径 = hook 写 evidence.log」指向旧引擎；
- 铁律 11 的「收口 `--expect-models`」也指向旧引擎，插件早已从账本对账。

`DRAFT-flight-orchestrator-state-machine` 与 `DRAFT-flight-measure-protocol` 都约定：旧引擎、integrator、门禁结论 ref、evidence.log 回退路径在 3c 删除，届时改写铁律 10。本 change 就是那一步（3c 的前半，交互与 abort 另立 change）。

## What Changes

- **删除旧引擎本体**：`template/.claude/workflows/opsx-apply.js`、`agents/integrator.md`、`agents/slice-executor.md`、`hooks/session-decompose.py`，以及专测它们的测试。
- **slice-gate 只留插件在用的部分**（用户定：G5 只留账本判据）：
  - 删除：checkpoint 快照、`--resume-checkpoint`、门禁结论 ref 的保存与找回、`waves` 别名、G5 的 evidence.log 模式（`evidence_state`、`hooks_missing`）、只给 stop-gate 用的 `red_count`；
  - 保留：`start`、`record`、`--expect-branch`、`--base`；
  - `--evidence` 只接受 `ledger` 且为缺省。
- **已注册的旧 hook 保持安全**：
  - 兼容：`slice-gate.py checkpoint`、不带参数的 `takeoff-gate.py`（hook 模式）、`stop-gate.py` 都改为什么都不做、退出 0 的兼容入口；
  - 原因：已安装项目与本仓库根的 settings 仍注册着它们，`stop-gate.py` 还是不带存在保护直接调用的，直接删除会让 Stop hook 报错、卡住会话；
  - 不再注册：模板 `hooks.json` 去掉这些注册；
  - 安装器：`install.sh` 升级时按历代下发的原样命令串移除这些注册，并列出可删除的退役文件，不替用户删。
- **test-evidence 只管飞行外**（用户定：保留作飞行外的留痕）：切片 worktree（有 `.openspec-slice` 标记）一律不写；主会话修复、per-task 路径照写。
- **文档只讲插件一条路**：
  - `/opsx-apply` 命令与同名 skill 删除 `--engine=workflow`、旧引擎的 step 0–7、路由表里的 slice-executor 与 integrator；
  - 写明插件缺席或没有接管本命令时，模型看到本命令即停飞，并给出安装与重载指引；
  - `--gate=per-task`、`--takeover` 保留；
  - git 纪律 skill 改写为插件的 worktree 与分支；
  - `/pr-ship` 与 code-reviewer 里的「Workflow 回退路径：evidence.log」改为「飞行外：evidence.log」。
- **改写铁律 3、10、11**（仓库根 CLAUDE.md、`template/CLAUDE.md.snippet`）：
  - 第 10 条改为「失效即停飞、不回退第二实现」；
  - README 与 `docs/WORKFLOW_zh.md` 同步；
  - 新写一份 ADR 记录这次删除与改写，取代相关旧条款。
- **插件**：`/opsx-apply <change> --engine=workflow` 明确拒绝并说明旧引擎已删除；`--gate=per-task` 照旧交给模型（护栏 scenario）。插件版本 0.5.0。

**BREAKING**：`--engine=workflow` 不再可用。这是 ADR 早已约定的删除。

## Capabilities

### New Capabilities
- `flight-retire-slice-gate`：slice-gate 去掉旧引擎机制，G5 只按账本判。
- `flight-retire-hooks`：takeoff-gate hook 模式、stop-gate、checkpoint 变为兼容空壳；test-evidence 只管飞行外；模板 hooks.json 去掉退役注册。
- `flight-retire-install`：安装器移除退役 hook 注册并列出退役文件。
- `flight-retire-docs`：`/opsx-apply`、git 纪律、`/pr-ship`、code-reviewer 只讲插件路径。
- `flight-retire-rules`：铁律 3 / 10 / 11、README、WORKFLOW 文档与新 ADR。
- `flight-retire-engine`：删除旧引擎文件；插件拒绝 `--engine=workflow`、per-task 照旧透传。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **判定器与 hook**：
  - `template/.claude/hooks/` 下的 `slice-gate.py`、`takeoff-gate.py`、`test-evidence.py`、`stop-gate.py`、`hooks.json`；
  - 删除 `session-decompose.py`。
- **模板**：
  - 删除 `workflows/opsx-apply.js`、`agents/integrator.md`、`agents/slice-executor.md`；
  - 改写 `commands/opsx-apply.md`、`commands/pr-ship.md`、`agents/code-reviewer.md`，以及 skills `openspec-apply-change`、`openspec-git-discipline`；
  - 改写 `install.sh`、`template/CLAUDE.md.snippet`。
- **仓库**：
  - 改写根 `CLAUDE.md`、`README.md`、`docs/WORKFLOW_zh.md`；
  - 新增 ADR `template/openspec/adr/DRAFT-flight-single-implementation.md`。
- **插件**：`orchestrator.tsx` 与其测试；版本 0.5.0。
- **测试**：删除 `tests/test_agents_workflow.py`，其中 code-reviewer 相关的用例迁出；`test_slice_gate.py`、`test_evidence_timeline.py`、`test_approval_gate.py`、`test_template_docs.py`、`test_docs_iron_rules.py`、`test_opsx_apply_engine.py`、`test_ship_verdict.py`、`test_install.py`、`test_flight_orchestrator.py` 相应删改。
- **本仓库根的 `.claude/settings.json` 不改**：主检出有未提交的本地改动，改了会挡住快进。其中已退役的 hook 靠兼容空壳安全空转，由人自行清理。
