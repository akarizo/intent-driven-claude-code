import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FlightBand, FlightItem } from '../types'
import { reduce } from './core'
import type { Flight, Io } from './core'
import { readLedger, stoppedNow } from './io'
import { classifyDirty } from './land'
import { withLease } from './lease'
import type { Lease } from './lease'
import { registerOrchestrator, restoreStatusNow, scenarioFiles, takeoffNow } from './orchestrator'
import { resumeFlight } from './resume'
import type { ResumeDeps } from './resume'

// flight 控制面：批准带（AbovePrompt）+ 按压时进程内写账本 + Bash 守卫。
// 指纹与账本读取只经 plan_fp.py / ledger.py 的 CLI；本模块不注册任何工具或命令（无模型可调批准入口）。

type Engine = EngineInterface

const VERSION_FLOOR = '2.1.295'
const CHANGE_ROOTS = ['openspec/changes', 'template/openspec/changes']
const HOOK_DIRS = ['.claude/hooks', 'template/.claude/hooks']
// 账本 ref 与 slice-gate 的门禁结论 ref（refs/flight/<change>/gate-<S>）都不许模型直写
const LEDGER_REF = /refs\/flight\/[^\s'"]+\/(ledger|gate-[^\s'"\/]+)/
// 账本 ref 在非 packed 状态下就是 <git-common-dir>/refs/flight/<change>/ledger 这个普通文件
const LEDGER_FILE = /refs\/flight\/|(^|[\\/])packed-refs$/
const GUARD_DENY =
  'flight：refs/flight/<change>/ledger 账本只能由 flight 控制面（人按下「批准起飞」）写入；读取请用 python3 .claude/hooks/ledger.py show --change-dir <change 目录>'
// 能落到账本 ref 的工具：跑 shell 命令的看命令文本，写文件的看目标路径
const GUARDED_TOOLS = ['Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit'] as const
const MAX_UPDATE_REF = 3
const ZERO = '0'.repeat(40)

// 初值停用：版本未确认（读版本抛错、hook 被跳过）时批准带与写入不启用
const band = atom({ plugin: 'flight', key: 'band' } as const, { isDisabled: true, items: [] } as FlightBand)

/** 按数字逐段比较：a < b。 */
function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0)
  const pb = b.split('.').map(s => parseInt(s, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

/** 反斜杠转正斜杠，并把 // 与 /./ 折叠为 /，避免等价路径绕过 LEDGER_FILE。 */
function normalizePath(path: unknown): string {
  let p = String(path).replace(/\\/g, '/')
  for (let prev = ''; prev !== p; ) {
    prev = p
    p = p.replace(/\/\.?\//g, '/')
  }
  return p
}

function touchesLedger(e: { readonly command?: unknown; readonly file_path?: unknown; readonly notebook_path?: unknown }) {
  return LEDGER_REF.test(String(e.command ?? '')) || LEDGER_FILE.test(normalizePath(e.file_path ?? e.notebook_path ?? ''))
}

type Tree = { path: string; branch: string }

function parseWorktrees(porcelain: string): Tree[] {
  return porcelain
    .split(/\n\s*\n/)
    .map(block => {
      const path = /^worktree (.+)$/m.exec(block)?.[1] ?? ''
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? ''
      return { path, branch }
    })
    .filter(t => t.path !== '')
}

// 按钮的地址带着绘制时显示的模式、change 与指纹：按下时以人看到的那一项为准
const PRESS_KEY = /^(approve|takeoff|replan|resume):(.+):([0-9a-f]{64})$/
const pressKey = (item: FlightItem) => `${item.mode}:${item.change}:${item.fp}`
const LABEL: Record<FlightItem['mode'], string> = { approve: '批准起飞', takeoff: '起飞', replan: '批准修订并续飞', resume: '续飞' }
const AUTHORIZE = '授权提交'
const BASELINE_TIMEOUT_MS = 600000
const LIVE = ['pending', 'running', 'waiting']
const firstLine = (s: string) => s.split('\n')[0] ?? ''

function newest(items: readonly FlightItem[]): FlightItem | undefined {
  return items.reduce<FlightItem | undefined>((a, x) => (a === undefined || x.mtimeMs > a.mtimeMs ? x : a), undefined)
}

/** 批准带显示的那一项：可批准项里 spec.html 最近修改的；没有可批准项才在全部项里取。 */
function topItem(items: readonly FlightItem[]): FlightItem | undefined {
  return newest(items.filter(x => x.problem === '')) ?? newest(items)
}

type Candidate = { change: string; tree: Tree; changeDir: string; specPath: string }

async function candidatesIn($: Engine, tree: Tree): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const root of CHANGE_ROOTS) {
    const base = `${tree.path}/${root}`
    if (!(await $.fs.exists(base))) continue
    for (const entry of await $.fs.list(base)) {
      if (entry.kind !== 'dir' || entry.name === 'archive') continue
      const changeDir = `${base}/${entry.name}`
      const specPath = `${changeDir}/spec.html`
      const tasksPath = `${changeDir}/tasks.md`
      if (!(await $.fs.exists(specPath)) || !(await $.fs.exists(tasksPath))) continue
      const tasks = await $.fs.read(tasksPath)
      if (typeof tasks !== 'string' || !tasks.includes('- [ ]')) continue
      out.push({ change: entry.name, tree, changeDir, specPath })
    }
  }
  return out
}

/** 同名去重：分支 worktree-<name> 的 worktree 优先，其次主 worktree，否则丢弃。 */
function dedupe(all: Candidate[], main: Tree): Candidate[] {
  const byName = new Map<string, Candidate[]>()
  for (const c of all) byName.set(c.change, [...(byName.get(c.change) ?? []), c])
  const out: Candidate[] = []
  for (const [name, list] of byName) {
    const own = list.find(c => c.tree.branch === `worktree-${name}`)
    const chosen = own ?? list.find(c => c.tree.path === main.path)
    if (chosen !== undefined) out.push(chosen)
  }
  return out
}

async function hooksDirOf($: Engine, tree: Tree): Promise<string> {
  for (const dir of HOOK_DIRS) {
    const hooks = `${tree.path}/${dir}`
    if (await $.fs.exists(`${hooks}/plan_fp.py`)) return hooks
  }
  return ''
}

/** 当前指纹：exit 0 → 指纹；exit 2 → undefined（无计划）；其他 → problem。 */
async function fingerprint($: Engine, hooksDir: string, changeDir: string, cwd: string) {
  const r = await $.process.run(['python3', `${hooksDir}/plan_fp.py`, '--change-dir', changeDir], { cwd })
  if (r.exitCode === 2) return undefined
  if (r.exitCode !== 0) return { fp: '', problem: '指纹计算失败' }
  return { fp: r.stdout.trim(), problem: '' }
}

/** 本模块经 io.ts 读账本用的 Io。 */
function ioOf($: Engine): Io {
  return {
    async run(argv, opts = {}) {
      const r = await $.process.run([...argv], opts)
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
    async read(path) {
      if (!(await $.fs.exists(path))) return undefined
      const text = await $.fs.read(path)
      return typeof text === 'string' ? text : undefined
    },
    write: (path, text) => $.fs.write(path, text),
    exists: path => $.fs.exists(path),
  }
}

/** io.ts 读账本只用到 change、changeTree、changeDir（相对 changeTree）与 hooksDir。 */
function flightOf(x: { change: string; worktree: string; changeDir: string; hooksDir: string }): Flight {
  const changeDir = x.changeDir.startsWith(`${x.worktree}/`) ? x.changeDir.slice(x.worktree.length + 1) : x.changeDir
  return { change: x.change, mainTree: '', changeTree: x.worktree, changeDir, branch: '', hooksDir: x.hooksDir, model: '', session: '' }
}

/** 最新 attempt 最后一条 halt 的 kind；读不出账本或没有 kind 为空串。 */
async function lastHaltKind($: Engine, f: Flight): Promise<string> {
  const ledger = await readLedger(ioOf($), f).catch(() => ({ error: '' }))
  if ('error' in ledger) return ''
  const attempt = ledger.events.filter(e => e.ev === 'takeoff').pop()?.attempt
  return String(ledger.events.filter(e => e.ev === 'halt' && e.attempt === attempt).pop()?.kind ?? '')
}

/** 起飞时会被「授权提交」提交的本 change 工件数（classifyDirty 口径）；git status 失败按 0。 */
async function artifactCount($: Engine, c: Candidate, f: Flight): Promise<number> {
  try {
    const st = await $.process.run(['git', '-C', c.tree.path, 'status', '--porcelain', '--untracked-files=all'])
    if (st.exitCode !== 0) return 0
    // porcelain 的 XY 列可能以空格开头，不能先 trim
    const paths = st.stdout.split('\n').filter(l => l.length > 3).map(l => l.slice(3))
    return classifyDirty(paths, { changeDir: f.changeDir, scenarioFiles: await scenarioFiles(ioOf($), `${c.changeDir}/slices.json`) }).artifacts.length
  } catch {
    return 0
  }
}

/** change → 批准带「批准起飞」「起飞」说明行里的未提交工件数；每次刷新重算。 */
const artifacts: Map<string, number> = new Map()

type InFlight = { phase: 'takeoff' | 'baseline'; since: number; item: FlightItem }
/** 进行中表（design D6）：按下起飞 / 续飞时登记（item = 按下的那一项），起飞回复返回后删除；有记录的项只显示进行中文字。 */
const inFlight: Map<string, InFlight> = new Map()
const MINUTE_MS = 60000
const minutesOf = (ms: number) => Math.floor(ms / MINUTE_MS)
const busyText = (p: InFlight, now: number) => (p.phase === 'takeoff' ? '起飞中…' : `基线运行中（已 ${minutesOf(now - p.since)} 分钟）`)

/** 显示规则（spec flight-band-takeoff 的表，自上而下取第一条命中）。 */
async function evaluate($: Engine, c: Candidate): Promise<FlightItem | undefined> {
  const { mtimeMs } = await $.fs.stat(c.specPath)
  const base = { change: c.change, worktree: c.tree.path, changeDir: c.changeDir, specPath: c.specPath, mtimeMs, mode: 'approve' as const }
  const hooksDir = await hooksDirOf($, c.tree)
  if (hooksDir === '') return { ...base, hooksDir, fp: '', problem: '找不到 plan_fp.py' }
  const now = await fingerprint($, hooksDir, c.changeDir, c.tree.path)
  if (now === undefined) return undefined
  if (now.problem !== '') return { ...base, hooksDir, ...now }
  const r = await $.process.run(['python3', `${hooksDir}/ledger.py`, 'approved', '--change-dir', c.changeDir], {
    cwd: c.tree.path,
  })
  if (r.exitCode === 4) return { ...base, hooksDir, fp: now.fp, problem: '账本损坏' }
  if (r.exitCode !== 0) return { ...base, hooksDir, fp: now.fp, problem: '账本读取失败' }
  const same = r.stdout.trim() === now.fp
  const f = flightOf({ ...base, hooksDir })
  // 最新 attempt 以 halt 结束（同 attempt 无 land）且不是人工 abort 才给续飞；读不出账本按未停飞处理
  const halted = (await stoppedNow(ioOf($), f)) === 'halt' && (await lastHaltKind($, f)) !== 'abort'
  if (halted) return { ...base, hooksDir, fp: now.fp, problem: '', mode: same ? 'resume' : 'replan' }
  const item: FlightItem = { ...base, hooksDir, fp: now.fp, problem: '' }
  // 已批准、尚未起飞 → 起飞；已批准且起飞过（在飞 / 已落地 / abort）→ 不显示
  if (same) {
    if (!(await isAlreadyApproved($, item))) return undefined
    item.mode = 'takeoff'
  }
  artifacts.set(c.change, await artifactCount($, c, f))
  return item
}

async function refresh($: Engine): Promise<void> {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'])
  const trees = r.exitCode === 0 ? parseWorktrees(r.stdout) : []
  const main = trees[0]
  const items: FlightItem[] = []
  if (main !== undefined) {
    const all: Candidate[] = []
    for (const tree of trees) all.push(...(await candidatesIn($, tree)))
    for (const c of dedupe(all, main)) {
      const item = await evaluate($, c)
      if (item !== undefined) items.push(item)
    }
  }
  // 进行中的项即使按规则本该不显示也要显示：取登记时按下的那一项
  const now = await $.clock.now()
  for (const [change, p] of inFlight) {
    const i = items.findIndex(x => x.change === change)
    if (i >= 0) items[i] = { ...items[i]!, busy: busyText(p, now) }
    else items.push({ ...p.item, busy: busyText(p, now) })
  }
  await update($, band, b => ({ ...b, items }))
}

// 账本追加经模块内单一 Promise 队列串行。
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

/** 最近一次 takeoff 之后最后一条 approve 的指纹即 fp → true；读失败按「不去重」返回 false。 */
async function isAlreadyApproved($: Engine, item: FlightItem): Promise<boolean> {
  try {
    const r = await $.process.run(['python3', `${item.hooksDir}/ledger.py`, 'show', '--change-dir', item.changeDir], {
      cwd: item.worktree,
    })
    if (r.exitCode !== 0) return false
    let last = ''
    for (const line of r.stdout.split('\n')) {
      if (line.trim() === '') continue
      const ev = JSON.parse(line) as { ev?: string; fp?: string }
      if (ev.ev === 'takeoff') last = ''
      else if (ev.ev === 'approve') last = String(ev.fp)
    }
    return last === item.fp
  } catch {
    return false
  }
}

/** 追加一条 approve 事件到 refs/flight/<change>/ledger；成功返回 true。 */
async function appendApprove($: Engine, item: FlightItem, surface: string): Promise<boolean> {
  const git = (args: string[], stdin?: string) =>
    $.process.run(['git', ...args], stdin === undefined ? { cwd: item.worktree } : { cwd: item.worktree, stdin })
  const event = {
    v: 1,
    ev: 'approve',
    change: item.change,
    fp: item.fp,
    at: new Date(await $.clock.now()).toISOString(),
    by: { plugin: 'flight', surface, session: await $.session.id() },
  }
  const blob = await git(['hash-object', '-w', '--stdin'], JSON.stringify(event))
  if (blob.exitCode !== 0) return false
  const tree = await git(['mktree'], `100644 blob ${blob.stdout.trim()}\tevent.json\n`)
  if (tree.exitCode !== 0) return false
  const ref = `refs/flight/${item.change}/ledger`
  for (let attempt = 0; attempt < MAX_UPDATE_REF; attempt++) {
    const head = await git(['rev-parse', '-q', '--verify', ref])
    const parent = head.exitCode === 0 ? head.stdout.trim() : ''
    const commit = await git([
      'commit-tree',
      tree.stdout.trim(),
      ...(parent === '' ? [] : ['-p', parent]),
      '-m',
      `flight: approve ${item.change} ${item.fp.slice(0, 8)}`,
    ])
    if (commit.exitCode !== 0) return false
    const moved = await git(['update-ref', ref, commit.stdout.trim(), parent === '' ? ZERO : parent])
    if (moved.exitCode === 0) return true
  }
  return false
}

/** 通知失败（未发出或抛错）一律吞掉：续飞本身不因通知失败而中断。 */
async function notifyQuietly($: Engine, text: string): Promise<void> {
  try {
    await $.ui.notify(text, { title: 'flight' })
  } catch {
    /* 通知失败不影响续飞 */
  }
}

/** toast 失败（同步抛错或异步拒绝）一律吞掉，同 notifyQuietly。 */
function toastQuietly($: Engine, text: string): void {
  try {
    void Promise.resolve($.ui.toast(text)).catch(() => undefined)
  } catch {
    /* 提示失败不影响起飞 */
  }
}

/** resumeFlight 的依赖：都作用于批准带上的这一项；起飞带上这次按键的派发凭证。 */
function depsOf($: Engine, item: FlightItem, lease: Lease): ResumeDeps {
  const f = flightOf(item)
  return {
    // $ 不出文件：经 orchestrator 交出的起飞闭包直接起飞
    takeoff: (args, opts) => takeoffNow(args, { ...opts, lease }),
    async baseline() {
      const r = await $.process.run(['python3', `${item.hooksDir}/slice-gate.py`, 'baseline', '--change-dir', item.changeDir], {
        cwd: item.worktree,
        timeoutMs: BASELINE_TIMEOUT_MS,
      }).finally(() => leaveBaseline($, item.change))
      if (r.exitCode === 0) return { ok: true, reasons: [] }
      let reasons: string[] = []
      try {
        reasons = ((JSON.parse(r.stdout) as { reasons?: unknown[] }).reasons ?? []).map(String)
      } catch {
        /* 非 JSON（如 die 的 stderr）：下面取原文 */
      }
      return { ok: false, reasons: reasons.length > 0 ? reasons : [firstLine((r.stderr || r.stdout).trim()) || `exit ${r.exitCode}`] }
    },
    // 本 attempt 派出、未结束、引擎里仍在跑的诊断员逐个 TaskStop；读不出账本就不停
    async stopLive() {
      const ledger = await readLedger(ioOf($), f).catch(() => ({ error: '' }))
      if ('error' in ledger) return []
      const state = reduce(ledger.events)
      const ended = new Set(state.events.filter(e => e.ev === 'ended').map(e => String(e.agent)))
      const diag = state.events
        .filter(e => e.ev === 'dispatch' && e.role === 'diagnostician' && Number(e.attempt) === state.attempt)
        .map(e => String(e.agent))
        .filter(id => !ended.has(id))
      if (diag.length === 0) return []
      const running = new Set((await $.agent.list()).filter(x => LIVE.includes(String(x.status))).map(x => x.id))
      const stopped: string[] = []
      for (const id of diag.filter(id => running.has(id))) {
        try {
          // 对已结束的 agent 引擎不抛错，而是回 isError（同 orchestrator 的 taskStop）
          const r = (await $.tool.call({ tool: 'TaskStop', task_id: id } as never)) as { isError?: boolean } | undefined
          if (!r?.isError) stopped.push(id)
        } catch {
          /* 停不掉照样续飞：诊断员只读 */
        }
      }
      return stopped
    },
    notify: text => notifyQuietly($, text),
    toast: text => toastQuietly($, text),
  }
}

/** 状态行写入失败一律吞掉，同 notifyQuietly。 */
async function statusQuietly($: Engine, text: string): Promise<void> {
  try {
    await $.ui.status(text)
  } catch {
    /* 状态行失败不影响续飞 */
  }
}

/** 批准带重绘失败吞掉：按键路径与后台回调都用它，重绘失败不打断起飞、不留下进行中记录。 */
async function refreshQuietly($: Engine): Promise<void> {
  await refresh($).catch(() => undefined)
}

/** 起飞回复返回（含异常）：删进行中记录并重绘。 */
async function finished($: Engine, change: string): Promise<void> {
  inFlight.delete(change)
  await refreshQuietly($)
}

/** slices.json 的 gate.full_suite_sec 换算成分钟（四舍五入，至少 1）；读不出为 undefined。 */
async function fullSuiteMinutes($: Engine, changeDir: string): Promise<number | undefined> {
  try {
    const slices = JSON.parse((await ioOf($).read(`${changeDir}/slices.json`)) ?? '') as { gate?: { full_suite_sec?: unknown } }
    const sec = Number(slices.gate?.full_suite_sec)
    return Number.isFinite(sec) && sec > 0 ? Math.max(1, Math.round(sec / 60)) : undefined
  } catch {
    return undefined
  }
}

/** 基线进度：仍在这一次基线相位就写状态行、重绘批准带，60 秒后再来；相位离开 baseline 即停。 */
async function baselineTick($: Engine, change: string, since: number, full: number | undefined): Promise<void> {
  const p = inFlight.get(change)
  if (p?.phase !== 'baseline' || p.since !== since) return
  const n = minutesOf((await $.clock.now()) - since)
  await statusQuietly($, `flight · 续飞准备中 ${change} · 基线已跑 ${n} 分钟${full === undefined ? '' : `（上次全量约 ${full} 分钟）`}`)
  await refreshQuietly($)
  await $.clock.after(MINUTE_MS, () => void baselineTick($, change, since, full).catch(() => undefined))
}

/** 基线结束（含异常）：相位改为 takeoff 并重绘。 */
async function leaveBaseline($: Engine, change: string): Promise<void> {
  const p = inFlight.get(change)
  if (p?.phase !== 'baseline') return
  inFlight.set(change, { ...p, phase: 'takeoff', since: await $.clock.now() })
  await refreshQuietly($)
}

/** 按键处理之内起飞（design D3：不转到定时器回调，派出的执行体才经过包络）：登记进行中，带凭证以 [change, 授权提交] 起飞，回复首行经 toast 与通知告诉人。 */
async function startTakeoff($: Engine, item: FlightItem, lease: Lease): Promise<void> {
  const change = item.change
  inFlight.set(change, { phase: 'takeoff', since: await $.clock.now(), item })
  try {
    await refreshQuietly($)
    const text = await takeoffNow([change, AUTHORIZE], { lease })
    toastQuietly($, firstLine(text))
    await notifyQuietly($, firstLine(text))
  } catch (err) {
    await notifyQuietly($, `flight：${change} 起飞失败：${firstLine(err instanceof Error ? err.message : String(err))}`)
  } finally {
    await finished($, change)
  }
}

/** 按键处理之内续飞：登记进行中（replan 先进基线相位并显示进度）；续飞抛错时通知原因；结束后恢复状态行。 */
async function startResume($: Engine, item: FlightItem, replan: boolean, lease: Lease): Promise<void> {
  const change = item.change
  const since = await $.clock.now()
  inFlight.set(change, { phase: replan ? 'baseline' : 'takeoff', since, item })
  try {
    if (replan) await baselineTick($, change, since, await fullSuiteMinutes($, item.changeDir))
    else await refreshQuietly($)
    await resumeFlight(depsOf($, item, lease), change, { replan })
  } catch (err) {
    await notifyQuietly($, `flight：${change} 续飞失败：${firstLine(err instanceof Error ? err.message : String(err))}`)
  } finally {
    await finished($, change)
    await restoreStatusNow().catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 热重载后 $.state 保留上次的值：每次启动先停用，确认版本后才启用
    await update($, band, () => ({ isDisabled: true, items: [] }))
    let version: string
    try {
      version = (await $.session.version()).version
    } catch {
      $.ui.toast('flight：无法确认 Claude Code 版本，批准带已停用')
      return next(e)
    }
    if (isOlder(version, VERSION_FLOOR)) {
      $.ui.toast(`flight：Claude Code ${version} 低于 ${VERSION_FLOOR}，批准带与账本写入已停用`)
    } else {
      await update($, band, b => ({ ...b, isDisabled: false }))
      await refresh($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && !(await read($, band)).isDisabled) await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, band)
    const top = topItem(b.items)
    if (e.props.hasSurvey || b.isDisabled || top === undefined) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const pending = b.items.filter(x => x.problem === '' && x !== top).length
    const blocked = b.items.filter(x => x.problem !== '' && x !== top).length
    const idle = top.problem === '' && !top.busy
    return (
      <Box flexDirection="column">
        <Text>
          待批准飞行计划：{top.change}
          {top.fp === '' ? '' : `  指纹 ${top.fp.slice(0, 8)}`}
        </Text>
        <Text dimColor>{top.specPath}</Text>
        {top.busy ? (
          // 进行中：Button 没有禁用属性，不渲染按钮，只显示文字
          <Text>{top.busy}</Text>
        ) : top.problem === '' ? (
          // 引擎要求 Button 带 onPress；真正的处理在下方 ui.press hook（拿得到 e.surface，且不调 next，此闭包不会执行）
          <Button key={pressKey(top)} label={LABEL[top.mode]} variant="primary" onPress={() => undefined} />
        ) : (
          <Text color="red">{top.problem}，无法批准</Text>
        )}
        {idle && top.mode === 'replan' && (
          <Text dimColor>按下会提交本 change 的工件、重跑基线，续飞只重派未合回的切片</Text>
        )}
        {idle && (top.mode === 'approve' || top.mode === 'takeoff') && (
          <Text dimColor>
            {(artifacts.get(top.change) ?? 0) > 0 ? `按下会提交本 change 的 ${artifacts.get(top.change)} 个工件并直接起飞` : '按下直接起飞'}
          </Text>
        )}
        {pending > 0 && <Text dimColor>另有 {pending} 个待批准</Text>}
        {blocked > 0 && <Text dimColor>另有 {blocked} 个无法批准</Text>}
      </Box>
    )
  })

  // 按键处理整体包在 withLease 里：起飞 / 续飞在按键返回之前完成，凭证随起飞一路传下（design D3、D4）
  on('ui.press', { plugin: 'flight', element: /^(approve|takeoff|replan|resume):/ }, async ($, e) => withLease(async lease => {
    const shown = PRESS_KEY.exec(e.element)
    const b = await read($, band)
    if (shown === null || b.isDisabled) return { element: e.element }
    const [, mode, change, fp] = shown
    // 按键并发处理：同一 change 的起飞 / 续飞未结束时再按，直接拒绝（在指纹核对与写 approve 之前）
    if (inFlight.has(change!)) {
      toastQuietly($, `flight：${change} 正在起飞，稍候`)
      return { element: e.element }
    }
    const item = b.items.find(x => x.change === change)
    if (item === undefined || item.problem !== '' || item.mode !== mode) {
      $.ui.toast(`flight：${change} 已不在可批准列表，请看批准带当前显示的项`)
      await refreshQuietly($)
      return { element: e.element }
    }
    const now = await fingerprint($, item.hooksDir, item.changeDir, item.worktree)
    if (now === undefined || now.fp !== fp) {
      $.ui.toast(`flight：${change} 的计划已变化，请重新审阅 spec.html 后再批准`)
      await refreshQuietly($)
      return { element: e.element }
    }
    // 计划未改的续飞：不写 approve（沿用已批准的指纹）
    if (mode === 'resume') {
      await startResume($, item, false, lease)
      return { element: e.element }
    }
    // 已批准、尚未起飞：不写 approve，直接起飞
    if (mode === 'takeoff') {
      await startTakeoff($, item, lease)
      return { element: e.element }
    }
    // 去重判定与追加在同一串行段：连按时后一次能读到前一次刚写入的 approve
    const outcome = await serial(async () =>
      (await isAlreadyApproved($, { ...item, fp })) ? 'duplicate' : (await appendApprove($, { ...item, fp }, e.surface)) ? 'appended' : 'failed',
    )
    if (outcome === 'duplicate') {
      $.ui.toast(`flight：${change} 已批准（指纹相同），直接起飞`)
      await refreshQuietly($)
      // 指纹相同的已批准项按「起飞」处理
      if (mode === 'approve') await startTakeoff($, { ...item, fp }, lease)
      return { element: e.element }
    }
    if (outcome === 'failed') {
      $.ui.toast(`flight：${change} 账本写入失败（重试 ${MAX_UPDATE_REF} 次），未批准`)
      return { element: e.element }
    }
    await refreshQuietly($)
    // 批准修订并续飞：续飞；批准起飞：起飞
    if (mode === 'replan') await startResume($, { ...item, fp }, true, lease)
    else await startTakeoff($, { ...item, fp }, lease)
    return { element: e.element }
  }))

  on('tool.call', { tool: GUARDED_TOOLS }, ($, e, next) => (touchesLedger(e) ? { deny: GUARD_DENY } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : touchesLedger(e) ? { deny: GUARD_DENY } : next(e)),
  )
  registerOrchestrator(on)
}
