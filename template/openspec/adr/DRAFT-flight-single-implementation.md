# DRAFT. 飞行只有一套实现：删除 Workflow 旧引擎，铁律 10 改为失效即停飞

- Status: accepted
- Date: 2026-10-12
- Supersedes:
  - DRAFT-flight-orchestrator-state-machine 第 7 条（旧引擎删除前可用 `--engine=workflow` 显式选择）；
  - DRAFT-flight-measure-protocol 中「Workflow 回退路径仍用 evidence.log」一条（第 5 条）；
  - 铁律 10 原文「回退必存在：新机制失效时回退路径语义一致（Workflow → Agent 派发；脚本渲染 → 保留占位）」的飞行部分。
- 关联：DRAFT-flight-control-plane-in-mod 第 4、5 条
- 来源 change：flight-retire-workflow-engine（design D1–D8）
- 被取代的 ADR 原文不动（铁律 6）。

## Context

- flight 插件已是飞行唯一的执行者：起飞检查、派发、收口门禁、合回、评审、修复、final、落地都由插件的控制面执行。
- 旧 Workflow 引擎仍留有两条入口：`--engine=workflow`，以及 `/opsx-apply` 命令文档里供模型照做的 step 0–7。
- 铁律 10（回退必存在，Workflow → Agent 派发）、铁律 3（回退路径由 hook 写 evidence.log）、铁律 11（收口 `--expect-models` 对账）与实际做法冲突：实际飞行不走回退路径，也不跑 `session-decompose.py`。
- DRAFT-flight-orchestrator-state-machine 与 DRAFT-flight-measure-protocol 已约定旧引擎与回退路径在阶段 3c 删除；DRAFT-flight-control-plane-in-mod 第 4 条要求控制面缺席即停飞、不维护第二实现，第 5 条要求新旧机制不长期并存、铁律条文随机制落地改写。

## Decision

1. **删除旧引擎**（design D1、D2）：删除 `.claude/workflows/opsx-apply.js`、`.claude/agents/integrator.md`、`.claude/agents/slice-executor.md`、`.claude/hooks/session-decompose.py`；`slice-gate.py` 删去 checkpoint 快照、`--resume-checkpoint`、门禁结论 ref、`waves` 别名、G5 的 log 模式与 `red_count`。
2. **兼容空壳与安装器迁移**（design D3、D5）：`slice-gate.py checkpoint`、`takeoff-gate.py` 的无参 hook 模式、`stop-gate.py` 保留为读掉 stdin、退出 0 的兼容空壳；模板 `hooks.json` 不再注册它们；`install.sh` 合并 settings 前移除与历代模板原样相同的退役注册，退役文件只列出、不替用户删。
3. **evidence.log 只作飞行外留痕，G5 只按账本**（design D2、D4）：`--evidence` 只接受 `ledger` 且为缺省值；`test-evidence.py` 在有 `.openspec-slice` 标记的 worktree 里一律不写，只给主会话修复、per-task 等飞行外路径留痕。
4. **铁律 3 / 10 / 11 新文**：
   - 3. TDD 与留痕：生产代码前必有先失败的测试；测试由可信方运行并留痕（飞行中 = 控制面测量写入账本；飞行外 = hook 写 evidence.log），不接受自述。
   - 10. 失效即停飞、不回退第二实现：飞行控制面（flight 插件与判定器）缺席或失效 → 不起飞，在飞即停飞并如实记录；不回退到另一套飞行实现。与飞行无关的机制按各自约定降级（脚本渲染失败 → 保留占位），与飞行无关的护栏照常。
   - 11. 末句改为：收口从账本机械对账各角色实际模型（不符即阻断）。其余不变。
5. **`--engine=workflow` 由插件明确拒绝**（design D8）：参数含 `--engine=workflow` 时插件直接作答、不交给模型、不写任何事件，提示旧引擎已删除、去掉该参数再发 `/opsx-apply <change>`。`--gate=per-task` 仍是唯一非飞行路径。

否决的方案：
- **保留 Workflow 引擎作为插件失效时的回退**：两套实现的语义会漂移，回退路径无人演练，且其证据（evidence.log、自述模型）不满足判据禁自证。

## Consequences

- **更易**：只维护一套飞行实现，命令文档、README、铁律与实际做法一致；G5 与模型对账只有账本一个真值源。
- **更难**：flight 插件缺席、未加载或版本不符时就不能飞，只能停飞并修好插件（这已是现状）。
- **中性**：兼容空壳与安装器的退役注册清理保留到阶段 4 插件化分发时删除。
