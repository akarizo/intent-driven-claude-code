// ship 工具纯模块（spec flight-ship-tool · design D5）：核对 PR 头、按账本裁决、贴评论、切换 draft / ready、记 ship 事件。
// 只经 Ctx / Io 访问外界；注册与接线在 orchestrator.tsx（$ 不能跨 import）。
import { currentAttempt } from './core'
import type { Ctx, Finding, Flight, RunResult, State } from './core'
import { appendEvent, judge } from './io'

export const SHIP_TOOL = {
  name: 'ship' as const,
  description:
    '落地并以 draft 建好 PR 之后调用：交出 change 名与 PR 号（数字或 PR 的 URL），由插件核对 PR 头、按账本裁决、贴评论并切换 draft / ready。只有主会话可用。',
  inputSchema: { type: 'object', properties: { change: { type: 'string' }, pr: { type: 'string' } }, required: ['change', 'pr'] } as Record<string, unknown>,
}

/** slice-gate.py ship 打印的 JSON（slices/_interfaces.md）。 */
export type ShipJson = {
  ready: boolean
  commit: string
  reasons: string[]
  blocked: { slice: string; kind: string; reason: string }[]
  blocking: Finding[]
  deferred: Finding[]
  fix: { ok: boolean; commit: string } | null
  review: { slice: string; agent: string; commit: string } | null
}

const line = (x: Finding) => `- ${x.file}:${x.line} — ${x.severity} — ${x.summary} — 修法：${x.fix}`
const firstLine = (r: RunResult) => (r.stderr.trim() || r.stdout.trim()).split('\n')[0] ?? ''

/** PR 评论正文（design D5）：标题、commit、draft 时的未满足、全量评审与 CRITICAL/HIGH、未自动修的 MEDIUM/LOW、签名。 */
export function shipComment(j: ShipJson, x: { date: string }): string {
  const verdict = j.ready ? 'ready' : 'draft'
  const out = [`## flight 裁决：${verdict}`, '', `插件按账本裁决，commit \`${j.commit.slice(0, 10)}\`。`, '']
  if (!j.ready) out.push('### 未满足', ...j.reasons.map(r => `- ${r}`), '')
  const who = j.review === null ? '账本没有全量评审记录' : `${j.review.slice}（agent ${j.review.agent}）`
  out.push('### 全量评审', `${who}：CRITICAL/HIGH ${j.blocking.length} 条`, ...j.blocking.map(line), '')
  out.push('### 未自动修的 MEDIUM/LOW', ...(j.deferred.length === 0 ? ['无'] : j.deferred.map(line)), '')
  out.push(`— flight 插件，${x.date}`)
  return out.join('\n') + '\n'
}

type View = { url: string; headRefName: string; headRefOid: string; isDraft: boolean }

function parseView(stdout: string): View | undefined {
  try {
    const v = JSON.parse(stdout) as Partial<View>
    return typeof v.url === 'string' && typeof v.headRefName === 'string' && typeof v.headRefOid === 'string' && typeof v.isDraft === 'boolean' ? (v as View) : undefined
  } catch {
    return undefined
  }
}

function parseShip(stdout: string): ShipJson | undefined {
  try {
    const j = JSON.parse(stdout) as ShipJson
    const review = j.review === null || (typeof j.review === 'object' && typeof j.review.slice === 'string')
    return typeof j.ready === 'boolean' && typeof j.commit === 'string' && Array.isArray(j.reasons) && Array.isArray(j.blocking) && Array.isArray(j.deferred) && review ? j : undefined
  } catch {
    return undefined
  }
}

/** 按 design D5 的 9 步执行；任一步失败即返回 deny，不再执行后续步骤（不贴评论、不切换、不写账本）。 */
export async function shipPr(ctx: Ctx, f: Flight, state: State, pr: string): Promise<{ result: string } | { deny: string }> {
  const deny = (why: string) => ({ deny: `flight：${why}` })
  const attempt = currentAttempt(state)
  if (attempt === 0 || !state.events.some(e => e.ev === 'land' && Number(e.attempt) === attempt)) return deny(`${f.change} 还没落地：先 /opsx-apply ${f.change} 跑到落地`)
  const git = (...args: string[]) => ctx.io.run(['git', '-C', f.changeTree, ...args])
  const sh = (argv: string[]) => ctx.io.run(argv, { cwd: f.changeTree })

  const origin = await git('remote', 'get-url', 'origin')
  if (origin.exitCode !== 0) return deny(`读取 origin 失败：${firstLine(origin)}`)
  const url = origin.stdout.trim()
  if (!url.includes('github.com')) return deny(`只支持 GitHub：PR 保持 draft，由人决定（origin 为 ${url}）`)

  const n = /^\d+$/.test(pr) ? pr : /\/pull\/(\d+)$/.exec(pr)?.[1]
  if (n === undefined) return deny(`PR 号不合法：${pr}（要纯数字或以 /pull/<数字> 结尾的 URL）`)

  const head = await git('rev-parse', 'HEAD')
  if (head.exitCode !== 0) return deny(`读取 change worktree 的 HEAD 失败：${firstLine(head)}`)
  const h = head.stdout.trim()
  const viewed = await sh(['gh', 'pr', 'view', n, '--json', 'number,url,headRefName,headRefOid,isDraft'])
  if (viewed.exitCode !== 0) return deny(`gh pr view ${n} 失败：${firstLine(viewed)}`)
  const view = parseView(viewed.stdout)
  if (view === undefined) return deny(`gh pr view ${n} 的输出无法解析`)
  if (view.headRefName !== f.branch) return deny(`PR #${n} 的头分支是 ${view.headRefName}，期望 ${f.branch}`)
  if (view.headRefOid !== h) return deny(`PR #${n} 的头 commit 是 ${view.headRefOid.slice(0, 10)}，change worktree 的 HEAD 是 ${h.slice(0, 10)}：先推送`)

  const shipped = await judge(ctx.io, f, 'slice-gate', ['ship', '--change-dir', f.changeDir], f.changeTree)
  const j = parseShip(shipped.stdout)
  if (j === undefined) return deny(`ship 输出无法解析：${firstLine(shipped)}`)
  const verdict = j.ready ? 'ready' : 'draft'
  const now = new Date(await ctx.now())

  const commented = await sh(['gh', 'pr', 'comment', n, '--body', shipComment(j, { date: now.toISOString().slice(0, 10) })])
  if (commented.exitCode !== 0) return deny(`贴评论失败：${firstLine(commented)}`)

  const toggle = j.ready && view.isDraft ? [] : !j.ready && !view.isDraft ? ['--undo'] : undefined
  if (toggle !== undefined) {
    const switched = await sh(['gh', 'pr', 'ready', n, ...toggle])
    if (switched.exitCode !== 0) return deny(`切换 PR 状态失败：${firstLine(switched)}`)
  }

  const written = await appendEvent(ctx.io, f, {
    v: 1, ev: 'ship', change: f.change, at: now.toISOString(), by: { plugin: 'flight', session: f.session },
    attempt, pr: view.url, verdict, commit: h,
  })
  if (!written) return deny('账本写入失败')
  // 终端通知（design D5）：缺席或抛错都不改返回值
  try {
    await ctx.notify?.(`${f.change}：PR #${n} 已开出（${view.url}），裁决 ${verdict}，blocking ${j.blocking.length}`)
  } catch {
    // 通知失败不影响 ship
  }

  const moved = toggle === undefined ? 'PR 状态保持不变' : toggle.length === 0 ? 'PR 转 ready' : 'PR 退回 draft'
  const why = j.ready ? '' : `；未满足：${j.reasons.join('；')}`
  return { result: `flight：${f.change} 裁决 ${verdict}，${moved}，已贴评论（${view.url}）${why}` }
}
