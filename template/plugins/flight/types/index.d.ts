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
  /** 读写账本（ledger.py）用的判定器目录：主检出的；主检出没有判定器时同 hooksDir。 */
  ledgerDir: string
  /** 当前 64 位指纹；problem 非空时可能为空串。 */
  fp: string
  /** 非空 = 该项无法批准的原因（如「找不到 plan_fp.py」「账本损坏」），此时不出按钮。 */
  problem: string
  /** approve = 首次（或落地后）批准；takeoff = 已批准、尚未起飞（按下即起飞）；replan = 已停飞且计划改过（批准修订并续飞）；resume = 已停飞且计划未改（续飞）。 */
  mode: 'approve' | 'takeoff' | 'replan' | 'resume'
  /** 非空 = 进行中文字（「起飞中…」「基线运行中（已 N 分钟）」），渲染时只显示文字、不渲染按钮。 */
  busy?: string
}

/** 一次起飞待命（字段与 hooks/armed.ts 的 Arm 一一对应）。 */
export type FlightArmedItem = {
  change: string
  /** 起飞参数原样（含「授权提交」等）。 */
  args: string[]
  /** 来自 /flight resume 或续飞按钮。 */
  resume: boolean
  /** 拒绝分类（armed.ts 的 ArmClass）。 */
  cls: string
  /** 最近一次拒绝的原文。 */
  reason: string
  /** 首次被拒的时刻（毫秒）。 */
  since: number
  /** 已计入预算的自动重试次数。 */
  tries: number
  /** 已提交「交模型」的一轮、尚未结束。 */
  awaitingModel: boolean
  /** 已提交唤醒、尚未重试。 */
  awaitingWake: boolean
  /** 上一次自动重试的结果也是 transient。 */
  transientAgain: boolean
  /** 唤醒或交模型那一轮撞锁被错过，下一次 tick 补发唤醒。 */
  missedTurn: boolean
  /** 交模型那一轮提交前的时刻 T0；缺失时 main-turn 按旧行为推进。 */
  submittedAt?: number
}

/** 会话里的起飞待命：按 change 索引。 */
export type FlightArmed = { items: Record<string, FlightArmedItem> }

export type FlightBand = {
  /** 版本低于下限时为真：批准带不显示、按压不写账本。 */
  isDisabled: boolean
  items: FlightItem[]
}

/** 飞行面板（Pane flight）：每行一条进度摘要；lines 为空时显示「尚无飞行」。 */
export type FlightPanel = {
  change: string
  lines: string[]
}

declare module 'claude-code' {
  interface PluginState {
    flight: {
      band: FlightBand
      panel: FlightPanel
      armed: FlightArmed
      /** 本会话认领的 change 名（写入与人发的命令），只在本进程内有效 */
      claims: string[]
    }
  }
}
