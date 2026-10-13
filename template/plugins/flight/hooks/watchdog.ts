// 看门狗的模型请求跟踪（design D2）。纯模块：不 import 运行时值，时间由调用方传入。

export const WATCHDOG_MS = 600000

/** 记录每个 agent 当前在途请求的起点；stale 给出起点早于 now - limitMs 的 id。 */
export class StepTracker {
  private readonly starts = new Map<string, number>()

  /** 覆盖同一 id 的旧起点。 */
  start(id: string, at: number): void {
    this.starts.delete(id)
    this.starts.set(id, at)
  }

  end(id: string): void {
    this.starts.delete(id)
  }

  /** 起点 < now - limitMs 的 id，按 start 先后排序。 */
  stale(now: number, limitMs: number = WATCHDOG_MS): string[] {
    return [...this.starts]
      .filter(([, at]) => at < now - limitMs)
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
  }

  forget(id: string): void {
    this.starts.delete(id)
  }
}
