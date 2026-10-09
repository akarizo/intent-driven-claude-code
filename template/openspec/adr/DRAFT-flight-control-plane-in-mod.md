# DRAFT. 飞行控制面迁入 Claude Code mod，判定器保持纯 Python

- Status: accepted
- Date: 2026-10-09
- 关联：DRAFT-approval-bound-to-plan-fingerprint（本迁移的第一个落地决策）· DRAFT-apply-as-flight（其「编排宿主」部分将在编排迁移的 change 中被取代）· DRAFT-model-routing-defaults-for-template（其「判定主模型」部分将在路由迁移的 change 中被取代）
- 评审记录：`docs/flight-control-plane.html`（根因诊断 · 原则 P1–P9 · 决策 D1–D7 · 2026-10-09 实测 S1–S8）

## Context

飞行模式的编排器是 Workflow 脚本，而 Workflow 运行时按设计禁止副作用（`opsx-apply.js:19`：「脚本本身不碰文件系统，全部由 agent 执行」）。于是 git 合回、跑门禁、记账这些机械动作只能派模型做，机械事实也只能经模型之口传回编排器；飞行状态散在标记文件、gate-report、evidence.log 里，被多个脚本各自推导。2026-09 至 2026-10 有出处的 12 条飞行缺陷可归入六类根因：判据经模型转述（R1）、状态无单一写者（R2）、机械动作交给模型（R3）、编排器无副作用权（R4）、证据放在工作区（R5）、路由靠约定与事后对账（R6）；其中 R1、R3 是 R4 的下游。

Claude Code 2.1.2xx 提供 mod（函数 hook 插件）：在进程内运行，能直接读引擎事实（`$.session.model()`、`agent.spawn` 的 `parentModel` 与实际解析模型、`prompt.submit` 的来源），有副作用权（`$.process.run`、`$.fs`、`$.agent.spawn`），能观测所有 loop 的 `tool.call`（带 `agentId`），能与人交互（按钮、状态行、面板、通知）。2026-10-09 在 2.1.295 上实测：自主派发、子 agent 全可见与越界拦截、按钮按压、git 账本、`classic.SubagentStop` 续跑、项目级分发、事件驱动重派均成立；`prompt.compose` 在跨进程续接时有约 24k 的缓存写入代价。API 文档原文标注 early access、跨版本会变。

## Decision

1. **控制权（编排、状态、证据、路由、审批）迁入一个 Claude Code 插件（mod），作为可信执行面**：唯一的飞行状态写者、唯一的账本写者、唯一运行判定器的一方。模型只做创造性工作（写代码、评审、修复、解冲突），其返回值只作信息、不作判据。
2. **判定器保持纯 Python 命令行工具**（事实 → 裁决），不依赖 mod API，可在 CI 独立运行、由 pytest 覆盖；插件只是调用它们的薄适配层。
3. **证据账本放在 git 引用上的提交链** `refs/flight/<change>/ledger`，不放工作区文件。
4. **控制面缺席即停飞**：插件未安装、版本低于实测下限或失效时，飞行不得起飞；不维护一条语义可能漂移的第二实现。与飞行无关的护栏（claudemd-lint、memory-lint 等 classic hook）照常工作。
5. **分阶段迁移，每阶段一个 change，条文随机制落地**：先切换起飞批准（账本 + 指纹），再迁编排（取代 Workflow 与 integrator）、再迁收口与分发、最后用 `claude plugin eval` 的有 / 无插件对照证明效果。新旧机制不长期并存；铁律条文只在对应机制真正生效的 change 中改写。
6. **飞行永远运行已安装的稳定版本**；正在修改控制面的 change 只由测试验证，合入后再升级，不自举。

否决的方案：
- 保留 Workflow 调度、mod 只做守卫与账本：机械角色仍需 agent（R3 残留）；Workflow 起的 agent 在 `agent.spawn` 上只能拒不能改模型（类型定义），路由偏差仍要事后对账。
- 保留旧 Workflow 路径作为第二实现：两套语义并存是漂移源，与「命令与同名 skill 同改」已经付出的维护成本同类。
- 把判定器也搬进 mod（TS）：判定器失去宿主无关性与 CI 可运行性，API 变动的影响面不再有上限。

## Consequences

- **更易**：判据来自引擎事件与 git，不再从转录推断；机械角色变成代码，零 token；状态单一写者，读者不再各自推导；飞行进度可在会话内实时可见。
- **更难**：仓库及下游仓库依赖 Claude Code 版本下限与插件安装；mod API 变动需要随版本回归（插件测试接入 pytest 门禁）；控制面需自建并行、重试、续跑（Workflow 原本提供）。
- **中性**：本仓库从此是 Claude Code 专属——仓库名本就如此；判定器在 CI 中仍可脱离 Claude Code 运行。
- **后续**：编排迁移、路由迁移各自立 change，并在其中以新 ADR 取代 `DRAFT-apply-as-flight` 与 `DRAFT-model-routing-defaults-for-template` 的相应决策。
