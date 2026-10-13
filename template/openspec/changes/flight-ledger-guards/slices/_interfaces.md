# 公开接口摘要

## 约定（规划时写定；各片按这里对接，不得改动）

### `slice-gate.py base`（S1 产出，S7 消费）
```
python3 <hooks>/slice-gate.py base <S> --change-dir <D> [--base <X>] [--expect-branch <B>]
```
- cwd 为切片 worktree，或解冲突 worktree。
- 成功：退出 0，stdout 恰为一行 JSON `{"slice": "<S>", "base": "<X，或 git rev-parse HEAD 全长>"}`。
- G0 不过（只在带 `--expect-branch` 时检查）：退出 1，stdout 为 `{"slice": "<S>", "ok": false, "commit": "", "failed": ["G0 base: …"], "warnings": [], "summary": "基点校验未通过"}`。
- S 不在计划里：退出 2，stderr 写原因。
- 不写任何文件。
- `slice-gate.py start` / `record` 不存在（argparse 错误，退出 2）。
- `gate` / `measure` 的 `--base` 必填。
- `features` 增加一行 `ledger-records`。

### `timeline.py render`（S2 产出，S6 消费）
```
python3 <hooks>/timeline.py render --change-dir <D>
```
- cwd 为 change worktree，D 为相对 change 目录。
- 成功：退出 0，整份重写 `<D>/timeline.md` 与 `<D>/gate-report.md`，stdout 为 `{"timeline": "<路径>", "report": "<路径>", "events": <n>}`。
- 账本读不出：退出 1，stderr 写原因，不写文件。
- 格式见 design D2。`timeline.py record` 不存在。

### `timeline.py report`（S2 产出，S6 的飞行记录照旧调用）
- 调用方式不变：`timeline.py report --change-dir <D>`。账本里有 takeoff 时按账本计算，见 design D2。

### diag 事件（S2 的 `ledger.py`、S5 的 `ev.diag`、S8 的 `io.ts` EVENTS 三处一致）
```json
{"v": 1, "ev": "diag", "change": "<c>", "at": "<ISO>", "by": {"plugin": "flight", "session": "<s>"},
 "attempt": 1, "where": "SubagentStop", "error": "<消息，可为空串>", "kind": "throw|timeout|re-entry", "agent": "<id>", "budget": 10000}
```
- 必填 `attempt`（整数）、`where`（非空字符串）、`error`（字符串）。
- `kind`、`agent`、`budget` 可选。

### `intent-gate.py check`（S3 产出，S4 消费）
```
python3 <hooks>/intent-gate.py check --cwd <C> <PATH> [<PATH> …]
```
- 判完：退出 0，stdout 恰为一行 JSON `{"allow": <bool>, "denied": [{"path": "<绝对路径>", "reason": "<原因>"}]}`。
- 判定异常：退出 2，stderr 写原因。
- 相对 PATH 相对 `--cwd` 解析。

### `envelope.ts`（S4 产出，S4 / S8 消费）
```ts
export function bashWriteTargets(command: string, cwd: string): { targets: string[]; unresolved: string[] }
export function bashWritesVerdict(who: Who, command: string): Deny | undefined
```
- targets 为绝对路径，经 `normalizePath` 规整，去重，保持出现顺序。
- `bashWritesVerdict` 只看写入目标：每个 target 走 `writeVerdict(who, target)`；unresolved 非空时拒绝，原因含「写入目标无法静态判定」。git 拒绝表等仍由 `bashVerdict` 负责，两者由 S8 在 `orchestrator.tsx` 的 `envelopeVerdict` 里串起来。

### `intent.ts`（S4 产出，S8 消费）
```ts
export function toolTargets(tool: string, e: Record<string, unknown>, cwd: string): string[]
export async function intentVerdict(io: Io, hooksDir: string, cwd: string, targets: readonly string[]): Promise<{ deny: string } | undefined>
```
- `e` 是 `tool.call` 的平铺事件：`e.file_path`、`e.notebook_path`、`e.command`。

### `core.ts`（S5 产出，S6 / S8 消费）
```ts
ev.final(b, x: { attempt: number; ok: boolean; commit: string; failed: string[]; warnings?: string[] }): FlightEvent
ev.diag(b, x: { attempt: number; where: string; error: string; kind?: string; agent?: string; budget?: number }): FlightEvent
```
- `reduce` / `next` / `summarize` 忽略 diag。

### `io.ts` `stoppedNow`（S6 产出，S8 消费）
```ts
export async function stoppedNow(io: Io, f: Flight): Promise<'halt' | 'land' | 'unreadable' | undefined>
```
- 按账本最新 takeoff 的 attempt 判断。

### `land.ts` `mergeFix`（S6 维持签名，S7 / S8 照旧调用）
```ts
mergeFix(io, f, _note: string, branch?: string, slice = 'fix')
```
- 第三个形参保留不用，因为并行的 S7 还按原位置传参。

### `abort.ts` `abortFlight`（S7 内部）
- 依赖为 `{ state, session, halt, live, stop, drain }`，流程见 design D7。
