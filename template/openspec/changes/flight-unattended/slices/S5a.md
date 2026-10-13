# S5a · 编排（一）：执行 heal、看门狗接线、停飞分类、起飞核对 integ-guard、跟上 S1 的 final 红

依赖 S1（heal / halt 动作、healVerdict、ev.heal、haltKind）、S2（features 里有 integ-guard）、S3（`StepTracker`、`WATCHDOG_MS`）。接口见 `slices/_interfaces.md` 的「S5a」。诊断员、triage、`ctx.notify` 归 S5b，本片不做。

## 先读：attempt 1 的教训与可参考的半成品
- attempt 1 的 S5（本片与 S5b 合在一起）派了两个执行体，都用满 maxTurns 40 次模型请求被截断，没提交。拆成 S5a / S5b 就是为此。
- 半成品存为提交 `c563e41`（分支 `flight/flight-unattended/S5`，基于 `b311efd`，那时 S4 尚未合回）：
  - **只读参考**：`git -C <本 worktree> show c563e41 -- template/plugins/flight/hooks/orchestrator.tsx`，或 `git -C <本 worktree> show c563e41:<路径>` 看整文件；
  - **不得 merge / cherry-pick**，用 Edit 只搬本片的部分。可参考的位置（`c563e41` 的行号）：
    - `orchestrator.tsx`：`terminal()` 的 halt 带 control（约 :475），`export async function takeoff`（约 :587），abort 的 halt 带 abort（约 :721），`$.clock.every`（约 :772），看门狗 tick（约 :825–:838），`on('turn.step', …)`（约 :1086）；
    - `orchestrator.test.tsx`：发模型请求与推进时钟的 helper（约 :1884–:1897），`final-red-heals-integ`、`heal-recorded-then-retried`、`watchdog-*`（约 :1899–:1975）；
  - **它不完整**：最后一次跑插件测试仍红 `heal-recorded-then-retried`、`watchdog-stops-stalled-agent`、`watchdog-exhausted-halts`、`final-red-heals-integ`，还让原本绿的 `dispatch-takes-base-without-start` 变红。照搬前先看懂。
- **规划时实测**（change 分支 `6ff39f5`，已含 S1–S4）：`claude plugin test template/plugins/flight` 286 个用例只红 `panel-refreshes-on-terminal`。原因是 S1 之后 final 红先派整合修复，不再直接停飞。本片负责把它修绿。

## 省轮次（attempt 1 在这些地方浪费了约 13 轮）
- 改文件一律用 Edit / Write，路径写字面绝对路径。不要用 `sed -i`、`python3 -c` 改文件，不要用 heredoc，不要把输出重定向到 worktree 以外（/tmp、scratchpad 都会被拒）。
- 命令里带 `$` 或反引号时，包络可能判为「无法判定」。查找用 `grep -n -e … <字面路径>`。
- 没有 Grep 工具，用 Bash 的 grep。`git checkout` 会被拒。不要 `find /` 找类型文件。
- `claude plugin test template/plugins/flight` 跑全量约 4 秒，直接接 `2>&1 | grep -E "^\(fail\)| pass| fail"` 过滤。

## 测试世界的已知事实（CLI 2.1.296；来源：API 类型文件与 attempt 1 的探针）
- `mock.clock(on, { now })` 返回 `{ now, advance, set, settle, sleep }`。插件里的 `$.clock.every / after / sleep` 由它应答，`await clock.advance(ms)` 按到期先后依次触发。测试一侧的 `$` 上没有 `$.clock`。
- 测试一侧发一次模型请求：`$.turn.step({ agentId, model: 'claude-opus-5-5' })`。model 必须非空，否则引擎跳过该 hook。插件之下没有实现应答 `turn.step`，测试世界要自己用 `on('turn.step', async function* …)` 应答。
- 插件的 `turn.step` hook 必须写成 `async function*`，用 `yield* next(e)`；写成普通 async 函数会被 validate 拒。

## 测量协议（G5 逐目标判）
1. **先写测试**：
   - `orchestrator.test.tsx` 写 `heal-recorded-then-retried`、`watchdog-stops-stalled-agent`、`watchdog-exhausted-halts`、`takeoff-requires-integ-guard/refused`；
   - `versions.test.ts` 写 `takeoff-requires-integ-guard`。
2. **去掉 xfail**：去掉 `tests/test_flight_orchestrator.py` 里标为 S5a 的 3 个包装、`tests/test_flight_versions.py` 末尾 1 个包装上的 xfail。
3. **先测红**：改 `orchestrator.tsx`、`versions.ts` 之前调用 `measure`，看 4 个目标都红。
4. 再实现。

## 做什么（design D1–D3 的执行侧、D2 接线、D8 的起飞核对）

### `template/plugins/flight/hooks/orchestrator.tsx`

**`perform` 处理 `heal`**：
- 追加 `ev.heal(b, {attempt, kind: a.heal, slice: a.slice, reason: a.reason, agent: a.agent})`，返回写入结果；
- 重派由下一轮 `next` 给出。合回重试是全新派发（不带 continuation），现有逻辑会另起新 worktree。用例要确认两次的路径不同。

**看门狗**：
- **模块级状态**：一个 `StepTracker`（S3），外加「已处理 agent」集合。
- **`on('turn.step', { agentId: /./ }, async function* ($, e, next) { … })`**：
  - 只在 agent 属于在飞的 change 时（`flyingWho` 或 owners 缓存）调用 `start(e.agentId, now)`；
  - 用 `try { return yield* next(e) } finally { end(e.agentId) }`；
  - 计时器未起或已结束时，在这里重新起（幂等）。
- **`session.start` 里起 `$.clock.every(60000, tick)`**。每次 tick，处理 `tracker.stale(now)` 里还没处理过的 agent：
  1. 用 `flightOfAgent` 找到所属飞行，读账本；
  2. attempt 已经 land 或 halt → TaskStop，不记 heal；
  3. `healVerdict(state, 'watchdog', key)` 允许 → 先追加 heal（agent 为它，reason 含等待的分钟数），再 TaskStop；
  4. 不允许 → 执行 `runLandingAction(ctx, f, {kind: 'halt', reason: …, haltKind: 'watchdog'})`，再停掉本 attempt 仍在跑的全部 agent（复用 `abortCommand` 里 live / stop 的写法）。

  key 的写法见 `_interfaces.md`。
- **TaskStop 的结果**：`$.tool.call` 对已结束的 agent 返回 `{ isError: true, … }`（2.1.296 实测，不抛错）。`isError` 或抛错时追加 `ev.diag(b, {attempt, where: 'watchdog', agent, error})`。
- **整个 tick 包在 try/catch 里**：异常只记 diag，不能让计时器因为抛错而停掉。

**halt 分类的执行侧**：
- `terminal()` 的 halt 带 `haltKind: 'control'`；
- `abortCommand` 的 halt 带 `haltKind: 'abort'`。

S4 的落地会在 halt 时调用 `ctx.notify?.(…)`。本片的 ctx 还没有 notify，可选调用不会抛错，由 S5b 补上。

**`takeoff` 改为 `export`**（签名不变），供 S6 的 resume 使用。

### `template/plugins/flight/hooks/versions.ts`
`REQUIRED_FEATURES` 加 `'integ-guard'`。

## 现有用例要改（本片 owns）
- **`orchestrator.test.tsx` 里 final 红的世界**（`panel-refreshes-on-terminal` 一带）：现在断言停飞，面板显示「已停飞（final 未通过：G2 lint）」。S1 之后，final 红会先 heal integ。
  - 改成让这个世界里 final 红时 integ 已经用过（或 final 的 commit 为空），再断言停飞和面板；
  - 另起一个用例 `final-red-heals-integ`：final 红且可以整合修复时，账本出现 `heal {kind: 'integ'}` 和 slice 为 `integ` 的 fixer 派发；
  - **只断言状态机层面的结果**，提示词和 dispatch 的其它字段以已合回的 S4 为准；
  - 规划时给 `tests/test_flight_orchestrator.py::test_panel_refreshes_on_terminal` 加了 strict xfail（重跑基线时它是唯一的预存红）。修绿后**去掉这个标记**：标记还在时，修绿会判 XPASS 红。
- **「末条事件为 halt」的断言**本片不动，由 S5b 在加诊断员派发时调整。
- 改完跑一遍 `claude plugin test template/plugins/flight`：除了本片新写、尚未实现的用例，其余都要绿（`dispatch-takes-base-without-start` 也包括在内）。

## owns
- `template/plugins/flight/hooks/orchestrator.tsx`
- `template/plugins/flight/hooks/versions.ts`
- `template/plugins/flight/tests/orchestrator.test.tsx`
- `template/plugins/flight/tests/versions.test.ts`
- `tests/test_flight_orchestrator.py`（标为 S5a 的 3 个骨架）
- `tests/test_flight_versions.py`（末尾 1 个骨架）

## scenario → 测试（骨架为 strict xfail，断言同名 TS 测试通过）
| scenario | pytest 包装 | TS 测试 |
|---|---|---|
| `flight-self-heal#heal-recorded-then-retried` | `tests/test_flight_orchestrator.py::test_heal_recorded_then_retried` | `heal-recorded-then-retried`（orchestrator.test.tsx） |
| `flight-self-heal#watchdog-stops-stalled-agent` | `tests/test_flight_orchestrator.py::test_watchdog_stops_stalled_agent` | `watchdog-stops-stalled-agent` |
| `flight-self-heal#watchdog-exhausted-halts` | `tests/test_flight_orchestrator.py::test_watchdog_exhausted_halts` | `watchdog-exhausted-halts` |
| `flight-integ-fix#takeoff-requires-integ-guard` | `tests/test_flight_versions.py::test_takeoff_requires_integ_guard` | `takeoff-requires-integ-guard`（versions.test.ts）。起飞被拒的那半在 orchestrator.test.tsx 另写 `takeoff-requires-integ-guard/refused`，包装里两个都断言 |

## verify
`python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_versions.py tests/test_flight_abort.py tests/test_flight_takeoff_commit.py`
