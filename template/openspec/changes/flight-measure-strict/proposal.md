## Why

#47 是测量协议的首飞，暴露出 G5 按整片判先红的漏洞：

- **S5 的 6 个目标里，5 个在改生产代码之前测到红**。剩下的 `halted-attempt-from-other-session-resumes` 描述的行为在 base 上本来就成立，不可能先红。
- **重派的执行体临时删掉一处实现、测到红、再恢复**，也就是「先实现、后造红」。测量工具当场回复「这次红不能作为先红证据」，门禁却放行了。原因是：
  - G5 只要求必修目标里**至少有一个**在源码未改时红过；
  - 「从未红过」这条又不区分这次红是在改源码之前还是之后。
- **工具提示与门禁判据不一致**，铁律 3「生产代码前必有先失败的测试」在逐个目标的粒度上没有被门禁执行。
- **起点豁免是隐式的**：现在起点测量里已经 PASSED 的目标，会被自动豁免先红。可是规划者把护栏 scenario 写成什么样、哪些目标该被豁免，没有经过人确认。

#47 的评审与复核还确认了两处缺陷：

- **包络认不出带引号或反斜杠的命令名**。程序名和 git 子命令都没有做 shell 去引号，下面这些命令能直接绕过拒绝表与 worktree 限制：
  - `\git -C /repo commit`、`git "push"`、`g''it push`；
  - `\cd /repo && git commit`、`\bash -c 'git push'`。
- **续接时用的门禁结论不限定来源 agent**：只要门禁在上一个执行体派发之后，哪怕是别的 agent（解冲突 agent、被接管会话的残留执行体）收口时记下的，也会被拿来在当前 worktree 上补跑。

## What Changes

- **G5 逐目标先红**（用户定）：每个必须先红的目标，都要在一次生产代码未改动（`source` 为空）的控制面测量里红过。改源码之后测到的红一律不算。删掉原来的整片判定。
- **护栏 scenario 显式标注、由人批准**（用户定）：
  - `slices.json` 的切片增加 `guards`（scenario id 列表，须是该切片 `scenarios` 的子集）。它计入计划指纹，审批页上会标出来。
  - 护栏的测试在规划时就要写完整、不带 xfail，base 上已通过。
  - G5 的判定：
    - 护栏目标须在起点测量里已通过；
    - 非护栏目标如果在源码未改时就已通过，判红，并提示「应标为护栏」；
    - 原来「起点已通过即自动豁免」的隐式规则删除。
  - `slice-gate lint` 检查两件事：`guards` 是否在本片 scenario 内；护栏测试是否还带 xfail。
  - `slice-gate measure` 的输出列出本片的护栏目标。
- **执行体提示词与测量回复**：
  - 非护栏目标在改生产代码前就已通过时，测量回复要提示这多半是计划错误；
  - 执行体提示词写明：不得改坏生产代码来造红，应照实收口说明。
- **规划文档**：
  - schema 的 tasks 说明、`/opsx-propose` 与同名 skill、`/opsx-continue` 与同名 skill，都写明护栏的写法；
  - 执行体定义、DRAFT ADR（测量协议）同步改写豁免规则。
- **包络 shell 去引号**：
  - 程序名、git 全局选项与子命令、`cd` / `pushd` / `popd` / `export` 的识别，一律先做 shell 去引号（反斜杠、单引号、双引号）再判断，选项匹配也一样；
  - 命令名、git 子命令或全局选项里带 `$` 展开的，判为无法判定，予以拒绝；
  - 反引号命令替换出现在命令名位置的，同样判为无法判定。
- **续接只认同一 agent 的门禁**：续接判断取的门禁结论，限定为上一个执行体自己的门禁或补跑门禁。
- 插件版本升到 0.4.2。

无 BREAKING。G5 与包络都是刻意加严；护栏须显式标注，是给人的审批点。

## Capabilities

### New Capabilities
- `flight-g5-per-target`：G5 逐目标先红，以及护栏目标的判定。
- `flight-guard-scenarios`：`guards` 字段的 lint、测量输出、测量回复、执行体提示词、审批页标注、规划文档。
- `flight-envelope-shell-words`：命令名与 git 词的 shell 去引号，以及展开的判定。
- `flight-continuation-agent`：续接只认同一 agent 的门禁结论。

### Modified Capabilities
（无。`openspec/specs/` 下没有已归档的规格。）

## Impact

- **判定器**：`template/.claude/hooks/slice-gate.py`、`spec_html.py`，以及 `tests/test_slice_gate.py`、`tests/test_spec_html.py`。
- **插件**：`template/plugins/flight/hooks/` 下的 `envelope.ts`、`core.ts`、`prompts.ts`、`measure.ts` 与对应的 TS 测试和 pytest 包装，`agents/executor.md`；插件版本 0.4.2。
- **文档**：`template/openspec/schemas/intent-driven/schema.yaml`、`template/.claude/commands/opsx-propose.md`、`opsx-continue.md`、对应的两个 skill、`template/openspec/adr/DRAFT-flight-measure-protocol.md`。
- **本 change 自身的飞行**：
  - 用主检出的旧判定器（整片 G5）判，所以本计划不使用 `guards`，每个 scenario 都在 base 上红。
  - 新判据从下一次飞行起生效，前提是合入后主检出快进。
