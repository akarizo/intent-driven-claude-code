# DRAFT. apply 作为一次飞行：所有权切片 + 确定性调度 + 机械门禁 + 离路径评审

- Status: accepted, supersedes ADR-DRAFT-review-orchestration-watermark
- Date: 2026-09-10
- Supersedes: DRAFT-review-orchestration-watermark（合并时回填真实号）

## Context

2026-09-10 对本机 5 个正在运行「逐 task 守门」apply 的会话做逐段归因（约 100h wall clock、283 个子 agent 转录）：等子 agent 占工作时间 63–82%，子 agent 时间里 review + fix 占 64–80%，fix 子 agent 数 ≥ impl 数，每 task 链路 22–106 min；实现类子 agent 42–84 轮而工具执行不到 1 分钟；主会话回报全量灌回导致上下文 619–847k、每轮延迟 3–4 倍。等人只是过夜空档。

水位线 ADR 解决的是「多层评审重复扫同一段代码」。本决策把评审层减到一层（每切片并行、离关键路径），多层去重的前提消失，故 supersede 它，而不是在其上叠加。

## Decision

apply 采用「飞行」模型，五条原则：

1. **规格可执行**。tasks 阶段为每个 scenario 生成待通过的测试骨架并记录映射；apply 的完成判据 = 全部 scenario 测试通过且骨架标记已去。批准 spec.html 即批准验收测试。
2. **切片有所有权**。tasks 由 `slices.json` 生成：每片声明 `owns` / `deps` / `verify` / `scenarios`；同 wave 所有权不相交由 lint 保证；执行体写 owns 之外的文件由门禁 DENY。
3. **调度用确定性脚本**。默认由命名工作流 `opsx-apply` 按 DAG 分 wave 并行派发；门禁 JSON 决定重试一次或 blocked；主会话只收最终 JSON。Workflow 不可用时按同一 waves 用 Agent 工具并行派发，语义一致。
4. **评判用机械门禁**。每切片跑 `slice-gate`（verify / 子集测试 / 源码-测试配对 / GWT / RED 先于 GREEN / 所有权 / scenario 状态），收口跑全量门禁；测试运行由 hook 留痕，不靠自述。
5. **评审离关键路径**。每切片一个干净 reviewer 在门禁绿后并行发起，禁止重跑测试套件；CRITICAL/HIGH 汇总后一次批量修复；MEDIUM/LOW 贴 PR。

配套：批准（= 运行 `/opsx-apply`）到 PR 打开之间零问询；每次 apply 打印飞行记录（批准→PR 用时、子 agent 数、门禁红次数、主会话峰值上下文）；逐 task 阻断式守门降为 `--gate=per-task` 可选。

## Consequences

- **更易**：中等变更关键路径从 8–22h 工作时间降到约 1h 的量级；主会话上下文回到几十 k；并行安全与范围控制由所有权机械保证。
- **更易**：spec compliance、scenario 覆盖、RED 证据三类审查消失——它们由构造保证。
- **更难**：规划器必须写出合法的 slices.json（所有权不相交、深度 ≤ 3），规划质量成为前置约束；执行体受 maxTurns 与所有权双重约束，超预算即 blocked。
- **更难**：reviewer 失去「自己跑一遍」的自由，只能读门禁报告与留痕；这是刻意的。
- **约束后续变更**：任何新增的评审 / 守门点必须回答「是否在关键路径上、是否重复门禁已判定的项」；新增审查维度优先落为门禁检查项而非 reviewer 职责。
- **不影响**：`/opsx-archive`、`/opsx-sync`、ADR 不可改、openspec 归档契约。
