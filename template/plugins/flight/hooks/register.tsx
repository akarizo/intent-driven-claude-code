import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FlightBand, FlightItem } from '../types'

// flight 控制面：批准带（AbovePrompt）+ 按压时进程内写账本 + Bash 守卫。
// 指纹与账本读取只经 plan_fp.py / ledger.py 的 CLI；本模块不注册任何工具或命令（无模型可调批准入口）。

type Engine = EngineInterface

const VERSION_FLOOR = '2.1.295'
const CHANGE_ROOTS = ['openspec/changes', 'template/openspec/changes']
const HOOK_DIRS = ['.claude/hooks', 'template/.claude/hooks']
const LEDGER_REF = /refs\/flight\/[^\s'"]+\/ledger/
// 账本 ref 在非 packed 状态下就是 <git-common-dir>/refs/flight/<change>/ledger 这个普通文件
const LEDGER_FILE = /refs\/flight\/|(^|[\\/])packed-refs$/
const GUARD_DENY =
  'flight：refs/flight/<change>/ledger 账本只能由 flight 控制面（人按下「批准起飞」）写入；读取请用 python3 .claude/hooks/ledger.py show --change-dir <change 目录>'
// 能落到账本 ref 的工具：跑 shell 命令的看命令文本，写文件的看目标路径
const GUARDED_TOOLS = ['Bash', 'Monitor', 'Write', 'Edit', 'NotebookEdit'] as const
const MAX_UPDATE_REF = 3
const ZERO = '0'.repeat(40)

const band = atom({ plugin: 'flight', key: 'band' } as const, { isDisabled: false, items: [] } as FlightBand)

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

function touchesLedger(e: { readonly command?: unknown; readonly file_path?: unknown; readonly notebook_path?: unknown }) {
  return LEDGER_REF.test(String(e.command ?? '')) || LEDGER_FILE.test(String(e.file_path ?? e.notebook_path ?? ''))
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

// 批准按钮的地址带着绘制时显示的 change 与指纹：按下时以人看到的那一项为准
const APPROVE_KEY = /^approve:(.+):([0-9a-f]{64})$/
const approveKey = (item: FlightItem) => `approve:${item.change}:${item.fp}`

/** 批准带显示的那一项：spec.html 最近修改的。 */
function topItem(items: readonly FlightItem[]): FlightItem | undefined {
  return items.reduce<FlightItem | undefined>((a, x) => (a === undefined || x.mtimeMs > a.mtimeMs ? x : a), undefined)
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

async function evaluate($: Engine, c: Candidate): Promise<FlightItem | undefined> {
  const { mtimeMs } = await $.fs.stat(c.specPath)
  const base = { change: c.change, worktree: c.tree.path, changeDir: c.changeDir, specPath: c.specPath, mtimeMs }
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
  if (r.stdout.trim() === now.fp) return undefined
  return { ...base, hooksDir, fp: now.fp, problem: '' }
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
  await update($, band, b => ({ ...b, items }))
}

// 账本追加经模块内单一 Promise 队列串行。
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { version } = await $.session.version()
    if (isOlder(version, VERSION_FLOOR)) {
      await update($, band, () => ({ isDisabled: true, items: [] }))
      $.ui.toast(`flight：Claude Code ${version} 低于 ${VERSION_FLOOR}，批准带与账本写入已停用`)
    } else {
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
    const others = b.items.length - 1
    return (
      <Box flexDirection="column">
        <Text>
          待批准飞行计划：{top.change}
          {top.fp === '' ? '' : `  指纹 ${top.fp.slice(0, 8)}`}
        </Text>
        <Text dimColor>{top.specPath}</Text>
        {top.problem === '' ? (
          // 引擎要求 Button 带 onPress；真正的处理在下方 ui.press hook（拿得到 e.surface，且不调 next，此闭包不会执行）
          <Button key={approveKey(top)} label="批准起飞" variant="primary" onPress={() => undefined} />
        ) : (
          <Text color="red">{top.problem}，无法批准</Text>
        )}
        {others > 0 && <Text dimColor>另有 {others} 个待批准</Text>}
      </Box>
    )
  })

  on('ui.press', { plugin: 'flight', element: /^approve:/ }, async ($, e) => {
    const shown = APPROVE_KEY.exec(e.element)
    const b = await read($, band)
    if (shown === null || b.isDisabled) return { element: e.element }
    const [, change, fp] = shown
    const item = b.items.find(x => x.change === change)
    if (item === undefined || item.problem !== '') {
      $.ui.toast(`flight：${change} 已不在可批准列表，请看批准带当前显示的项`)
      await refresh($)
      return { element: e.element }
    }
    const now = await fingerprint($, item.hooksDir, item.changeDir, item.worktree)
    if (now === undefined || now.fp !== fp) {
      $.ui.toast(`flight：${change} 的计划已变化，请重新审阅 spec.html 后再批准`)
      await refresh($)
      return { element: e.element }
    }
    const isAppended = await serial(() => appendApprove($, { ...item, fp }, e.surface))
    if (!isAppended) {
      $.ui.toast(`flight：${change} 账本写入失败（重试 ${MAX_UPDATE_REF} 次），未批准`)
      return { element: e.element }
    }
    await refresh($)
    const filled = await $.prompt.fill({ text: `/opsx-apply ${change}` })
    if (!filled.isFilled) $.ui.toast(`flight：已批准 ${change}，请手动输入 /opsx-apply ${change}`)
    return { element: e.element }
  })

  on('tool.call', { tool: GUARDED_TOOLS }, ($, e, next) => (touchesLedger(e) ? { deny: GUARD_DENY } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : touchesLedger(e) ? { deny: GUARD_DENY } : next(e)),
  )
}
