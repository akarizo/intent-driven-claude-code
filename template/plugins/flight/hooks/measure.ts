// 测量（spec flight-measure · design D2 / D3）：执行体请求、控制面运行本片 scenario 测试并把结果记进账本。
// 与 landing.tsx 的 FINDINGS_TOOL / onFindings 同一模式：不注册 hook、不碰 $，副作用全经调用方造的 Ctx 闭包。
import { agentOf, currentAttempt, ev, reduce } from './core'
import type { Ctx, Flight, Found } from './core'
import { appendEvent, judge } from './io'

const MEASURE_TIMEOUT_MS = 600000
const DENY_OTHERS = '只有本次飞行的执行体可以请求测量'
const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''

export const MEASURE_TOOL: { name: 'measure'; description: string; inputSchema: Record<string, unknown> } = {
  name: 'measure',
  description:
    '请求控制面运行本片 scenario 测试并把结果记进飞行账本。只有 flight 本次飞行的执行体可用。改生产代码之前先调用一次，看它红；实现后再调用确认转绿。',
  inputSchema: { type: 'object', properties: {} },
}

/** slice-gate.py measure 退出 0 时打印的 JSON */
export type MeasureJson = {
  slice: string
  base: string
  commit: string
  outcomes: [string, string][]
  unmeasurable: string[]
  changed: string[]
  source: string[]
  tail: string
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [])

/** 跑一次 slice-gate measure 并记账；跑不起来、输出不是 JSON、写账本失败都返回 error，不记事件。 */
export async function measureSlice(
  ctx: Ctx,
  f: Flight,
  x: { attempt: number; slice: string; agent: string; worktree: string; base?: string },
): Promise<{ m: MeasureJson } | { error: string }> {
  const args = ['measure', x.slice, '--change-dir', f.changeDir, ...(x.base ? ['--base', x.base] : [])]
  const r = await judge(ctx.io, f, 'slice-gate', args, x.worktree, MEASURE_TIMEOUT_MS)
  let j: Partial<MeasureJson> & { error?: unknown }
  try {
    j = JSON.parse(r.stdout) as typeof j
    if (j === null || typeof j !== 'object') throw new Error('不是对象')
  } catch {
    return { error: firstLine(r.stderr) || firstLine(r.stdout) || `slice-gate measure 输出不是 JSON（exit ${r.exitCode}）` }
  }
  if (r.exitCode !== 0) return { error: typeof j.error === 'string' && j.error !== '' ? j.error : firstLine(r.stderr) || `exit ${r.exitCode}` }
  const m: MeasureJson = {
    slice: x.slice,
    base: typeof j.base === 'string' && j.base !== '' ? j.base : x.base ?? '',
    commit: typeof j.commit === 'string' ? j.commit : '',
    outcomes: Array.isArray(j.outcomes) ? (j.outcomes as [string, string][]) : [],
    unmeasurable: strs(j.unmeasurable),
    changed: strs(j.changed),
    source: strs(j.source),
    tail: typeof j.tail === 'string' ? j.tail : '',
  }
  const b = { change: f.change, at: new Date(await ctx.now()).toISOString(), session: f.session }
  const event = ev.measure(b, { attempt: x.attempt, slice: x.slice, agent: x.agent, base: m.base, commit: m.commit, outcomes: m.outcomes, changed: m.changed, source: m.source })
  if (!(await appendEvent(ctx.io, f, event))) return { error: '写账本失败' }
  return { m }
}

/** 测量结果给执行体看的文本。 */
function report(m: MeasureJson): string {
  const lines = m.outcomes.map(([target, status]) => `- ${target}：${status}`)
  const red = m.outcomes.filter(([, s]) => s === 'FAILED' || s === 'ERROR').map(([t]) => t)
  lines.push(red.length ? `本次见红：${red.join('，')}` : '本次未见红')
  if (red.length && m.source.length) lines.push(`注意：测量时已改动生产代码 ${m.source.join('，')}，这次红不能作为先红证据`)
  if (m.unmeasurable.length) lines.push(`不可测的目标：${m.unmeasurable.join('，')}`)
  if (m.tail) lines.push(m.tail)
  return lines.join('\n')
}

/** mcp__flight__measure 的处理：只认当前 attempt 里 role 为 executor 的调用者。 */
export async function onMeasure(ctx: Ctx, found: Found | undefined, agentId: string | undefined): Promise<{ result: string } | { deny: string }> {
  const state = found && reduce(found.events)
  const a = state && agentId ? agentOf(state, agentId) : undefined
  if (!found || !state || !agentId || !a || a.role !== 'executor' || a.attempt !== currentAttempt(state)) return { deny: DENY_OTHERS }
  const r = await measureSlice(ctx, found.flight, { attempt: a.attempt, slice: a.slice, agent: agentId, worktree: a.worktree, base: a.base })
  if ('error' in r) return { result: `测量没有完成：${r.error}` }
  return { result: report(r.m) }
}
