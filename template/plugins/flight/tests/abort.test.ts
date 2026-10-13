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

/** 记录调用顺序的假回调：halt 返回 haltOk；live 第 n 次返回 lives[n]（用完沿用最后一个）；stop 按 failures 返回原因；drain 等 drained 完成 */
function fakes(lives: string[][], failures: Record<string, string> = {}, haltOk = true, drained: Promise<void> = Promise.resolve()) {
  const calls: string[] = []
  let n = 0
  return {
    calls,
    halt: async (reason: string) => {
      calls.push(`halt:${reason}`)
      return haltOk
    },
    live: async () => {
      calls.push('live')
      return lives[Math.min(n++, lives.length - 1)] ?? []
    },
    stop: async (id: string) => {
      calls.push(`stop:${id}`)
      return failures[id]
    },
    drain: async () => {
      calls.push('drain')
      await drained
    },
  }
}

test('abort-halts-then-stops-live-agents', async () => {
  // Given: 本会话 sess-1 起飞的 demo attempt 1 在飞（已派 S1→a2、S2→a3），live 返回 a2、a3，停 a3 返回 'not found'
  const state = reduce([takeoff(1), dispatch(1, 'S1', 'a2'), dispatch(1, 'S2', 'a3')])
  const f = fakes([['a2', 'a3']], { a3: 'not found' })

  // When: 以本会话 sess-1 调用 abortFlight
  const reply = await abortFlight({ state, session: ME, halt: f.halt, live: f.live, stop: f.stop, drain: f.drain })

  // Then: 调用顺序为 halt（原因含「人工中止」）→ live → stop a2 → stop a3 → drain → live（第二段没有新 agent）；回复首行为已中止 demo attempt 1；a2 行含已停；a3 行含未停与 not found；含 /flight resume demo
  expect(f.calls).toEqual(['halt:人工中止（/flight abort）', 'live', 'stop:a2', 'stop:a3', 'drain', 'live'])
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
  const fs = ledgers.map(() => fakes([['a9']]))

  // When: 对每份账本以本会话 sess-1 调用 abortFlight
  const replies = await Promise.all(ledgers.map((l, i) => abortFlight({ state: reduce(l), session: ME, halt: fs[i].halt, live: fs[i].live, stop: fs[i].stop, drain: fs[i].drain })))

  // Then: 第一、三份含「没有在飞的 attempt」；第二份含「另一个会话（other-se）」与「到那个会话里 /flight abort」；三套回调都没有被调用
  expect(replies[0]).toContain('没有在飞的 attempt')
  expect(replies[2]).toContain('没有在飞的 attempt')
  expect(replies[1]).toContain('另一个会话（other-se）')
  expect(replies[1]).toContain('到那个会话里 /flight abort')
  expect(fs.flatMap(f => f.calls)).toEqual([])
})

test('abort-stops-agents-before-draining', async () => {
  // Given: 本会话 sess-1 在飞的 demo attempt 1（已派 S1→a1、S2→a2）；live 第一次返回 [a1, a2]、第二次返回 [a1, a3]；drain 返回的 promise 等测试调用 finish 才完成
  const state = reduce([takeoff(1), dispatch(1, 'S1', 'a1'), dispatch(1, 'S2', 'a2')])
  let finish = () => {}
  const drained = new Promise<void>(r => (finish = r))
  const f = fakes([['a1', 'a2'], ['a1', 'a3']], {}, true, drained)
  const settle = async () => {
    for (let i = 0; i < 50 && !f.calls.includes('drain'); i++) await new Promise(r => setTimeout(r, 1))
    const before = [...f.calls]
    finish()
    return before
  }

  // When: 以本会话调用 abortFlight，drain 完成前记下调用记录，然后让 drain 完成并等回复
  const [reply, before] = await Promise.all([abortFlight({ state, session: ME, halt: f.halt, live: f.live, stop: f.stop, drain: f.drain }), settle()])

  // Then: drain 完成前的调用顺序为 halt → live → stop a1 → stop a2 → drain；drain 完成后只多出 live → stop a3；回复里 a1、a2、a3 三行都含「已停」
  expect(before).toEqual(['halt:人工中止（/flight abort）', 'live', 'stop:a1', 'stop:a2', 'drain'])
  expect(f.calls.slice(before.length)).toEqual(['live', 'stop:a3'])
  expect(['a1', 'a2', 'a3'].map(id => reply.split('\n').find(l => l.includes(`${id}：`)) ?? '')).toEqual(['- a1：已停', '- a2：已停', '- a3：已停'])
})

test('abort-stops-residual-agents', async () => {
  // Given: 三份账本（都由本会话 sess-1 起飞）：甲 = attempt 1 派了 S1→a3 后已 halt「final 未通过：G2」，live 返回 [a3]；
  //        乙 = 同甲，live 返回 []；丙 = attempt 1 已 land；每份配一套假回调
  const halted = [takeoff(1), dispatch(1, 'S1', 'a3'), ev.halt(at(ME), { attempt: 1, reason: 'final 未通过：G2' })]
  const ledgers: FlightEvent[][] = [halted, halted, [takeoff(1), ev.land(at(ME), { attempt: 1, verdict: 'ready' })]]
  const fs = [fakes([['a3']]), fakes([[]]), fakes([['a3']])]

  // When: 对每份账本以本会话 sess-1 调用 abortFlight
  const replies = await Promise.all(ledgers.map((l, i) => abortFlight({ state: reduce(l), session: ME, halt: fs[i].halt, live: fs[i].live, stop: fs[i].stop, drain: fs[i].drain })))

  // Then: 甲的调用为 live → stop a3（没有 halt），回复首行为「demo attempt 1 已停飞（final 未通过：G2）；停掉残留 agent：」且含「a3：已停」与「/flight resume demo」；
  //       乙与丙都回答「没有在飞的 attempt，无需中止。」，两者都没有调用 halt 与 stop
  expect(fs[0].calls).toEqual(['live', 'stop:a3'])
  expect(replies[0].split('\n')[0]).toBe('demo attempt 1 已停飞（final 未通过：G2）；停掉残留 agent：')
  expect([replies[0].includes('a3：已停'), replies[0].includes('/flight resume demo')]).toEqual([true, true])
  expect([replies[1], replies[2]]).toEqual(['没有在飞的 attempt，无需中止。', '没有在飞的 attempt，无需中止。'])
  expect([...fs[1].calls, ...fs[2].calls].filter(c => c.startsWith('halt') || c.startsWith('stop'))).toEqual([])
})
