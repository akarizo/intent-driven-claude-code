# DRAFT. 落地前由控制面把目标分支合进 change 分支，final 与全量评审在合并后的提交上做

- Status: accepted
- Date: 2026-10-14
- 关联：DRAFT-flight-orchestrator-state-machine、DRAFT-flight-bounded-self-heal、DRAFT-approval-revocable-by-shelve

## Context

飞行的落地顺序是「最后一片合回 → final 门禁 → 全量评审 → land → 交接 `/flight:pr-ship`」；`/flight:pr-ship` 第 4 步要求先与目标分支预合并、解完冲突才能建 PR。`ship` 裁决只认「final 之后只改了记账文件」。

并行 change 常改同一批文件，2026-10-14 的 #59、#60、#61 预合并全部有冲突：人合并后 HEAD 变化，`ship` 必判「final 过期 / 全量评审过期」，PR 只能是 draft，最后都由人跳过裁决合入。合并带进来的代码与解冲突改的代码既没跑 final 门禁，也没有独立评审——铁律 4、5 在最需要它们的地方失效。

## Decision

1. **落地前预合并**：收口阶段、本 attempt 第一次 final 之前，控制面在 change worktree 把目标分支合进 change 分支（目标 = `origin/HEAD` 指向的分支，解析不出用 `main`）。只动本地 change 分支：不推送、不合进 main、不合 PR。这一步是落地流程的组成部分，由飞行计划的批准授权；铁律 6「不自动 merge」指不合进 main、不合 PR，不禁止它。
2. **冲突交解冲突 agent，解不开停飞**：有冲突时派解冲突 agent 在独立 worktree 里解（不在 change worktree 里留合并现场），收口跑 final 门禁；绿则 change 分支快进到它的合并提交。解不开、收口红或快进失败即停飞（kind `premerge`），由人解完后续飞。不自动丢弃任何一边的改动。
3. **门禁与评审都在合并后的提交上**：final 在预合并之后跑；全量评审的起点是合入的目标提交，评审范围恰为本 change 相对目标分支的改动（含解冲突）。
4. **落地后再变要重验**：落地之后 HEAD 又有记账文件以外的改动（例如人工再次预合并），由人发 `/flight recheck` 让控制面另起 attempt 重跑预合并、final 与全量评审；不允许以人工或模型改 draft / ready 代替重验的结论（人类 PR review 照旧可以否决）。
5. **账本留痕**：每次预合并记一条 `premerge` 事件（成败、合入的目标提交、合并后的 HEAD、冲突文件、原因）；预合并导致的停飞记 kind `premerge`。

## Consequences

- **更易**：常规落地（无冲突或冲突可解）得到新鲜的 final 与评审，`ship` 可以判 ready；PR 上的裁决重新可信。
- **更难**：落地前多一次拉取与合并，网络不可用时落地会停飞；解冲突 agent 改的是本 change 以外的代码（他人刚合入的改动与本 change 的交界），其结果完全依赖随后的 final 门禁与全量评审把关。
- **边界**：只合 `origin` 上的目标分支；`/flight:pr-ship` 指定别的 target 时，飞行内的预合并不覆盖，仍可能在 pr-ship 第 4 步遇到冲突，按第 4 条重验。
