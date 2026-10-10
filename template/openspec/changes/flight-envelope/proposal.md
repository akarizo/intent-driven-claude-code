## Why

阶段 3b 的第二个 change。做两件事：先修首飞（PR #40）暴露的续飞与落地缺陷，再落地评审页 D4 已批准、ADR `DRAFT-flight-orchestrator-state-machine` 写明「在后续 change 落地」的能力包络。

**首飞暴露的缺陷**（账本与 PR #40 评审为证）：
1. **续飞把门禁绿的切片判成红**：门禁转绿时 `.openspec-slice` 标记被删掉，续飞再派执行体时 `slice-gate start` 重新起跑，base 被取成当前 HEAD。区间因此是空的，标记文件又被 G3 当成源码（`slice-gate.py` 构造 G3 源码列表时漏排 `MARKER`，另外三处都排除了），结果连红 3 次被记成阻断。attempt 2 的 S1 就是这样；S2 的执行体补写了一个测试才过门禁。
2. **停飞后再起飞被「工作区不干净」挡住**：停飞路径不提交 `slice-gate record` 写下的飞行记录，而起飞要求工作区干净。会话中断后也会留下同样的记录。
3. **落地交接 `/pr-ship` 失败被记成停飞**：账本里出现「land 之后又 halt」。另外拼飞行记录时 `timeline report` 的调用没有兜底；它非 0 退出且 stderr 为空时，记录里只剩「（timeline report 失败：）」。
4. **drive 在终态短路之前先算计划指纹**（PR #40 评审 MEDIUM）：飞行停飞后，残留 agent 每结束一次，只要 `plan_fp.py` 失败，就会再追加一条 halt。

**能力包络**：现在飞行 agent 的权限完全跟随会话的权限模式。default 模式下执行体每次 Write 都会询问人；bypass 模式下执行体能写任何文件、能 `git push`。插件没有按 agentId 限写；`flight:*` 类型除了对模型隐藏之外没有守卫；飞行中主会话可以随手改正在飞的 change worktree。

## What Changes

- **续飞**：
  - 上一 attempt 派过执行体、最近一次门禁绿、切片 worktree 还在的切片，控制面用那次门禁的 base 自己现跑一次门禁，零 token；绿就直接合回，红才续派执行体，并让 `start` 带上原 base。
  - G3 不把 `.openspec-slice` 当成源码。
  - 起飞时，如果脏的只有本 change 的飞行记录，先提交再起飞。
- **落地**：
  - 交接 `/pr-ship` 失败时不记停飞，只打印并提示人手动运行；
  - 飞行记录的拼装有兜底，无 stderr 时显示退出码；
  - drive 先判终态，再算计划指纹。
- **能力包络**：
  - 按 agentId 限写：执行体只能写本片 owns，修复体只能写全部 owns 的并集，评审员不能写。
  - Bash 拒绝移动 ref、改历史、改共享状态的 git 子命令。
  - `tool.check` 只在包络内把引擎的 ask 升为 allow，不推翻 deny 和组织上限；Bash 只对门禁 / verify 命令等白名单免询问。
  - 飞行中主会话对在飞的 change worktree 只读。
  - `agent.spawn` 守卫：`flight:*` 只能由插件派发，且必须显式指定 model；飞行 agent 不得再派发。
- **文档**：命令与 skill 写明飞行中的权限边界；新增 ADR `DRAFT-flight-capability-envelope`。
- 插件版本升到 0.3.0。

无 BREAKING：包络只收紧飞行 agent 与飞行中的主会话，或在包络内免询问；飞行外的行为不变。

## Capabilities

### New Capabilities
- `flight-resume`：续飞时零 token 补跑门禁、保留原 base；起飞前提交遗留的飞行记录；终态之后不再算指纹。
- `slice-gate-pairing`：G3 配对检查不把切片标记当源码。
- `flight-landing-handoff`：交接 `/pr-ship` 失败不停飞；飞行记录拼装有兜底。
- `flight-envelope`：按 agentId 的写入包络、Bash 策略、`tool.check` 升级边界、主会话飞行中只读、`agent.spawn` 守卫。
- `flight-envelope-docs`：命令、skill 与 ADR 写明权限边界。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- `template/.claude/hooks/slice-gate.py`（G3 源码列表）。
- `template/plugins/flight/hooks/`：`core.ts`（续飞规划）、`orchestrator.tsx`（补跑门禁、起飞提交记录、终态短路、包络与守卫的 hook）、`landing.tsx`（交接与记录兜底）、`io.ts`（在飞集合、agent 归属缓存）、新增 `envelope.ts`（纯策略），以及对应的 TS 测试和 pytest 包装。
- `template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、新 ADR。
- **本次飞行跑在已安装的 0.2.1 上**：上面这些修复和包络都在合入并更新插件之后才生效。0.2.1 的续飞缺陷仍在，如果中途停飞，续飞会再撞到假红。
