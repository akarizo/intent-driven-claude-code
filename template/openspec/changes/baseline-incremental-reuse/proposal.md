## Why

2026-10-14 afa `b737-post-hooks-merge-split-params`：propose 阶段的基线跑了约 10 分钟（全量 447 秒，lint / typecheck / 3 片 verify 约 154 秒）。随后用户只让改一处（「BCD 的斜率取最小的 resolv」），模型加了 1 个 strict-xfail 用例、1 个 scenario，并登记到 S1，然后打算再跑一遍基线。

| 时间（UTC） | 事件 |
|---|---|
| 14:14:32 | baseline 后台起跑 |
| 14:21:59 | 全量结束（447 秒，预存红 168 条） |
| 14:23:07 | 用户：「BCD的斜率取最小的resolv」 |
| 14:24:33 | 基线通知：绿 |
| 14:36:05 | 往已有测试文件末尾追加 1 个 strict-xfail 用例；spec、slices.json、S1 切片包同步 |
| 14:38:06 | 模型：「…再更新 S1 切片包里的数字、渲染 spec.html、重跑基线」 |

第一性原理：全量预存红集只取决于**代码树与全量命令**，与计划工件无关。往测试文件里加 strict-xfail 用例，也不会改变其他文件的测试结果。可是要不要重跑、跑多少，目前全靠模型判断：

- 当时直接跑 `slice-gate.py preflight` 是**通过的**：`plan_sha` 只认 gate 命令与 verify 命令的字符串，这次一个都没变。这遍重跑没有任何机械判据要求。
- 反过来，`plan_sha` 也看不出测试文件、门禁脚本的**内容**变化：新测试本身坏了，preflight 也照样放行。

用户决策（2026-10-14）：基线按依赖分层、由脚本判定重跑范围；同一 change 和跨 change 都复用。仓外内容（不归本仓 git 管的数据仓、解释器环境）不纳入判断；仓内任何非测试改动一律回全量。

## What Changes

- **基线记录内容指纹**：`gate-baseline.json` 新增：
  - `snapshot`：基线结束时工作区相对 HEAD 的未提交改动，路径映射到 git blob id；
  - `cmd_key`：全量命令指纹，取本 change 路径换成占位符后的命令文本，加上命令里直接引用的文件内容；
  - 每片 verify 的命令文本；
  - `mode`：`full` 或 `incremental`。
- **运行期间改动**：基线运行期间，已跟踪文件或测试文件被改 → 基线判红，要求重跑；新出现的、非测试的未跟踪文件视为运行副产物，只给警告。
- **增量基线**：`slice-gate.py baseline` 先找可复用的全量结果。差异 Δ 的定义：
  - 按内容比较 → 候选全量结果所测的代码树 与 当前代码树；
  - 不计 → 字节码、`.pytest_cache`，以及 `<changes 根>/**`（各 change 的计划与门禁脚本）；
  - 例外 → 同一 change 时，本 change 目录里计划工件以外的文件（门禁脚本）照计。

  候选满足以下全部条件才复用，否则跑全量：
  - `cmd_key` 相同；
  - Δ 只有 `test_*.py`；
  - 候选的预存红里没有 Δ 中测试文件的用例；
  - Δ 里现存的测试文件用 `gate.pytest` 补跑一次，没有失败、没有错误。

  复用时预存红集沿用候选的；lint / typecheck 每次照跑。
- **verify 按需重跑**：只重跑命令变了的片，或命令里的路径覆盖到 Δ 文件的片，或命令里认不出路径的片；其余沿用上一次基线的结论。跨 change 复用时本 change 没有上一次，全部重跑。
- **跨 change 复用（池）**：每次全量基线绿且结果可度量时，把结果写进 git common dir 下的基线池，同一仓库的各 worktree 共享。挑选候选的顺序：先本 change 的上一次基线，再池里最新的条目。
- **`--full`**：强制跑全量。
- **全量耗时**：增量不改已有的 `full_suite_sec`；本 change 还没有这个值时，写入候选的全量耗时。
- **preflight 按内容判过期**：本 change 尚未起飞（账本没有 takeoff）、且基线带 `snapshot` 时，Δ 非空就判「基线过期」。旧格式基线、已经起飞过的（续飞时切片代码本来就改了工作区），保持原有四项校验。
- **记录与文档**：timeline 的 baseline 行标出「增量」与复用来源。propose 命令与同名 skill 写明：改完计划后重跑 baseline，全量还是增量由脚本判定；一行报告带上模式。README 同步。

## Capabilities

### New Capabilities
- `baseline-incremental-reuse`：基线的内容指纹、增量复用（同一 change 与跨 change）、verify 按需重跑、preflight 按内容判过期、`--full`、记录与文档。

### Modified Capabilities
<!-- 无：openspec/specs/ 下没有基线的既有 capability；本变更以新增 capability 描述基线复用行为 -->

## Impact

- `template/.claude/hooks/slice-gate.py`：`cmd_baseline`、`cmd_preflight`，新增指纹、Δ 与池相关函数。
- `template/.claude/hooks/timeline.py`：baseline 行。
- `template/.claude/commands/opsx-propose.md`、`template/.claude/skills/openspec-propose/SKILL.md`、`README.md`。
- 插件 TS 不改：「批准修订并续飞」本来就调用 baseline，自动受益（commit 之间只有测试文件改动时）。插件版本不动。
- 新增 `tests/test_baseline_incremental.py`、`tests/test_baseline_pool.py`、`tests/test_baseline_incremental_docs.py`。
- 已知边界：
  - 仓外漂移（raw-dlib 软链目标、pixi 环境）看不出来，用 `--full` 兜底；
  - 被 source 的脚本（如 afa 的 `_env.sh`）不计入 `cmd_key`；
  - afa 历次基线的 commit 之间都有 executor/ 源码改动，跨 change 主要在同一 main commit、或之间只改了测试文件时命中。
