/**
 * 派发凭证（design D4）。纯模块：不 import 运行时值，不含 `$`。
 *
 * 规则：插件只在「处理外部事件、尚未返回的 hook」的 await 链里派发 agent，派出的 agent 的工具调用才经过
 * 插件的 tool.call / tool.check hook（包络与 measure）。定时器回调、已返回 hook 的后续里派发会悄悄绕过它们。
 * 所以凭证只在这类 hook 里经 withLease 取得，hook 返回（或抛错）即失效；定时器回调拿不到活凭证。
 */

/** 活帧凭证：只在处理外部事件的 hook 里经 withLease 取得；hook 返回（或抛错）即失效（design D4） */
export type Lease = { readonly alive: boolean }

export const LEASE_DENY = 'flight：派发须在处理外部事件的 hook 里（定时器或已返回的回调不能派发）'

/** 造一张活凭证交给 body；body 结束（含抛错）时凭证失效，body 的结果或异常原样交回。 */
export async function withLease<T>(body: (lease: Lease) => Promise<T>): Promise<T> {
  const lease = { alive: true }
  try {
    return await body(lease)
  } finally {
    lease.alive = false
  }
}

/** 缺失或已失效 → LEASE_DENY；活凭证 → undefined。 */
export function leaseDeny(lease: Lease | undefined): string | undefined {
  return lease?.alive ? undefined : LEASE_DENY
}

/** 派发闸：凭证缺失或已失效 → { deny }，不调用 spawn；活凭证 → spawn 的结果原样交回。 */
export async function guardedSpawn<T>(lease: Lease | undefined, spawn: () => Promise<T>): Promise<T | { deny: string }> {
  const deny = leaseDeny(lease)
  if (deny !== undefined) return { deny }
  return spawn()
}
