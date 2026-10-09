/** 一个待批准（或无法批准）的 change：批准带显示的就是其中最近修改的一项。 */
export type FlightItem = {
  change: string
  /** change 所在 worktree 的绝对路径（账本写入的 git cwd）。 */
  worktree: string
  /** change 目录的绝对路径（传给 plan_fp.py / ledger.py 的 --change-dir）。 */
  changeDir: string
  /** spec.html 的绝对路径。 */
  specPath: string
  /** spec.html 的修改时间，用于挑最近修改的一项。 */
  mtimeMs: number
  /** plan_fp.py / ledger.py 所在目录；找不到时为空串。 */
  hooksDir: string
  /** 当前 64 位指纹；problem 非空时可能为空串。 */
  fp: string
  /** 非空 = 该项无法批准的原因（如「找不到 plan_fp.py」「账本损坏」），此时不出按钮。 */
  problem: string
}

export type FlightBand = {
  /** 版本低于下限时为真：批准带不显示、按压不写账本。 */
  isDisabled: boolean
  items: FlightItem[]
}

declare module 'claude-code' {
  interface PluginState {
    flight: { band: FlightBand }
  }
}
