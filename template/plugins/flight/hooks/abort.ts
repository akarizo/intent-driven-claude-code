// 人工中止（/flight abort，spec flight-abort · design D3）：先在账本记停飞，再停在飞的 agent。
// 纯逻辑：不 import 运行时值，副作用全经 halt / live / stop 三个回调。
import type { State } from './core'

export async function abortFlight(x: {
  state: State
  session: string
  halt: (reason: string) => Promise<boolean>
  live: () => Promise<string[]>
  stop: (agentId: string) => Promise<string | undefined>
}): Promise<string> {
  const { state } = x
  const t = state.takeoff
  const ended = state.events.some(e => (e.ev === 'land' || e.ev === 'halt') && Number(e.attempt) === state.attempt)
  if (!t || ended) return '没有在飞的 attempt，无需中止。'
  const owner = String(t.by.session)
  if (owner !== x.session) return `在飞的 attempt 属于另一个会话（${owner.slice(0, 8)}），请到那个会话里 /flight abort。`
  if (!(await x.halt('人工中止（/flight abort）'))) return '记停飞失败，未停任何 agent。'
  const ids = await x.live()
  const lines: string[] = []
  for (const id of ids) {
    const why = await x.stop(id)
    lines.push(why === undefined ? `- ${id}：已停` : `- ${id}：未停（${why}）`)
  }
  return [
    `已中止 ${t.change} attempt ${state.attempt}（已在账本记停飞）`,
    ...(lines.length ? lines : ['- 没有在飞的 agent']),
    `未提交的改动留在各自 worktree；可用 /flight resume ${t.change} 续飞`,
  ].join('\n')
}
