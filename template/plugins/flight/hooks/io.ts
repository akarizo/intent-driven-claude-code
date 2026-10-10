// 飞行副作用层：判定器调用、账本读写、切片 worktree、按 agent 找飞行（spec flight-io · design D5）。$ 不能跨 import，适配与派发在 orchestrator.tsx。
// 判定器一律取主 worktree 的副本；命令的工作目录是被判定的那个 worktree。
import type { Flight, FlightEvent, Io, Role, RunResult } from './core'
import type { ActiveTree } from './envelope'

const HOOK_DIRS = ['.claude/hooks', 'template/.claude/hooks']
const MAX_UPDATE_REF = 3
const ZERO = '0'.repeat(40)

export type Tree = { path: string; branch: string }

/** git worktree list --porcelain；第一项是主 worktree。 */
export async function trees(io: Io, cwd: string): Promise<Tree[]> {
  const r = await io.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'])
  if (r.exitCode !== 0) return []
  return r.stdout
    .split(/\n\s*\n/)
    .map(block => ({
      path: /^worktree (.+)$/m.exec(block)?.[1] ?? '',
      branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? '',
    }))
    .filter(t => t.path !== '')
}

export async function judgesDir(io: Io, mainTree: string): Promise<string> {
  for (const dir of HOOK_DIRS) {
    const hooks = `${mainTree}/${dir}`
    if (await io.exists(`${hooks}/slice-gate.py`)) return hooks
  }
  return ''
}

export function judge(io: Io, f: Flight, name: string, args: readonly string[], cwd: string, timeoutMs?: number): Promise<RunResult> {
  return io.run(['python3', `${f.hooksDir}/${name}.py`, ...args], timeoutMs === undefined ? { cwd } : { cwd, timeoutMs })
}

export async function readLedger(io: Io, f: Flight): Promise<{ events: FlightEvent[] } | { error: string }> {
  const r = await judge(io, f, 'ledger', ['show', '--change-dir', `${f.changeTree}/${f.changeDir}`], f.changeTree)
  if (r.exitCode !== 0) return { error: r.stderr }
  const events = r.stdout
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as FlightEvent)
  return { events }
}

// 写入前按读取方（ledger.py 的 EVENTS）同一张表校验：链上一条坏事件就会让整条账本判损坏、起飞被永久拒绝（PR #39 评审 HIGH）
type Check = [(x: unknown) => boolean, string]
const isInt = (x: unknown) => typeof x === 'number' && Number.isInteger(x)
const isStrs = (x: unknown) => Array.isArray(x) && x.every(i => typeof i === 'string')
const oneOf = (...opts: string[]): Check => [x => typeof x === 'string' && opts.includes(x), `不在 ${opts.join(' / ')} 之内`]
const FP: Check = [x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x), '不是 64 位十六进制']
const ATTEMPT: Check = [x => isInt(x) && (x as number) > 0, '不是正整数']
const NONEMPTY: Check = [x => typeof x === 'string' && x !== '', '不是非空字符串']
const STR: Check = [x => typeof x === 'string', '不是字符串']
const BOOL: Check = [x => typeof x === 'boolean', '不是布尔']
const STRS: Check = [isStrs, '不是字符串数组']
const RESULT = { attempt: ATTEMPT, slice: NONEMPTY, ok: BOOL, commit: STR, failed: STRS }
const isFinding = (f: unknown) => {
  const x = f as Record<string, unknown> | null
  return typeof x === 'object' && x !== null && oneOf('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')[0](x.severity) &&
    typeof x.file === 'string' && isInt(x.line) && typeof x.summary === 'string' && typeof x.fix === 'string'
}
const EVENTS: Record<string, Record<string, Check>> = {
  approve: { fp: FP },
  takeoff: { attempt: ATTEMPT, fp: FP, branch: NONEMPTY, model: NONEMPTY, waves: [x => Array.isArray(x) && x.every(isStrs), '不是字符串数组的数组'] },
  dispatch: { attempt: ATTEMPT, slice: NONEMPTY, role: oneOf('executor', 'reviewer', 'fixer', 'resolver'), agent: NONEMPTY, model: NONEMPTY, worktree: NONEMPTY },
  gate: RESULT,
  ended: { attempt: ATTEMPT, agent: NONEMPTY, reason: STR, model: [x => x === null || typeof x === 'string', '不是字符串或 null'] },
  merge: RESULT,
  review: { attempt: ATTEMPT, slice: NONEMPTY, agent: NONEMPTY, findings: [x => Array.isArray(x) && x.every(isFinding), '不是合法的 findings 数组'] },
  blocked: { attempt: ATTEMPT, slice: NONEMPTY, kind: oneOf('gate', 'infra'), reason: STR },
  final: { attempt: ATTEMPT, ok: BOOL, commit: STR, failed: STRS },
  land: { attempt: ATTEMPT, verdict: oneOf('ready', 'draft') },
  halt: { attempt: ATTEMPT, reason: STR },
}

/** 事件不合 ledger.py 的字段表时返回原因，合规返回 undefined。 */
export function eventProblem(event: FlightEvent, change: string): string | undefined {
  const e = event as Record<string, unknown>
  if (e.v !== 1) return 'v 不是 1'
  // 只认字段表自己的键：toString / constructor 等原型链键不算合法 ev
  if (typeof e.ev !== 'string' || !Object.prototype.hasOwnProperty.call(EVENTS, e.ev)) return 'ev 非法'
  const fields = EVENTS[e.ev]
  if (e.change !== change) return 'change 与目录名不符'
  if (typeof e.at !== 'string') return 'at 不是字符串'
  if (typeof e.by !== 'object' || e.by === null || !('plugin' in e.by)) return 'by 缺 plugin'
  for (const [name, [ok, why]] of Object.entries(fields)) if (!ok(e[name])) return `${String(e.ev)} 的 ${name} ${why}`
  return undefined
}

/** 追加一条事件到 refs/flight/<change>/ledger（CAS：update-ref 带旧值，失败重读链尾，至多 3 次）；不合规的事件不写。 */
export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
  if (eventProblem(event, f.change) !== undefined) return false
  const git = (args: string[], stdin?: string) =>
    io.run(['git', ...args], stdin === undefined ? { cwd: f.changeTree } : { cwd: f.changeTree, stdin })
  const blob = await git(['hash-object', '-w', '--stdin'], JSON.stringify(event))
  if (blob.exitCode !== 0) return false
  const tree = await git(['mktree'], `100644 blob ${blob.stdout.trim()}\tevent.json\n`)
  if (tree.exitCode !== 0) return false
  const ref = `refs/flight/${f.change}/ledger`
  for (let attempt = 0; attempt < MAX_UPDATE_REF; attempt++) {
    const head = await git(['rev-parse', '-q', '--verify', ref])
    const parent = head.exitCode === 0 ? head.stdout.trim() : ''
    const commit = await git([
      'commit-tree',
      tree.stdout.trim(),
      ...(parent === '' ? [] : ['-p', parent]),
      '-m',
      `flight: ${event.ev} ${f.change}`,
    ])
    if (commit.exitCode !== 0) return false
    const moved = await git(['update-ref', ref, commit.stdout.trim(), parent === '' ? ZERO : parent])
    if (moved.exitCode === 0) {
      remember(f, event)
      return true
    }
  }
  return false
}

/** 在飞集合：takeoff 写入后登记，land / halt 写入后移除（design D8）。 */
export const active: Map<string, ActiveTree> = new Map()

export type Owner = { change: string; role: Role; slice: string; worktree: string }

/** agent 归属缓存：dispatch 写入后登记。 */
export const owners: Map<string, Owner> = new Map()

// ceiling: 两张表只在本进程内维护，进程重启后要等下一次 takeoff 才重建在飞集合 -> 需要跨重启强制时，从账本 refs/flight/* 重建
function remember(f: Flight, e: FlightEvent): void {
  if (e.ev === 'takeoff') active.set(f.change, { change: f.change, changeTree: f.changeTree, slicePrefix: worktreePath(f, '') })
  else if (e.ev === 'land' || e.ev === 'halt') active.delete(f.change)
  else if (e.ev === 'dispatch') owners.set(String(e.agent), { change: f.change, role: e.role as Role, slice: String(e.slice), worktree: String(e.worktree) })
}

/** 按 agentId 查归属：缓存未命中时退回 flightOfAgent 扫账本，并写回缓存。 */
export async function ownerOf(io: Io, agentId: string): Promise<Owner | undefined> {
  const hit = owners.get(agentId)
  if (hit !== undefined) return hit
  const found = await flightOfAgent(io, agentId)
  const d = found?.events.filter(e => e.ev === 'dispatch' && e.agent === agentId).pop()
  if (found === undefined || d === undefined) return undefined
  const owner: Owner = { change: found.flight.change, role: d.role as Role, slice: String(d.slice), worktree: String(d.worktree) }
  owners.set(agentId, owner)
  return owner
}

export function worktreePath(f: Flight, name: string): string {
  return `${f.mainTree}/.claude/worktrees/flight-${f.change}-${name}`
}

/** 已存在 → 原样复用（续接）；否则基于 change 分支尖端 git worktree add -b。 */
export async function ensureWorktree(io: Io, f: Flight, name: string): Promise<{ path: string; created: boolean } | { error: string }> {
  const path = worktreePath(f, name)
  if (await io.exists(path)) return { path, created: false }
  const r = await io.run(['git', 'worktree', 'add', '-b', `flight/${f.change}/${name}`, path, f.branch], { cwd: f.mainTree })
  if (r.exitCode !== 0) return { error: r.stderr }
  return { path, created: true }
}

export function agentType(role: Role): string {
  return role === 'executor' ? 'flight:executor' : role === 'reviewer' ? 'flight:reviewer' : 'flight:fixer'
}

/** 本进程内的活跃飞行（起飞时登记）。 */
export const flights: Map<string, Flight> = new Map()

const dispatched = (events: readonly FlightEvent[], agentId: string) => events.some(e => e.ev === 'dispatch' && e.agent === agentId)

/** change 目录所在的 worktree（主 worktree 排第一）：未合入的 change 只在 change worktree 上有目录；refs/flight 是共享 ref，从哪个 worktree 读账本都一样。 */
async function locateChangeDir(io: Io, all: readonly Tree[], change: string): Promise<{ changeTree: string; changeDir: string } | undefined> {
  for (const t of all) {
    for (const dir of [`template/openspec/changes/${change}`, `openspec/changes/${change}`]) {
      if (await io.exists(`${t.path}/${dir}`)) return { changeTree: t.path, changeDir: dir }
    }
  }
  return undefined
}

/** 先查本进程登记的飞行；未命中再只靠账本：遍历 refs/flight/<change>/ledger，在含该 change 目录的 worktree 上读账本、重建 Flight 并登记。 */
export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
  for (const flight of flights.values()) {
    const ledger = await readLedger(io, flight)
    if (!('events' in ledger)) continue
    if (dispatched(ledger.events, agentId)) return { flight, events: ledger.events }
  }
  const refs = await io.run(['git', 'for-each-ref', '--format=%(refname)', 'refs/flight/'])
  if (refs.exitCode !== 0) return undefined
  const changes = refs.stdout
    .split('\n')
    .map(line => /^refs\/flight\/(.+)\/ledger$/.exec(line.trim())?.[1])
    .filter((c): c is string => c !== undefined && !flights.has(c))
  if (changes.length === 0) return undefined
  const all = await trees(io, '.')
  const mainTree = all[0]?.path
  if (mainTree === undefined) return undefined
  const hooksDir = await judgesDir(io, mainTree)
  // ceiling: 未命中（含非飞行 agent）时逐个读全部未登记 change 的账本 -> 非飞行 subagent 频繁或账本数多时，按 change 缓存负结果
  for (const change of changes) {
    const at = await locateChangeDir(io, all, change)
    if (at === undefined) continue
    const probe: Flight = { change, mainTree, ...at, branch: '', hooksDir, model: '', session: '' }
    const ledger = await readLedger(io, probe)
    if (!('events' in ledger)) continue
    const { events } = ledger
    const takeoff = events.filter(e => e.ev === 'takeoff').pop()
    if (takeoff === undefined) continue
    if (events.some(e => (e.ev === 'land' || e.ev === 'halt') && Number(e.attempt) === Number(takeoff.attempt))) continue
    if (!dispatched(events, agentId)) continue
    const branch = String(takeoff.branch ?? '')
    const changeTree = all.find(t => t.branch === branch)?.path ?? probe.changeTree
    const flight: Flight = { ...probe, changeTree, branch, model: String(takeoff.model ?? ''), session: takeoff.by.session }
    flights.set(change, flight)
    return { flight, events }
  }
  return undefined
}
