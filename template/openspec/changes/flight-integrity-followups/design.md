## Context

PR #36（main `a1c64a0`）评审留下的问题，事实如下：

| 问题 | 代码位置 | 现状 |
|---|---|---|
| G7 运行方式 | `template/.claude/hooks/slice-gate.py` `_pytest_outcomes`（约 560–575 行） | 写死 `[sys.executable, "-m", "pytest", "-p", "flight_g7_outcomes", …]`；无 timeout；`capture_output=True` 后输出丢弃；无结果时只报「未被收集运行」 |
| 工作流抛错 | `template/.claude/workflows/opsx-apply.js` 173（integrator）/ 184（评审员）/ 223（final-gate） | 三处 `agent()` 裸调用；评审用 `Promise.all(reviews)` 汇总，任一抛错整体 reject。执行体（`run`）与 fix（`runFix`）已在 #36 兜住 |
| 找回门禁结论 | `slice-gate.py` `cmd_start`（约 846 行） | 只核对 ok、slice、HEAD ∈ {base, commit} |

本 change 提案阶段实测：改计划后重飞，重派 worktree 的 HEAD 是新的分支尖端，不等于旧 base，结论不会被找回（守卫测试 `test_resume_start_refuses_record_after_replan` 在现有代码上通过）。所以评审员的第三条不改实现，只钉住性质。

现行 ADR 与上一 change 相同，本设计不触及它们的承诺。图示沿用 plain Mermaid、轻量 C4 风格。

## Goals / Non-Goals

**Goals:**
- G7 在项目自己的测试环境里跑出结果；卡住能停、判红能看出原因。
- 工作流不因任何单个 agent 抛错而整体崩溃；机械角色重做一次，评审缺失留下记录。

**Non-Goals:**
- 不改找回门禁结论的实现（见 Context）。
- 不处理 #36 评审的另外 3 条 MEDIUM 与各轮 LOW。
- 不动执行体、fix 的兜底（#36 已做）。

## Decisions

### D1 G7 的 pytest 运行方式

```mermaid
flowchart TD
  A["gate.pytest 非空？"] -->|是| P["shlex 拆分后原样作前缀"]
  A -->|否| B["shlex 拆分 gate.test，<br/>找第一个 pytest / py.test 可执行文件或 -m pytest"]
  B -->|找到，且前缀里没有 && || ; | cd VAR=值| Q["取到 pytest 为止的前缀"]
  B -->|找不到 / 有 shell 语法| R["退回 sys.executable -m pytest<br/>warnings += G7 … 可在 gate.pytest 指定"]
  P --> RUN["前缀 + -p flight_g7_outcomes -p no:cacheprovider --rootdir ROOT + nodeids<br/>env: PYTHONPATH = 插件目录 + 原 PYTHONPATH；timeout"]
  Q --> RUN
  R --> RUN
```

| 候选 | 判断 |
|---|---|
| **显式 > 推导 > 退回**（选） | 下游不配也大概率正确（`gate.test` 本来就是项目在自己环境里跑测试的命令）；推导不出时不静默，warnings 点名配置项 |
| 只认显式配置 | ✗ 下游升级后不配就全红，把问题留给下游自己发现 |
| 整条 `gate.test` 交给 shell 再追加参数 | ✗ `gate.test` 自带的路径参数会与 nodeid 叠加，把整个套件也跑一遍；`npm test` 这类非 pytest 命令直接失败 |

- `scenario_status` 的返回值从三元组扩为 `(violations, total, passed, warnings)`，`cmd_gate` 与 `cmd_final` 把 warnings 并入输出。
- **超时**：`FLIGHT_G7_TIMEOUT` 优先；否则 `max(120, 3 × gate.full_suite_sec)`；没有耗时记录时 600 秒。超时对每个 `.py` 目标记「运行超时（N 秒）」。
- **诊断**：某目标没有任何结果时，文案附 `rc=<N>` 与输出中第一条含 `Error` 的行（没有则末行），截断到 200 字符。

### D2 工作流里的 agent 失败

| 调用点 | 抛错或无结果 | 重派后仍失败 | 理由 |
|---|---|---|---|
| integrator（`integrate:w<i>`） | 重派一次（`integrate:w<i>:retry`） | blocked `wave<i>`、infra、原因含「未返回（已重派一次）」，后续 wave 照常 | 机械活可安全重做：已合回的 commit 再 merge 为空操作，`record` 自带防重复 |
| 评审员（`review:<S>`） | 不重派 | blocked `review:<S>`、infra、「评审未返回」；其余 findings 照常汇总 | 多花一次 opus 换一份切片级评审不划算；铁律 4 由 `/pr-ship` 的整 PR 评审兜住 |
| final-gate | 重派一次（`final-gate:retry`） | blocked `final`、infra；返回的 final 为空，`ship` 因缺 final 行判 draft | 同 integrator |

- 合回返回 `ok: false`（冲突）不重派：冲突是确定性的，重派也一样冲突，沿用现有 blocked 逻辑。
- 实现形如 `agent(...).catch(() => null)`。评审改为在 push 进 `reviews` 前就挂上 catch，所以 `Promise.all` 不再 reject。

### D3 守卫测试

`test_resume_start_refuses_record_after_replan`：改计划提交 → 批准提交 → 从新尖端开 worktree → 重派 start。断言不找回、不交出旧 commit。它是既有行为守卫，不标 xfail。

## Risks / Trade-offs

- **[推导出的前缀依赖 `gate.test` 的写法]** → 推导不出时退回并在 warnings 里点名 `gate.pytest`，不静默；schema 的 tasks 指令补一行说明这个配置。
- **[uv / poetry 等启动器未必透传 `PYTHONPATH`]** → 它们默认继承环境变量。若某启动器不透传，插件加载不到，结果为空，诊断文案会带出原因，用户改用 `gate.pytest` 指定。本仓库无此类启动器，未实测。
- **[评审缺失不阻断]** → PR 正文的 blocked 段会列出「评审未返回」，人审 PR 时看得见；`/pr-ship` 的整 PR 评审照常执行。

## Migration Plan

1. **起飞前**：主仓库检出必须已 `git pull --ff-only` 到 `a1c64a0` 或更新。本 change 用 main 检出的工作流与 hooks 飞行，要用的是 #36 的机制：执行体一律隔离、抛错重派、门禁结论找回。
2. **本 change 的执行体在隔离 worktree 里改 slice-gate.py 与 opsx-apply.js**：门禁用主仓库检出的稳定版，新代码只经测试验证。
3. **回退**：revert 本 PR 即可，没有数据迁移。

## Open Questions

- 无。
