## Why

#61 合入后（main `ff19ecd`，插件 0.11.0）复盘近三次落地，核实出 3 个结构性问题与 3 处小问题。人在 2026-10-14 的决策页 `docs/flight-post-61-adjustments.html` 里全选第一项，并要求合成一个 change。

| # | 问题 | 证据 |
|---|---|---|
| A | 预合并 main 让 final 与全量评审必然过期 | 落地是「final → land → 交接 pr-ship」，pr-ship 第 4 步才预合并；#59、#60、#61 预合并都有冲突，人合并后 `ship` 都判「final 过期 / 全量评审过期」→ draft，最后都由人跳过裁决合入。合并部分（含解冲突改的代码）既没跑 final 门禁，也没被独立评审 |
| B | 计划错误导致的停飞仍给「续飞」 | flight-shelve-followups 的 S3 因 G5「在改生产代码之前就已通过」停飞；计划不改时结果确定，attempt 2、3 原因一字不差，S3 共耗 131 分钟。诊断员三次都说「改计划」，但按 design D6 只供展示 |
| C | 插件 TS 测试的失败，全量门禁看不见 | `assert_ts_passed` 只核对点名用例，不看 `claude plugin test` 的结果；main 上 `orchestrator.test.tsx` 收尾留下未处理拒绝（`no implementation for turn.step`），插件测试报 1 fail，全量 pytest 却 631 全绿 |
| D1 | 命令认领 hook 吞掉下游原始错误 | `register.tsx:702`：下游已执行且抛错时统一改答「flight：命令执行出错」，`/opsx-propose` 等命令的错误被记到 flight 头上（#61 评审 LOW） |
| D2 | 改名行的拒绝出路说明不适用 | 「工件之外」拒绝信息建议把文件列进 `artifact_files`，但改名行无论是否声明都被拒（#60 规则） |
| D3 | 历史 change 的 scenario 映射还写着改名前的测试函数名 | 不影响任何门禁（#61 评审 LOW）；人选「只记录、不改」 |

## What Changes

- **落地前预合并目标分支**（A）：
  - 收口阶段、本 attempt 第一次 final 之前，控制面在 change worktree 把目标分支（`origin/HEAD` 指向的分支，解析不出用 `main`）合进 change 分支；
  - 无冲突 → 直接合并，记 `premerge` 事件；已包含 → 不合并只记账；没有 `origin` → 跳过并记账；拉取失败 → 停飞（kind `premerge`）；
  - 有冲突 → 派解冲突 agent 在独立 worktree 里解，收口跑 final 门禁，绿则 change 分支快进；解不开 → 停飞，人解完后 `/flight resume`；
  - final 与全量评审都在合并后的提交上做；全量评审的起点改为合入的目标提交，评审范围恰为本 change 的改动（含解冲突）。
- **落地后重验 `/flight recheck <change>`**（A）：落地后 HEAD 又有代码改动（例如人工预合并）时，另起一个 attempt，不派执行体，直接预合并 → final → 全量评审 → 落地 → 交接 pr-ship；final 仍新鲜时拒绝。
- **计划需修订**（B）：最新停飞里有切片因 G5「在改生产代码之前就已通过」被阻断时，计划不改就不许续飞：`/flight resume` 拒绝，批准带显示「计划需修订：<原因>」、不画「续飞」（仍可搁置）；改计划后照常出现「批准修订并续飞」。
- **插件测试零失败**（C）：`tests/test_flight_plugin.py` 增加对 `claude plugin test` 全部失败行的解析，全量 pytest 断言真实插件测试零失败；修掉 `orchestrator.test.tsx` 收尾的未处理拒绝。
- **小修**：D1 保留下游原始错误；D2 改名行给「git mv 回原名或自行提交」的出路；D3 记在 design，不改历史 change。
- **文档**：`opsx-apply` 命令与同名 skill 同改；`flight:pr-ship` 第 4 步说明飞行内已预合并、落地后再冲突用 `/flight recheck`。
- **ADR**：新增 `DRAFT-flight-premerge-before-final`。
- 插件 0.12.0。

**BREAKING**（插件使用方）：
- 账本新增事件类型 `premerge`、停飞 kind `premerge`：升级插件须同步更新主检出的 `.claude/hooks/`（起飞时 `checkJudges` 要求判定器认识全部事件类型）。
- 落地前会把目标分支合进 change 分支（只在本地 change worktree，不推送、不碰 main）。

## Capabilities

### New Capabilities
- `flight-landing-premerge`：落地前预合并、冲突派解冲突 agent、全量评审起点、`/flight recheck`。
- `flight-plan-defect-halt`：计划缺陷停飞不给续飞，批准带显示「计划需修订」。
- `flight-test-suite-hygiene`：插件 TS 测试零失败纳入全量 pytest。
- `flight-small-fixes`：认领 hook 保留下游错误；改名行的拒绝出路。
- `flight-premerge-docs`：命令、skill、pr-ship 文档与插件 0.12.0。

### Modified Capabilities
- 无（仓库没有主 specs 目录）。

## Impact

- **判定器**：`template/.claude/hooks/ledger.py`（`premerge` 事件、halt kind `premerge`）。
- **插件**：`hooks/core.ts`（收口加预合并、计划缺陷判定）、`orchestrator.tsx`（执行预合并、解冲突、`/flight recheck`、续飞拒绝、改名出路）、`landing.tsx`（全量评审起点）、`land.ts`（解冲突现场合并目标分支）、`prompts.ts`（解冲突提示）、`io.ts`（事件表）、`register.tsx`（批准带、认领 hook）、`types/index.d.ts`、`.claude-plugin/plugin.json`。
- **文档**：`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、`template/plugins/flight/commands/pr-ship.md`。
- **ADR**：`template/openspec/adr/DRAFT-flight-premerge-before-final.md`。
- **测试**：新增 6 个 pytest 文件；TS 用例追加在 `orchestrator.test.tsx`、`flight.test.tsx`；`io.test.ts` 事件清单、`test_band_session_scope_docs.py` 版本断言随之更新。
