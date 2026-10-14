// scenario 来源：spec flight-dispatch-lease#dispatch-refused-after-hook-returns / dispatch-allowed-in-live-hook。lease.ts 是纯模块，直接调用。
import { expect, test } from 'claude-code/testing'

import { LEASE_DENY, guardedSpawn, withLease } from '../hooks/lease'
import type { Lease } from '../hooks/lease'

test('dispatch-refused-after-hook-returns', async () => {
  // Given: 在 withLease 的 body 里取得凭证并保存，body 已返回；另有一次请求不带凭证；派发函数记录调用次数
  let saved: Lease | undefined
  await withLease(async lease => {
    saved = lease
  })
  let calls = 0
  const spawn = async () => {
    calls++
    return 'spawned'
  }

  // When: 分别用失效凭证与「没有凭证」请求派发（guardedSpawn）
  const got = await Promise.all([guardedSpawn(saved, spawn), guardedSpawn(undefined, spawn)])

  // Then: 两次都得到含「派发须在处理外部事件的 hook 里」的拒绝；派发函数一次都没被调用
  expect(got).toEqual([{ deny: LEASE_DENY }, { deny: LEASE_DENY }])
  expect(LEASE_DENY).toContain('派发须在处理外部事件的 hook 里')
  expect(calls).toBe(0)
})

test('dispatch-allowed-in-live-hook', async () => {
  // Given: withLease 的 body 正在执行；派发函数返回 { agentId: 'a1' } 并记录调用次数
  let calls = 0
  const result = { agentId: 'a1' }
  const spawn = async () => {
    calls++
    return result
  }

  // When: body 里用它的凭证请求派发
  const got = await withLease(lease => guardedSpawn(lease, spawn))

  // Then: 派发函数被调用恰一次，并原样返回它的结果
  expect(calls).toBe(1)
  expect(got).toBe(result)
})
