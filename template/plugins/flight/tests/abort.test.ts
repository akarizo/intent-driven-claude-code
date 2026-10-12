// scenario 来源：spec flight-abort（abort-*）。abort.ts 是纯逻辑，副作用经三个回调；这里用记录调用顺序的假回调。
import { expect, test } from 'claude-code/testing'
import { abortFlight } from '../hooks/abort'
import { ev, reduce } from '../hooks/core'
import type { FlightEvent } from '../hooks/core'

const AT = '2026-10-12T00:00:00Z'
const ME = 'sess-1'
const at = (session: string) => ({ change: 'demo', at: AT, session })
const takeoff = (attempt: number, session = ME) =>
  ev.takeoff(at(session), { attempt, fp: 'f'.repeat(64), branch: 'worktree-demo', waves: [['S1', 'S2']], model: 'opus' })
const dispatch = (attempt: number, slice: string, agent: string, session = ME) =>
  ev.dispatch(at(session), { attempt, slice, role: 'executor', agent, model: 'claude-opus-5-5', worktree: `/wt/${slice}` })

/** 记录调用顺序的假回调：halt 返回 haltOk，live 返回 ids，stop 按 failures 返回原因 */
function fakes(ids: string[], failures: Record<string, string> = {}, haltOk = true) {
  const calls: string[] = []
  return {
    calls,
    halt: async (reason: string) => {
      calls.push(`halt:${reason}`)
      return haltOk
    },
    live: async () => {
      calls.push('live')
      return ids
    },
    stop: async (id: string) => {
      calls.push(`stop:${id}`)
      return failures[id]
    },
  }
}

test('abort-halts-then-stops-live-agents', async () => {
  // Given: 本会话 sess-1 起飞的 demo attempt 1 在飞（已派 S1→a2、S2→a3），live 返回 a2、a3，停 a3 返回 'not found'
  const state = reduce([takeoff(1), dispatch(1, 'S1', 'a2'), dispatch(1, 'S2', 'a3')])
  const f = fakes(['a2', 'a3'], { a3: 'not found' })

  // When: 以本会话 sess-1 调用 abortFlight
  const reply = await abortFlight({ state, session: ME, halt: f.halt, live: f.live, stop: f.stop })

  // Then: 调用顺序为 halt（原因含「人工中止」）→ live → stop a2 → stop a3；回复首行为已中止 demo attempt 1；a2 行含已停；a3 行含未停与 not found；含 /flight resume demo
  expect(f.calls).toEqual(['halt:人工中止（/flight abort）', 'live', 'stop:a2', 'stop:a3'])
  expect(reply.split('\n')[0]).toContain('已中止 demo attempt 1（已在账本记停飞）')
  expect(reply.split('\n').find(l => l.includes('a2'))).toContain('已停')
  expect(reply.split('\n').find(l => l.includes('a3'))).toContain('未停（not found）')
  expect(reply).toContain('/flight resume demo')
})

test('abort-refuses-without-own-flight', async () => {
  // Given: 三份账本：① sess-1 起飞的 attempt 1 已 land ② 最新 takeoff 来自 other-session-1234 且在飞 ③ 没有 takeoff；每份配一套假回调
  const ledgers: FlightEvent[][] = [
    [takeoff(1), ev.land(at(ME), { attempt: 1, verdict: 'ready' })],
    [takeoff(1), ev.halt(at(ME), { attempt: 1, reason: 'x' }), takeoff(2, 'other-session-1234'), dispatch(2, 'S1', 'a9', 'other-session-1234')],
    [],
  ]
  const fs = ledgers.map(() => fakes(['a9']))

  // When: 对每份账本以本会话 sess-1 调用 abortFlight
  const replies = await Promise.all(ledgers.map((l, i) => abortFlight({ state: reduce(l), session: ME, halt: fs[i].halt, live: fs[i].live, stop: fs[i].stop })))

  // Then: 第一、三份含「没有在飞的 attempt」；第二份含「另一个会话（other-se）」与「到那个会话里 /flight abort」；三套回调都没有被调用
  expect(replies[0]).toContain('没有在飞的 attempt')
  expect(replies[2]).toContain('没有在飞的 attempt')
  expect(replies[1]).toContain('另一个会话（other-se）')
  expect(replies[1]).toContain('到那个会话里 /flight abort')
  expect(fs.flatMap(f => f.calls)).toEqual([])
})
