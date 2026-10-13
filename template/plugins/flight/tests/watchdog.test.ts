// scenario 来源：spec flight-self-heal#watchdog-flags-stalled-requests。watchdog.ts 是纯模块，直接驱动 StepTracker。
import { expect, test } from 'claude-code/testing'

import { StepTracker, WATCHDOG_MS } from '../hooks/watchdog.ts'

test('watchdog-flags-stalled-requests', async () => {
  // Given: StepTracker：a1 在 t=0 start；a2 在 t=0 start、t=5000 end；a3 在 t=300000 start
  const t = new StepTracker()
  t.start('a1', 0)
  t.start('a2', 0)
  t.end('a2')
  t.start('a3', 300000)

  // When: 分别求 stale(599999)、stale(600001)、stale(900001)
  const got = [599999, 600001, 900001].map(now => t.stale(now))

  // Then: 依次为 []、[a1]、[a1, a3]；WATCHDOG_MS 为 600000
  expect(got).toEqual([[], ['a1'], ['a1', 'a3']])
  expect(WATCHDOG_MS).toBe(600000)
})
