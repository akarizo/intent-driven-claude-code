# DRAFT. 基线按内容指纹复用全量结果

- Status: accepted
- Date: 2026-10-14
- 关联：DRAFT-test-gate-baseline-diff · DRAFT-gate-evidence-not-self-reported
- 来源 change：baseline-incremental-reuse（design D1–D5、D8）

## Context

起飞前的基线（`slice-gate.py baseline`）每次都跑全量。afa 全量约 7.5 分钟，一遍基线约 10 分钟。改计划之后要不要重跑，全靠模型判断：

- 2026-10-14 `b737-post-hooks-merge-split-params` 只加了一个 strict-xfail 用例，模型就打算整遍重跑；
- 而当时 preflight 判的是「未过期」：`plan_sha` 只认命令字符串，看不出测试文件与门禁脚本的内容变化。

全量预存红集只取决于代码树与全量命令。同一仓库的各 worktree 共享 git 对象库，不同 change 对同一棵代码树跑全量，结论相同。

## Decision

- **代码树按内容判同**：基线记录 `snapshot`（未提交改动的 git blob id）与 `cmd_key`（命令文本把本 change 路径归一成占位符，加上命令里直接写出的仓库内文件内容）。比较两棵代码树时，逐路径比 blob id，不比 commit。
- **只有测试文件变了才复用**：差异只有 `test_*.py`、不涉及候选的预存红、补跑差异文件不红 → 复用候选的全量结果。其余一律跑全量；`--full` 强制全量。
- **池**：全量结果写进 git common dir 下的基线池，同一仓库各 worktree 共享，按 `cmd_key` 匹配，只收全量结果。
- **不计入差异**：各 change 的计划与门禁脚本目录（`<changes 根>/**`，同一 change 内的门禁脚本除外）、字节码、pytest 缓存；仓外内容（数据仓、解释器环境）不检测。
- **preflight**：首次起飞前按内容判过期，起飞之后保持原四项校验。

否决的方案：

- **按 commit 相等复用**：起飞提交工件、预合并、pull 只带进范围外的提交，都会让它失效。
- **由模型判断是否重跑**：违反「判据不自证」；而且实际出现过多跑（本案例）。
- **计入被 source 的门禁脚本**：afa 各 change 的 `_env.sh` 各不相同，跨 change 永远不命中。
- **池放 refs**：refs 是账本的可信面，不放缓存。

## Consequences

- **更易**：改计划后重跑基线只要秒级到分钟级（lint / typecheck 与受影响的 verify）；同一 main commit 上的多个 change 只跑一次全量；preflight 能看出测试内容变了。
- **更难**：判定器的可信计算基多了 Δ 计算与池；按文件名主干匹配预存红是保守近似，有测试覆盖。
- **盲区**：仓外漂移与被 source 的门禁脚本不在指纹里，需要人用 `--full` 兜底；final 收口仍跑全量，最坏是收口时多出一条红，不会把红判成绿。
- **兼容**：旧格式基线不作候选，下一次 baseline 跑全量后升级为新格式；新字段对旧代码透明。
