# 跨切片契约（flight-armed-followups）

W1 = S1 ∥ S2 ∥ S3；W2 = S4（依赖 S2）∥ S5（依赖 S2）。

**插件通则**（违反会导致 validate 失败或测试假红）：
- **`$` 不出文件**：`$` 只能传给同一文件里声明的函数；要跨文件，就传在本文件 hook 里造好的闭包。
- **测试与插件是隔离实例**：测试 import 插件模块，拿到的是另一份模块状态；模块变量（锁、进行中表、`entry`）只能经插件 hook 的效果观察。
- **`Button` 没有禁用属性**（CLI 2.1.296）：「不可按」的做法是不渲染按钮，只显示文字。
- **提交时刻要在调用 submit 之前取**：实测，插件提交的那一轮，开始时刻（结束时的 `clock.now` 减 `durationMs`）比 `prompt.submit` 完成早 7–20 ms。

## S2 · `orchestrator.tsx` 与 `types/index.d.ts`

```ts
// 纯函数，由本文件导出，S5 的 register.tsx import 它，删掉自己那份 scenarioFilesOf
export async function scenarioFiles(io: Io, path: string): Promise<string[]>
```

`types/index.d.ts`：
```ts
export type FlightItem = { …; busy?: string }          // 非空 = 进行中文字（「起飞中…」「基线运行中（已 N 分钟）」），渲染时只显示文字、不渲染按钮
export type FlightArmedItem = { …; submittedAt?: number } // 交模型那一轮提交前的时刻 T0；缺失时 main-turn 按旧行为推进
```

- **锁**：沿用 `armBusy`。人工起飞撞锁时回复「flight：<change> 正在起飞，稍候」；`/flight abort` 撞锁时回复「flight：<change> 正在自动起飞，结束后再 /flight abort」。
- **S4 在 S2 之上加「正在飞」判据**：drive 期间登记进程内的 `driving: Set<string>`，`drive()` 的开头加入、结束时移除。由 S4 新增，S2 不做。

## S1 · `armed.ts` 与 `land.ts`

- `armed.ts` 的公开函数签名不变；只改 `relaunch`（`giveUpText` 用它）的做法文本。
- `land.ts` 的 `commitArtifacts` 签名不变；识别已暂存删除时改读 `git status --porcelain -z`。

## S4 · `orchestrator.tsx`

- 拒飞条件：`state.takeoff !== undefined && !settled && owner === session && active.has(name) && (driving.has(name) || (await liveAgents($, f, state)).length > 0)`；
- 拒绝原文：`flight：<name> 正在飞（attempt N），不起飞；需要中止用 /flight abort <name>；中止后可用 /flight resume <name> 续飞`。

## S5 · `register.tsx`

- import `scenarioFiles` 与 `takeoffNow`（都来自 `./orchestrator`），不把 `$` 传出本文件。
- 进程内进行中表：`Map<string, { phase: 'takeoff' | 'baseline'; since: number }>`。刷新批准带时，按它给项填 `busy`。
- 基线进度：用 `$.clock.after(60000, …)` 自己续表，基线结束即停；状态行文本见 spec `flight-band-progress`。
