## Why

afa `dlib-recorder-param-patch` 的一次飞行（2026-10-10，10:22–15:26）里，全量测试单进程一次要 32–37 分钟，共跑了 5 遍（pr-ship 修复轮还有第 6 遍），合计约 171 分钟，占总时长 56%。这里面有 3 遍是门禁编排白跑的。另外，审批页要等基线跑完才生成，你又审了 39 分钟，这两段本可以重叠。证据来自会话转录、`wf_c9029f3d-352.json` 与 `timeline.md`：

| 白跑 | 实测 | 原因 |
|---|---|---|
| 两次 final 必红 | 35 + 33 分钟 | S2/S3 没实现，G7 必红；但 `cmd_final` 先跑 33 分钟全量（G2），最后才跑秒级的 G7；修复体收口跑一遍，final-gate 在同一 commit 上又跑一遍 |
| 修复后再跑一遍 final | 每次约 33 分钟 | 新引擎里，修复体收口门禁本身就是全量 final（`landing.tsx` 的 `onLandingStop`），合回后 `closing()` 又跑一遍 final；两次之间只多了记账提交 |
| 起飞前两遍全量 | 32 + 34 分钟 | 门禁不扣除预存红，afa 每个 change 都要先跑一遍全量收集 206 个预存红、手写 deselect 脚本，再跑 baseline |
| 审批被基线挡住 | 39 分钟 | `/opsx-propose` 先 baseline、后渲染 `spec.html` |

另外，新引擎在有切片 blocked 时仍会派修复体。修复体的收口门禁是 final，会被别的切片的 xfail scenario 卡住（G7 红），等于逼它去实现不属于它的切片。

## What Changes

- **final 先跑 G7**：`slice-gate.py final` 先跑 scenario 状态（G7，只跑 scenario 测试），再跑 lint / typecheck；G7 红时不跑全量测试，返回红，并带警告「G2 全量未跑」。新旧两个引擎、修复体收口门禁都走这一处。
- **测试门禁按基线差分**：`baseline` 与 `final` 跑 `gate.test` 时，通过 `PYTEST_ADDOPTS` 注入 `--junitxml`，记下逐条失败。baseline 允许预存红（记录在案），final 只对新增失败判红。与 lint / typecheck 已有的基线差分同一思路。度量不可信时（不是 pytest、退出码不是 1、汇总行不是恰好一行、计数对不上）退回按退出码判。
- **final 复用修复门禁**：`slice-gate.py final --reuse-fix` 读账本里最后一条修复门禁（slice `fix` 的 gate 事件）。它绿、且它的 commit 到 HEAD 之间只有记账文件改动（ship 已有的 `_final_fresh` 判据），就不再跑全量；G7 与 lint / typecheck 照跑。新引擎的 final 动作带这个参数，修复体收口门禁不带。
- **有计划切片 blocked → 评审收齐后直接停飞**：新引擎 `closing()` 不派修复体、不跑 final，停飞原因列出 blocked 切片；续飞沿用现有机制，只重派 blocked 切片。评审未返回（`review:<S>`）与修复体 blocked 不在此列，照旧进 final。
- **审批与 baseline 并行**：`/opsx-propose`（命令与 skill 同改）lint 通过后先渲染 `spec.html` 交接，baseline 放后台，跑完报告一行。baseline 运行期间 `gate-baseline.json` 记 `running` 与 pid；preflight 见到就拒绝起飞，并区分「仍在跑」与「已中断」。`slice-gate.py lint` 要求 `gate.test` 显式写出，免得 baseline 自动探测时改写 `slices.json`、让计划指纹失效。
- 插件版本在合入时 main 的版本上升一个补丁号（main 当前 0.3.2；若 `flight-measure` 先合入为 0.4.0，则为 0.4.1）。

**行为放宽（非 BREAKING）**：基线有可度量的预存红时，baseline 判 ok、可以起飞（现在判红）。这与 afa 手写 deselect 的效果相同，只是改由机械判定；预存红数量写进 baseline 与 final 的警告。

## Capabilities

### New Capabilities
- `final-gate-fastpath`：final 先 G7、G7 红不跑全量；`--reuse-fix` 复用新鲜的修复门禁结论；新引擎 final 动作请求复用，修复体收口门禁不复用。
- `test-gate-baseline-diff`：`gate.test` 的 pytest 失败按基线逐条差分，度量不可信时退回退出码。
- `flight-blocked-halt`：有计划切片 blocked 时，评审收齐后停飞，不派修复、不跑 final；续飞只重派 blocked 切片。
- `propose-parallel-baseline`：`gate.test` 必填；baseline 运行标记与 preflight 识别；propose 先交审批页、baseline 后台跑。

### Modified Capabilities
（无：`openspec/specs/` 下还没有已归档的 spec。）

## Impact

- `template/.claude/hooks/slice-gate.py`（final、baseline、lint、preflight）。
- `template/plugins/flight/hooks/core.ts`（`closing()`）、`template/plugins/flight/hooks/landing.tsx`（final 动作）、插件补丁版本 +1。
- `template/.claude/commands/opsx-propose.md` 与 `template/.claude/skills/openspec-propose/SKILL.md`（同改）、`template/openspec/schemas/intent-driven/schema.yaml` 的 tasks 说明。
- 测试：新增 `tests/test_slice_gate_final.py`、`tests/test_slice_gate_reuse.py`；扩展 `tests/test_flight_core.py`、`tests/test_flight_landing.py`、`tests/test_template_docs.py` 及对应 TS 测试。`tests/test_template_docs.py::test_propose_baseline_red_stops` 按新步骤顺序改写。
- **不碰**：#42 刚改过的 `envelope.ts`、`io.ts`、`orchestrator.tsx`、`register.tsx`、agent 定义与 `opsx-apply` 命令；旧 Workflow 引擎（`opsx-apply.js`）只经 `slice-gate.py` 吃到「final 先 G7」与「测试差分」。
- 收益集中在 afa 这类测试慢、有预存红的仓库；本仓库全量只要约 85 秒。
