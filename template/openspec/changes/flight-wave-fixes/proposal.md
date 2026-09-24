## Why

2026-09-24 stc-foundation PR #7 那次飞行（workflow run `wf_3621d906-fb2`，3 个 wave、7 个切片）与本仓 #32 那次飞行（`wf_0cb8da3b-5c8`）暴露了同一组模板缺陷。证据已逐条核对 journal / timeline / gate-report / git，核实页见 `docs/flight-wave-fixes.html`。

**A · expectHead 只取一次**：wave 2、3 每个切片首轮都 `G0 base: worktree HEAD 不是 79360023ce`，实际 HEAD 是合回后的 `d4c36c5` / `f1e6b95`；5 次白派发，S6 的重试额度被 G0 占掉，真实只跑一次就 blocked。本仓 #32 的 S3（单切片 wave、不开隔离）首轮与重试两次 G0 → blocked。根因：`opsx-apply.js:34` 的 `expectHead` 起飞时取一次，之后每个 wave 都拿它比对，且比对由执行体（模型）做。

**B · integrator 合回时自跑 final**：integrate:w1、w2 自己跑了 `slice-gate.py final`，把后续 wave 尚未解锁的 scenario 当失败——多出两行 final red、两条 `wave<i>` infra blocked 误报，「门禁红次数」从 2 虚增到 4，三个 wave 的 integrator 返回三种形状。根因：合回派发与 Finalize 共用 GATE schema（`opsx-apply.js:151-157`），`integrator.md` 第 3 项「全量门禁」无条件可跑。

**D · ship 要求 final 对齐 HEAD**：收口时 `ship` 判「final 过期」、要重跑 final（stc 1 次，#32 2 次）；PR 转 ready 后再提交飞行记录，final 又落后于 HEAD。根因：`slice-gate.py:873` 要求 final 行 commit 等于 HEAD，而收口顺序本身就是 final 之后才提交记账文件。

**F · 拉不到被当成无变更**：`gh pr diff` 在 diff 超 2 万行时返回 HTTP 406，这次是评审员自行改用本地 diff 才没出事。根因：`pr-ship.md:131` 与 `code-reviewer.md:32` 把「为空」与「拉不到」合并成「报告无变更并停止」——照字面执行，大 PR 会被静默跳过评审（铁律 4）。

**H · .flight 未被忽略**：`.flight` 未跟踪也没被忽略，integrator 三次在 warnings 里报它。根因：模板 `openspec/.gitignore` 只忽略 `.mini-active`；`install.sh:346` 对 openspec/ 从不覆盖，只改模板到不了已安装的仓库。

**I · 回退路径写了 effort**：回退路径写着 `effort: high`，但 Agent 工具没有这个参数。文档错；实际 effort 由 agent frontmatter 决定，数值本来就对。

A 在交接里的修法 ①（脚本改取 integrator 返回的 commit）被同一份 journal 否定：w1 返回的是它最后一次提交后的 HEAD，w2 返回的是 final 时的 `6bc66a7`，实际 tip 却是 `f1e6b95`。判据只能来自 git（`DRAFT-gate-evidence-not-self-reported`）。

**决策来源**：2026-09-24 决策页 Q1–Q7（`docs/flight-wave-fixes.html`），用户选全部推荐项：范围 A、B、D、F、H、I；A 用 start 祖先校验；B 用独立返回结构；合为一个 change。

## What Changes

- **A · 基点校验按分支实时位置、由脚本判定**：`slice-gate.py start` 新增 `--expect-branch <branch>`，写标记前校验「该分支当前 tip 是 HEAD 的祖先」。不成立或分支不存在 → stdout 打印 `{"slice","ok":false,"commit":"","failed":["G0 base: …"]}`、exit 1、不写标记（随后 gate 因无 base 拒绝，失败即关）。`opsx-apply.js` 的参数 **`expectHead` 退役、换成 `branch`**，每个执行体（每个 wave、首轮与重试）的 start 都带 `--expect-branch`；删去执行体第零步的首轮 HEAD 比对。执行体契约写明 start 非 0 → 原样返回它的 JSON。apply 命令 / skill 的参数与回退路径同改。
- **B · 合回只合回**：wave 合回派发改用独立返回结构 `{ok, merged, failed, warnings}`，prompt 明令不要运行第 3 项（final）；`integ.ok` 只表示合回与 record 是否成功；`integrator.md` 第 3 项改为「仅当 prompt 点名时运行」。
- **D · 记账 commit 不使 final 过期**：`ship` 判 final 新鲜度时，final 行 commit 不等于 HEAD，但它是 HEAD 的祖先、且其后改动全部落在 change 目录的 5 个记账文件（`timeline.md` · `gate-report.md` · `evidence.log` · `review-findings.json` · `tasks.md`）→ 仍判有效；其余任何改动照旧判「final 过期」。
- **F · 拉不到 ≠ 无变更**：`pr-ship.md` step 8 与 `code-reviewer.md` 评审流程分三种情况：为空 → 无变更；`gh pr diff` 失败 → `git fetch origin <target>` 后 `git diff origin/<target>...HEAD`；都拉不到 → 报告「取 diff 失败」并停止，不得报告无变更。
- **H · `.flight` 不入库**：模板 `openspec/.gitignore` 加 `changes/*/.flight`；`install.sh` 安装 / 升级时对目标的 `openspec/.gitignore` 幂等补这一行。
- **I · 回退 effort 文案**：apply 命令 / skill 的回退段去掉 Agent 派发里的 `effort: high / low`，写明 effort 由 agent frontmatter 决定。

**不改**：C（改计划后续跑重放旧结果）、E（owns 外旧测试断言 owns 内文件）、J（CLAUDE.md 注入段超预算）另立 change；G（临时 worktree 清理清单）不做；`takeoff-gate.py`（L：只凭 `args.changeDir` 识别起飞，观察项，无实害）；gate G1–G8 语义；重试接续（cherry-pick + `--base`）语义；`final` 本身的判据。

## Capabilities

### New Capabilities

- `slice-base-check`: 切片基点校验——`start --expect-branch` 的祖先判定与 G0 输出、工作流每个执行体把分支名交给 start、执行体与 apply 文档的对应契约。
- `integrator-merge-contract`: wave 合回派发的返回结构与「合回不跑 final」。
- `ship-final-freshness`: `ship` 判 final 新鲜度时对记账 commit 的豁免及其边界。
- `review-diff-fallback`: 评审取 diff 失败时的回退，以及「取 diff 失败 ≠ 无变更」。
- `flight-record-ignore`: `.flight` 被模板 `.gitignore` 忽略，升级时幂等补规则。
- `flight-doc-contracts`: 回退派发的 effort 由 agent frontmatter 决定（与 flight-preflight-and-retry 的同名 capability 各自新增 requirement）。

### Modified Capabilities

无（仓库尚无 `openspec/specs/`）。flight-preflight-and-retry（未归档）的 `slice-retry-resume` 里「首轮派发仍以 `expectHead` 校验基分支」一句被本 change 的 `slice-base-check` 取代，处理方式见 design 的 Open Questions。

## Impact

- **代码**：`template/.claude/hooks/slice-gate.py`（start 祖先校验 + ship 记账豁免，约 40 行）· `template/.claude/workflows/opsx-apply.js`（参数 `branch`、start 命令、MERGE 结构与合回 prompt，约 25 行）· `install.sh`（约 10 行）· `template/openspec/.gitignore`（2 行）。
- **契约**：`start` 新增可选 `--expect-branch`，G0 拒绝时 exit 1，stdout 是 GATE 形状 JSON（`commit` 为空串）；工作流参数 `expectHead` → `branch`（唯一调用方是 apply 命令 / skill，同 PR 同改）；合回派发返回 `{ok, merged, failed, warnings}`；「final 过期」只在 final 之后改了记账文件以外的内容时出现。
- **文档**：`opsx-apply.md` · `openspec-apply-change/SKILL.md` · `pr-ship.md` · agents `slice-executor.md` / `integrator.md` / `code-reviewer.md`。
- **测试**：`tests/test_slice_gate.py` +3 · `tests/test_ship_verdict.py` +3（其中 2 条是既有行为守卫，不标 xfail）· `tests/test_agents_workflow.py` +4（含用 node 驱动脚本的 mock 工作流测试）· `tests/test_template_docs.py` +4 · 新文件 `tests/test_install.py` +2。既有 `test_workflow_retry_resumes_previous_commit` 断言「首轮仍含 expectHead」，与本契约冲突，由 S2 按切片包说明改掉。
- **下游**：stc-foundation 等已安装仓库跑 `install.sh --upgrade` 即可得到（`.claude/` 刷新 + `openspec/.gitignore` 补行）。
- **依赖**：无新增；mock 工作流测试需要 node（缺则 skip，与既有 `node --check` 测试口径一致）。
