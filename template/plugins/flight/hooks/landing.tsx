// 合回与收口（S8 整体替换）：本切片只定接口，不注册任何 hook。
import type { EngineInterface, On } from 'claude-code'
import type { Action, Flight } from './core'

export function registerLanding(on: On): void {}

/** S7 的 drive 把 dispatch(reviewer|fixer) / final / land / halt 交给它；S8 实现，空壳什么都不做 */
export async function runLandingAction($: EngineInterface, f: Flight, action: Action): Promise<void> {}
