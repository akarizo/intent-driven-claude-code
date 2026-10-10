## Why

#41 让能力包络（插件 0.3.0）生效了，但它带着已知的缺口。另外这次又实测出一个比这些缺口更根本的问题。

**根因实测：插件派发的 agent 不在自己的 worktree 里运行。** `$.agent.spawn({ cwd })` 给的目录没有作用到子 agent 的 shell 上：
- **证据**：#40、#41 的 21 个 flight agent，转录里记录的 cwd 都是主会话**当前**的工作目录，并且会随主会话 cd 而变。#41 的 S2 执行体自己跑 `pwd`，打印的就是 `.worktrees/flight-envelope`。
- **后果**：
  - 5 个执行体挤在同一棵 change worktree 里并行改文件，裸 `git commit` 落到 change 分支，合回全部成了空合并，切片评审拿不到 diff。
  - 主会话如果停在主检出里，裸 commit 会进本地 main。
- **结论**：阶段 0 实测 S1 记录的「cwd 为 worktree」不成立。

**#41 评审留下的问题**：
1. **安全**：Bash 免询问白名单不检查 git 的作用目标（`git -C <别处> commit`、`--git-dir=`、前导 `GIT_DIR=` / `GIT_EXTERNAL_DIFF=`）。
2. **安全**：飞行 agent 的 Read / Grep / Glob 不分路径一律免询问，`~/.ssh` 也包括在内。
3. **安全**：拒绝表有缺口：缺 `git pull`、`git config` 的写入、`-c core.hooksPath=…`（与 `--no-verify` 等效）；长选项缩写 `--am`、`--d` 没被拦。
4. 修复体加的合回前检查（直接提交、空合回、已合回判定）和提示词里的 worktree 说明，没有 scenario（铁律 1、2）。
5. `ownerOf` 不缓存未命中：飞行期间，非飞行 subagent 的每次工具调用都要扫一遍账本。agent 先 spawn、后写 dispatch，这段窗口里包络对它是放行的（fail-open）。
6. `merge-tree --write-tree` 需要 git ≥ 2.38，但没有校验。批准带连按会记两条 approve。测试替身里还留着失效的 `--is-ancestor` 预设。

**同一份计划的第一次飞行已作废**：它以 change 名 `flight-envelope-followups` 起飞，但会话当时还没重载插件，实际跑在 0.2.1 上。结果：
- 执行体又直接提交进了 change 分支，S3、S5、S6 都是空合回；
- S1 合回冲突后被阻断；
- 修复体越权在 change 分支上实现了 S4。

那条分支和它的账本原样保留作为证据。本 change 是同一份计划换了名字，在 0.3.0 上重飞。

**飞行中实测到的另一个问题**：#41 的第一个 S6 执行体执行了 `python3 -`（读标准输入），挂起了 1 小时 24 分钟，那次派发因此作废。执行体还用 heredoc 写文件，这绕过了写入包络。

## What Changes

- **飞行 agent 的 Bash 一律在自己的 worktree 里跑**：插件在 `tool.call` 把飞行 agent 的 Bash 改写为 `cd '<自己的 worktree>' && <原命令>`；白名单判定认可这一段前缀。
- **改动类 git 只能作用于自己的 worktree**：`-C`、`--git-dir`、`--work-tree` 或段内 `cd` 指向别处时拒绝。只读子命令可以读主仓库内的任何树。
- **拒绝表补齐**：`pull`；`config` 的写入；全局 `-c core.hooksPath`、`--config-env=core.hooksPath`；更短的长选项缩写；读标准输入的解释器（`python3 -`、`bash -s`、`/dev/stdin`）；heredoc `<<`。
- **白名单收紧**：带前导 `VAR=` 的段不升级；git 指向自己 worktree 之外（只读子命令除外，它们可以指向主仓库内）不升级。
- **Read / Grep / Glob 只在主仓库内免询问**，其余交回引擎判定。
- **agent 归属**：spawn 一拿到 agentId 就记为「登记中」，这期间写入与 Bash 一律拒绝；非飞行 agent 的未命中结果缓存起来，dispatch 写入时清空。
- **合回检查补成 scenario**，映射到已有测试；清理失效的测试预设。
- **起飞检查** git ≥ 2.38；**批准带**去重。
- **agent 定义**（执行体、修复体、评审员）写明：git 一律在自己的 worktree；禁止 heredoc 与读标准输入的解释器。命令与 skill 同步修改。新 ADR 取代 `DRAFT-flight-capability-envelope`。
- 插件版本升到 0.3.1。

无 BREAKING：全部是收紧，或把错误的执行目录纠正过来。

## Capabilities

### New Capabilities
- `flight-envelope-tightening`：Bash 固定在自己的 worktree 里跑、改动类 git 的作用目标、拒绝表补齐、白名单收紧、读取免询问限于仓库内、派发登记前 fail-closed。
- `flight-merge-guards`：合回前的直接提交检查、空合回检查、已合回判定、派发提示词写明 worktree（给 #41 修复体已加的行为补规格）。
- `flight-agent-ownership`：agent 归属的「登记中」状态与未命中缓存。
- `flight-approve-dedupe`：批准带去重。
- `flight-envelope-tightening-docs`：agent 定义、命令、skill 与新 ADR。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- `template/plugins/flight/hooks/`：`envelope.ts`（纯策略）、`io.ts`（归属状态）、`orchestrator.tsx`（接线、起飞检查）、`register.tsx`（批准带），以及对应的 TS 测试和 pytest 包装。
- `template/plugins/flight/agents/*.md`、`template/.claude/commands/opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`、新 ADR。
- **这次飞行跑在已安装的 0.3.0 上**：Bash 改写还没生效，执行体仍然在主会话的目录里。所以飞行期间主会话停在已作废的 `.worktrees/flight-envelope-followups`（停车位），并且不 cd：执行体若有裸 git 写操作，只会落到那条作废分支上。
