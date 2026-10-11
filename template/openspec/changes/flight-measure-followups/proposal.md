## Why

flight-measure（#46）的四次 attempt 暴露了控制面在**续飞**上的三个缺陷。#45 已修掉第四个（切片阻断仍派修复体）。

1. **续飞复用了过期的切片现场**：attempt 1 后计划修订并重新批准，attempt 2/3 的 S7 执行体仍被派进旧 worktree。
   - 那里的切片包和 `slices.json` 都是旧版本，门禁也按旧的 owns 判。
   - 结果和 attempt 1 一模一样地红了三次。最后由用户手动跑清理脚本才过去。
2. **修复体复用了旧尖端的 worktree**：修复体的 worktree 是从 attempt 1 的分支尖端切出的，里面没有之后合回的切片，全量 final 必然红。
3. **两个会话可以同时起飞同一个 change**：attempt 2 来自另一个会话，attempt 3 来自本会话，相隔 1 分钟。起飞前「上一次的 agent 是否还在跑」只查本会话的 agent，所以两个 S7 执行体并发改了同一棵 worktree。

#46 评审还留下几处包络缺口：
- `/usr/bin/env`、`"exec"` 这类带路径或引号的前缀不会被剥掉，后面的拒绝表与 worktree 限制都绕得过去；
- `cd "$(…)"`、`cd ".$X"` 这类目录参数里带 shell 展开时，会被当成 worktree 内的相对路径；
- 「无法判定」的拒绝理由仍写「相对路径且无绝对基准」，和目录栈旋转等实际原因对不上。

另外两处小问题：
- **测量工具的误导理由**：在飞账本读不出时，测量工具回复「只有本次飞行的执行体可以请求测量」，执行体可能因此放弃测量。
- **`/pr-ship` 第 4 步的冲突统计恒为 0**：它用 `grep -c "^<<<<<<<"` 统计旧版 `merge-tree` 的输出，而那里的冲突标记前面带 `+`。#46 实际有 2 个文件冲突，它报的是 0。

## What Changes

- **新派发另起 worktree**（用户定）：新派发的执行体、修复体、解冲突 agent，如果同名 worktree 已存在，就从当前分支尖端另建 `<名>-a<attempt>`。
  - 旧 worktree 原样保留，不删、不重置（铁律 6）。
  - dispatch 事件记下分支；合回、解冲突、修复合回都按记下的分支来合。
  - 执行体提示词写明上一次的分支可以用 `git show` 参考。
- **续接只限同一份计划**：上一次 attempt 的计划指纹与本次不同时，不再续接旧现场、也不补跑门禁，一律按新派发处理。
- **跨会话起飞默认拒飞**（用户定）：最新一次起飞来自另一个会话、并且还没落地或停飞时，拒绝起飞，提示到原会话继续，或用 `--takeover` 接管。接管会记进 takeoff 事件。
- **包络余项**：
  - 前缀命令按 basename 去引号后再查表；
  - 目录参数（`cd` / `pushd` / `-C` / `--git-dir` / `--work-tree` / `env -C`）中任意位置出现 `$`、反引号或不配对的引号，一律判为无法判定；
  - 「无法判定」的拒绝理由改成中性措辞。
- **测量工具**：调用者的归属判不出时，回复「暂时无法判定归属，稍后重试」。
- **`/pr-ship` 第 4 步**改用 `git merge-tree --write-tree --name-only` 的退出码判断冲突。
- `/opsx-apply` 命令与同名 skill 写明 `--takeover` 和新派发另起 worktree 的语义。插件版本升到 0.4.1。

无 BREAKING。跨会话拒飞是刻意加严，`--takeover` 是人的显式出口。

## Capabilities

### New Capabilities
- `flight-fresh-worktrees`：新派发另起 worktree、续接只限同一份计划、按记下的分支合回、提示词给出上一次的分支。
- `flight-takeover`：跨会话起飞拒飞，以及 `--takeover` 接管。
- `flight-envelope-remainders`：前缀路径与引号、目录参数的 shell 展开、中性的拒绝理由。
- `flight-measure-polish`：测量工具在归属判不出时的提示。
- `pr-ship-premerge`：预合并用 `merge-tree --write-tree` 判断冲突。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **插件**：`template/plugins/flight/hooks/` 下的 `core.ts`、`io.ts`、`land.ts`、`envelope.ts`、`prompts.ts`、`orchestrator.tsx`、`landing.tsx`，以及对应的 TS 测试与 pytest 包装；插件版本 0.4.1。
- **文档**：`template/.claude/commands/pr-ship.md`、`opsx-apply.md`、`template/.claude/skills/openspec-apply-change/SKILL.md`。
- **本 change 是测量协议的首飞**（在已安装的 0.4.0 上飞）：执行体须先让测试红并调用 `measure`，G5 按账本判定，不满足即判红。首飞中如果发现测量协议本身的问题，如实记录，不绕过。
