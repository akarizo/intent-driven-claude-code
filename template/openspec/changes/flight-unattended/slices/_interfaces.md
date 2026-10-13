# 接口约定（跨切片）

并行切片按这里的签名与语义写代码；先合回的一方实现，后合回的一方按约定调用。行为细节以 design.md 与 specs/ 为准。

## S1 · `template/plugins/flight/hooks/core.ts`

```ts
export type Role = 'executor' | 'reviewer' | 'fixer' | 'resolver' | 'diagnostician'
export type HealKind = 'merge-retry' | 'watchdog' | 'integ'
export type HaltKind = 'blocked' | 'final' | 'integ' | 'fingerprint' | 'control' | 'watchdog' | 'abort'
export const HEAL_BUDGET = 3
export const INTEG = 'integ'            // 整合修复体与其专审评审的 slice 名

// Action 的增改（其余成员不变）
| { kind: 'heal'; heal: HealKind; slice: string; reason: string; agent?: string }
| { kind: 'halt'; reason: string; haltKind: HaltKind }
| { kind: 'dispatch'; role: 'fixer'; slice?: string; findings: Finding[]; failed?: string[] }        // integ 带 failed
| { kind: 'dispatch'; role: 'reviewer'; slice: string; commit: string; mode?: 'whole' | 'followup' | 'integ'; base?: string; prior?: Finding[] }

// 纯函数
export function healVerdict(state: State, kind: HealKind, slice: string): { ok: true } | { ok: false; reason: string }
//   reason：'自愈预算已用尽（3/3）' 或 '同一处已自愈过一次'

// 事件构造（ev 增加）
ev.heal(b, { attempt, kind: HealKind, slice, reason, agent? })
ev.triage(b, { attempt, agent, text })
ev.halt(b, { attempt, reason, kind?: HaltKind })      // kind 可选，有则写入事件

// Ctx 增加可选成员
notify?(text: string): Promise<void>

// summarize / summaryLines：多一行「自愈 k/3：<kind> <slice> · …」（无 heal 为「自愈 0/3」）；
// 有 triage 时多一行「诊断：<triage 首行>」
```

watchdog heal 的 slice 写法：
- 执行体 = 切片 id；
- 评审员 = `review:<slice>`；
- 修复体 = 其 slice（`fix` / `fix-r<k>` / `integ`）；
- 解冲突 agent = `resolve:<slice>`。

integ 修复体的 dispatch 事件带 `base`（S4 写入），专审评审员的 Action 取它作 `base`。

## S1 · `template/plugins/flight/hooks/envelope.ts`

- `ROLE_NAME.diagnostician = '诊断员'`；
- diagnostician 与 reviewer 同规则：不可写任何文件；git 只读（REVIEWER_EXTRA 同样拒）；`bashUpgradable` 不为它升 allow。

## S2 · 判定器

- `slice-gate.py final --change-dir D [--reuse-fix] [--integ-base SHA]`：
  - 带 `--integ-base` 时追加 G9 判据，失败项以 `G9 integ:` 开头；
  - 同时传 `--reuse-fix` 也照常判 G9（G9 不依赖全量）。
- `slice-gate.py features` 多一行 `integ-guard`。
- `ledger.py`：
  - EVENTS 增加：
    - `heal`：`attempt`、`kind ∈ {merge-retry, watchdog, integ}`、`slice`（非空）、`reason`（字符串）；
    - `triage`：`attempt`、`agent`（非空）、`text`（字符串）。
  - dispatch 的 role 增加 `diagnostician`。
  - halt 的 `kind` 可选，有则须属 HaltKind 集合。
  - `ledger.py events` 的输出含 heal、triage。
- `timeline.py report`：
  - 有 heal 时打印「自愈：k 次」，每条一行 `<kind> <slice>`（可附 reason）；
  - 有 triage 时打印「停飞诊断：<首行>」。
  - `render` 的 timeline.md 记 heal、triage 行。

## S3 · `template/plugins/flight/hooks/prompts.ts`

```ts
export function integFixerPrompt(x: { change: string; changeDir: string; failed: string[]; base: string }): string
export function integReviewPrompt(x: { change: string; changeDir: string; base: string; commit: string }): string
export function triagePrompt(x: { change: string; changeDir: string; hooksDir: string; reason: string; kind: string }): string
```

## S3 · `template/plugins/flight/hooks/watchdog.ts`

```ts
export const WATCHDOG_MS = 600000
export class StepTracker {
  start(id: string, at: number): void   // 覆盖同一 id 的旧起点
  end(id: string): void
  stale(now: number, limitMs?: number): string[]   // 起点 < now - limitMs，按 start 先后排序
  forget(id: string): void
}
```

## S3 · `template/plugins/flight/agents/diagnostician.md`

- 类型 `flight:diagnostician`；
- tools `Read, Grep, Glob, Bash`；effort high；maxTurns 30；不带 model。

## S4 · 落地

- `io.ts` 的 EVENTS 与 ledger.py 同步（heal、triage、diagnostician、halt.kind 可选）。
- `runLandingAction`：
  - **派修复体**：
    - `action.slice === 'integ'` 时用 `integFixerPrompt`，failed 取 `action.failed`、base 取派发前 change worktree 的 HEAD；
    - dispatch 事件追加 `base`。
  - **派评审员**：`mode: 'integ'` 时用 `integReviewPrompt`，范围取动作上的 `base` / `commit`，dispatch 事件带二者。
  - **halt**：
    1. 追加 `ev.halt(b, {attempt, reason, kind: action.haltKind})`；
    2. `haltKind !== 'abort'` 时 `await ctx.notify?.(…)`，抛错吞掉。
  - **交接 pr-ship 失败**：toast 之外再 `ctx.notify?.(…)`。
- `onLandingStop`：slice 为 `integ` 的修复体，final 带 `--integ-base <其 dispatch 的 base>`。
- `ship.ts` 的 `shipPr`：ship 事件写入后 `ctx.notify?.(…)`，内容含 PR 号或链接、verdict、blocking 条数。

## S5 · 编排

- `perform` 处理 `heal`：只追加 heal 事件并返回 true（下一轮 next 给出派发）。
- `ctxOf($).notify = text => $.ui.notify(text, { title: 'flight' })`：未发出或抛错时 `ctx.log` 一行，不抛。
- `export async function takeoff($: Engine, args: string[], opts?: { resume?: boolean }): Promise<string>`：签名不变，只改为 export，供 S6 使用。
- 看门狗：
  - `turn.step`（async generator，`{ agentId: /./ }`）驱动 `StepTracker`；
  - `session.start` 起 `$.clock.every(60000, …)`，计时器结束后在下次 `turn.step` 重起。
- 停飞后派诊断员：`agentType('diagnostician') = 'flight:diagnostician'`，`HIDDEN` 加入；`turn.complete` 收到诊断员结束时，追加 triage 并通知。
- `/flight abort` 的 halt 带 `haltKind: 'abort'`；driveNow `terminal()` 的 halt 带 `haltKind: 'control'`。
- `versions.ts` 的 `REQUIRED_FEATURES` 加 `integ-guard`。

## S6 · `template/plugins/flight/hooks/resume.ts`

```ts
export type ResumeDeps = {
  stopLive(change: string): Promise<string[]>          // 返回被停的 agent id
  baseline(change: string): Promise<{ ok: boolean; reasons: string[] }>
  takeoff(args: string[], opts: { resume: true }): Promise<string>
  notify(text: string): Promise<void>
  toast(text: string): void
}
export async function resumeFlight(deps: ResumeDeps, change: string, opts: { replan: boolean }): Promise<string>
```
