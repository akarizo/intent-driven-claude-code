// scenario 来源：spec flight-halt-handoff#resume-flight-sequence。resume.ts 是纯逻辑，副作用全经 deps；这里用记录调用顺序的假依赖。
import { expect, test } from 'claude-code/testing'
import { resumeFlight } from '../hooks/resume'
import type { ResumeDeps } from '../hooks/resume'

type Script = { live: string[]; baseline: { ok: boolean; reasons: string[] }; reply: string }

/** 记录调用顺序的假依赖：stopLive 返回 live；baseline 返回 baseline；takeoff 返回 reply */
function fakes(s: Script) {
  const calls: string[] = []
  const takeoffs: { args: string[]; opts: { resume: true } }[] = []
  const notes: string[] = []
  const deps: ResumeDeps = {
    stopLive: async change => {
      calls.push(`stopLive:${change}:${s.live.join(',')}`)
      return s.live
    },
    baseline: async change => {
      calls.push(`baseline:${change}`)
      return s.baseline
    },
    takeoff: async (args, opts) => {
      calls.push('takeoff')
      takeoffs.push({ args, opts })
      return s.reply
    },
    notify: async text => {
      notes.push(text)
    },
    toast: () => undefined,
  }
  return { deps, calls, takeoffs, notes }
}

const GREEN = { ok: true, reasons: [] }
const REPLY = '续飞 attempt 2：已合回 3 片跳过\n✈ 起飞 demo：4 片 / 2 个 wave'

test('resume-flight-sequence', async () => {
  // Given: 甲：诊断员 d1 仍在跑、baseline 绿、takeoff 回复「续飞 attempt 2：已合回 3 片跳过\n✈ 起飞 demo …」；乙：baseline 红、reasons 首行「S2 verify 红」；丙：计划未改（baseline 若被调用也是绿）
  const jia = fakes({ live: ['d1'], baseline: GREEN, reply: REPLY })
  const yi = fakes({ live: [], baseline: { ok: false, reasons: ['S2 verify 红', '全量测试在基线上红'] }, reply: REPLY })
  const bing = fakes({ live: [], baseline: GREEN, reply: REPLY })

  // When: 甲乙以 replan true、丙以 replan false 调用 resumeFlight(deps, 'demo', …)
  await Promise.all([
    resumeFlight(jia.deps, 'demo', { replan: true }),
    resumeFlight(yi.deps, 'demo', { replan: true }),
    resumeFlight(bing.deps, 'demo', { replan: false }),
  ])

  // Then: 甲依次 stopLive（停 d1）→ baseline → takeoff，takeoff 参数为 ['demo', '授权提交']、resume true，通知含「续飞 attempt 2」；乙调用了 baseline 而没有 takeoff，通知含「基线红，未续飞」与「S2 verify 红」；丙没有 baseline、调用了 takeoff
  expect(jia.calls).toEqual(['stopLive:demo:d1', 'baseline:demo', 'takeoff'])
  expect(jia.takeoffs).toEqual([{ args: ['demo', '授权提交'], opts: { resume: true } }])
  expect(jia.notes.some(n => n.includes('续飞 attempt 2'))).toBe(true)
  expect(yi.calls).toEqual(['stopLive:demo:', 'baseline:demo'])
  expect(yi.notes.some(n => n.includes('基线红，未续飞') && n.includes('S2 verify 红'))).toBe(true)
  expect(bing.calls).toEqual(['stopLive:demo:', 'takeoff'])
})
