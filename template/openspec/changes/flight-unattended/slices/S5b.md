# S5b · 编排（二）：停飞后派诊断员与 triage、终端通知

依赖 S5a（heal、看门狗、halt 分类已经在 `orchestrator.tsx` 里；`takeoff` 已 export），以及 S1 / S3 / S4 已合回的部分（Role diagnostician、`ev.triage`、`triagePrompt`、`flight:diagnostician`、landing 的 `ctx.notify?.(…)`）。接口见 `slices/_interfaces.md` 的「S5b」。S6、S7 与本片并行：本片不改 `register.tsx`。

## 先读：attempt 1 的教训与可参考的半成品
- attempt 1 的 S5（S5a 与本片合在一起）派了两个执行体，都用满 maxTurns 40 次模型请求被截断，没提交。拆成 S5a / S5b 就是为此。
- 半成品存为提交 `c563e41`（分支 `flight/flight-unattended/S5`，基于 `b311efd`，那时 S4 尚未合回）：
  - **只读参考**：`git -C <本 worktree> show c563e41 -- template/plugins/flight/hooks/orchestrator.tsx`，或 `git -C <本 worktree> show c563e41:<路径>` 看整文件；
  - **不得 merge / cherry-pick**，用 Edit 只搬本片的部分。可参考的位置（`c563e41` 的行号）：
    - `orchestrator.tsx`：`ctxOf` 的 notify（约 :136），spawn 时把 diagnostician 映射为 `flight:diagnostician`（约 :117），包络对诊断员只读（约 :198、:244），停飞后派诊断员（约 :452–:466），`turn.complete` 收到诊断员结束（约 :1072）；
    - `orchestrator.test.tsx`：`halt-dispatches-diagnostician`（含 `/abort-skips`）、`notify-uses-terminal-channel`（含 `/not-sent`），约 :1976–:2047；
  - **它不完整**：最后一次跑插件测试，这几个用例仍然红。照搬前先看懂。
- `io.ts` 的 `agentType` 不认识 diagnostician，缺省会落到 `flight:fixer`。`io.ts` 不归本片，所以在 `orchestrator.tsx` 里单独映射（`c563e41` 就是这样写的）。

## 省轮次（attempt 1 在这些地方浪费了约 13 轮）
- 改文件一律用 Edit / Write，路径写字面绝对路径。不要用 `sed -i`、`python3 -c` 改文件，不要用 heredoc，不要把输出重定向到 worktree 以外（/tmp、scratchpad 都会被拒）。
- 命令里带 `$` 或反引号时，包络可能判为「无法判定」。查找用 `grep -n -e … <字面路径>`。
- 没有 Grep 工具，用 Bash 的 grep。`git checkout` 会被拒。不要 `find /` 找类型文件。
- `claude plugin test template/plugins/flight` 跑全量约 4 秒，直接接 `2>&1 | grep -E "^\(fail\)| pass| fail"` 过滤。

## 测试世界的已知事实（CLI 2.1.296；来源：API 类型文件与 attempt 1 的探针）
- 测试一侧的 `$` 上没有 `$.ui.notify`。插件调用 `$.ui.notify` 时，由测试世界用 `on('ui.notify', …)` 应答。类型文件的示例是 `on('ui.notify', { title: 'CI' }, () => ({ value: REFUSED }))`；应答值为 `{ isSent: true, channel }` 或 `{ isSent: false, reason }`，reason 取值为 `disabled` / `no-channel` / `no-surface` / `refused`。
- 诊断员的结束沿用现有世界里 agent 结束的写法（`turn.complete`），最终回答从 `await next(e)` 的结果里取 `text`。

## 测量协议（G5 逐目标判）
1. **先写测试**：在 `orchestrator.test.tsx` 写 `halt-dispatches-diagnostician`（abort 不派的那半另写 `halt-dispatches-diagnostician/abort-skips`）、`notify-uses-terminal-channel`（未发出的那半另写 `notify-uses-terminal-channel/not-sent`）。包装里两个都断言。
2. **去掉 xfail**：去掉 `tests/test_flight_orchestrator.py` 里标为 S5b 的 2 个包装上的 xfail。
3. **先测红**：改 `orchestrator.tsx` 之前调用 `measure`，看 2 个目标都红。
4. 再实现。

## 做什么（design D5、D6 的执行侧）

### `template/plugins/flight/hooks/orchestrator.tsx`

**`ctxOf` 增加 `notify`**：
- 调用 `$.ui.notify(text, { title: 'flight' })`；
- 返回 `isSent: false` 时，用 `ctx.log` 写一行「flight 通知未发出：<reason>」；
- 抛错时同样记一行，不往外抛。

**停飞后派诊断员**：
- driveNow 里执行完 halt（包括 `perform` 的 halt、`terminal()`、S5a 的看门狗停飞）之后，若 halt 的 kind 不是 abort 或 fingerprint，就在 change worktree 派发诊断员：
  - `ctx.spawn` 的 role 为 diagnostician，subagent 类型为 `flight:diagnostician`，显式指定 model 为 `f.model`；
  - 提示词为 `triagePrompt({change, changeDir, hooksDir, reason, kind})`；
  - 追加 `dispatch {role: 'diagnostician', slice: 'triage', …}`；
  - 本 attempt 已经派过诊断员时不再派。
- `HIDDEN` 里加入 `flight:diagnostician`。
- `turn.complete` 收到诊断员结束时：
  1. 照旧追加 ended；
  2. 从 `await next(e)` 的结果取 `text`，截断到 4000 字，为空时写「（无回答）」；
  3. 追加 `ev.triage`；
  4. 用回答首行调用 `ctx.notify`；
  5. 刷新面板，摘要多一行「诊断：<首行>」。

  此时 attempt 已结束，不必再 drive。

**包络角色**：`envelopeOf` / owners 对 diagnostician 的 owns 为空（与 reviewer 相同），`inEnvelope` 不为它升 allow。

## 现有用例要改（本片 owns）
- **「末条事件为 halt」的断言**（`c563e41` 之前的行号约为 :615、:661、:957、:1835，S5a 之后会有偏移，用 grep 查找）：诊断员会在 halt 之后追加 dispatch，所以改成「最后一条 halt 存在，且其后只有诊断员的 dispatch / ended / triage」。不要删断言。
- **测试世界**默认应答 `ui.notify` 为 `{isSent: true, channel: 'iterm2'}`。
- 改完跑一遍 `claude plugin test template/plugins/flight`：除了本片新写、尚未实现的用例，其余都要绿。

## owns
- `template/plugins/flight/hooks/orchestrator.tsx`
- `template/plugins/flight/tests/orchestrator.test.tsx`
- `tests/test_flight_orchestrator.py`（标为 S5b 的 2 个骨架）

## scenario → 测试（骨架为 strict xfail，断言同名 TS 测试通过）
| scenario | pytest 包装 | TS 测试 |
|---|---|---|
| `flight-halt-handoff#halt-dispatches-diagnostician` | `tests/test_flight_orchestrator.py::test_halt_dispatches_diagnostician` | `halt-dispatches-diagnostician` 与 `halt-dispatches-diagnostician/abort-skips`（orchestrator.test.tsx） |
| `flight-halt-handoff#notify-uses-terminal-channel` | `tests/test_flight_orchestrator.py::test_notify_uses_terminal_channel` | `notify-uses-terminal-channel` 与 `notify-uses-terminal-channel/not-sent` |

## verify
`python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_abort.py tests/test_flight_takeoff_commit.py`
