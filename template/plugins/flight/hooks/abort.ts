// 人工中止（/flight abort，spec flight-abort · design D3、D7）：先在账本记停飞，再分两段停在飞的 agent；
// 本 attempt 已自动停飞时只停残留 agent。
// 纯逻辑：不 import 运行时值，副作用全经 halt / live / stop / drain 四个回调。
import type { State } from './core'

export async function abortFlight(x: {
  state: State
  session: string
  halt: (reason: string) => Promise<boolean>
  live: () => Promise<string[]>
  stop: (agentId: string) => Promise<string | undefined>
  drain: () => Promise<void>
}): Promise<string> {
  const { state } = x
  const t = state.takeoff
  const ofA = (e: { attempt?: unknown }) => Number(e.attempt) === state.attempt
  const landed = state.events.some(e => e.ev === 'land' && ofA(e))
  if (!t || landed) return '没有在飞的 attempt，无需中止。'
  const owner = String(t.by.session)
  if (owner !== x.session) return `在飞的 attempt 属于另一个会话（${owner.slice(0, 8)}），请到那个会话里 /flight abort。`
  const lines: string[] = []
  const seen = new Set<string>()
  const stopAll = async () => {
    for (const id of await x.live()) {
      if (seen.has(id)) continue
      seen.add(id)
      const why = await x.stop(id)
      lines.push(why === undefined ? `- ${id}：已停` : `- ${id}：未停（${why}）`)
    }
  }
  const resume = `未提交的改动留在各自 worktree；可用 /flight resume ${t.change} 续飞`
  const halted = state.events.find(e => e.ev === 'halt' && ofA(e))
  if (halted) {
    // 已自动停飞：不另记 halt，只停残留 agent
    await stopAll()
    if (!lines.length) return '没有在飞的 attempt，无需中止。'
    const why = String(halted.reason ?? '').trim().split('\n')[0] ?? ''
    return [`${t.change} attempt ${state.attempt} 已停飞（${why}）；停掉残留 agent：`, ...lines, resume].join('\n')
  }
  if (!(await x.halt('人工中止（/flight abort）'))) return '记停飞失败，未停任何 agent。'
  // 第一段先停已在跑的，再等手上这轮 drive 做完，第二段只停其间新派出的
  await stopAll()
  await x.drain()
  await stopAll()
  return [
    `已中止 ${t.change} attempt ${state.attempt}（已在账本记停飞）`,
    ...(lines.length ? lines : ['- 没有在飞的 agent']),
    resume,
  ].join('\n')
}
