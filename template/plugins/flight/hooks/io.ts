// 飞行副作用层：$ 适配、判定器调用、账本读写、切片 worktree、agent 派发（spec flight-io · design D5）。
// 判定器一律取主 worktree 的副本；命令的工作目录是被判定的那个 worktree。
import type { EngineInterface } from 'claude-code'
import type { Flight, FlightEvent, Io, Role, RunResult } from './core'

const DEFAULT_TIMEOUT_MS = 30000
const HOOK_DIRS = ['.claude/hooks', 'template/.claude/hooks']
const MAX_UPDATE_REF = 3
const ZERO = '0'.repeat(40)

export function ioOf($: EngineInterface): Io {
  return {
    async run(argv, opts = {}) {
      const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = opts
      const r = await $.process.run([...argv], { ...rest, timeoutMs })
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },
    async read(path) {
      const text = await $.fs.read(path)
      return typeof text === 'string' ? text : undefined
    },
    async write(path, text) {
      await $.fs.write(path, text)
    },
    exists: path => $.fs.exists(path),
  }
}

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

/** 追加一条事件到 refs/flight/<change>/ledger（CAS：update-ref 带旧值，失败重读链尾，至多 3 次）。 */
export async function appendEvent(io: Io, f: Flight, event: FlightEvent): Promise<boolean> {
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
    if (moved.exitCode === 0) return true
  }
  return false
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

export async function spawnAgent(
  $: EngineInterface,
  f: Flight,
  role: Role,
  cwd: string,
  prompt: string,
  description: string,
): Promise<{ agentId?: string; deny?: string }> {
  const r = await $.agent.spawn({ prompt, description, subagentType: agentType(role), model: f.model, cwd })
  return 'deny' in r ? { deny: r.deny } : { agentId: r.agentId }
}

/** 本进程内的活跃飞行（起飞时登记）。 */
export const flights: Map<string, Flight> = new Map()

/** 遍历活跃飞行，读各自账本，找 dispatch 事件 agent === agentId 的那一个。 */
export async function flightOfAgent(io: Io, agentId: string): Promise<{ flight: Flight; events: FlightEvent[] } | undefined> {
  for (const flight of flights.values()) {
    const ledger = await readLedger(io, flight)
    if (!('events' in ledger)) continue
    if (ledger.events.some(e => e.ev === 'dispatch' && e.agent === agentId)) return { flight, events: ledger.events }
  }
  return undefined
}
