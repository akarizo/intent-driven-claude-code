// 一键续飞（design D7）：批准带按下「批准修订并续飞」/「续飞」后在后台跑。依赖全部经 deps 注入，本模块不碰 $。

export type ResumeDeps = {
  /** 停掉该 change 仍在跑的诊断员，返回被停的 agent id */
  stopLive(change: string): Promise<string[]>
  /** slice-gate.py baseline：ok = 退出 0；reasons 为红因 */
  baseline(change: string): Promise<{ ok: boolean; reasons: string[] }>
  /** 起飞：批准带接线时为预填 /opsx-apply <change> 授权提交（register.tsx） */
  takeoff(args: string[], opts: { resume: true }): Promise<string>
  notify(text: string): Promise<void>
  toast(text: string): void
}

const AUTHORIZE = '授权提交'

const firstLine = (s: string) => s.split('\n')[0] ?? ''

/** 停诊断员 → （replan 时）基线 → takeoff(resume) → 通知回复首行。返回通知出去的文本。 */
export async function resumeFlight(deps: ResumeDeps, change: string, opts: { replan: boolean }): Promise<string> {
  deps.toast('续飞准备中…')
  await deps.stopLive(change)
  if (opts.replan) {
    const bl = await deps.baseline(change)
    if (!bl.ok) {
      const text = `${change}：基线红，未续飞：${firstLine(bl.reasons[0] ?? '')}`
      await deps.notify(text)
      return text
    }
  }
  const text = firstLine(await deps.takeoff([change, AUTHORIZE], { resume: true }))
  await deps.notify(text)
  return text
}
