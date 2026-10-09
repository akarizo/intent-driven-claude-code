// scenario 来源：spec flight-findings-intake。landing 不注册 hook，这里直接调用导出的 onFindings / onLandingStop / runLandingAction，
// 传入假 Ctx（实测 X13：测试与插件是隔离实例，走 hook 时测试登记的状态插件看不到）。
// 假 Ctx.io.run 按 argv 作答并记录调用：账本 = git hash-object 的 stdin 即事件 JSON，ledger.py show 按顺序逐行返回；slice-gate.py final 返回预设 JSON。
import { expect, test } from 'claude-code/testing'
import { next, reduce } from '../hooks/core'
import type { Action, Ctx, Flight, FlightEvent, Found, GateJson, RunResult } from '../hooks/core'
import { onFindings, onLandingStop, runLandingAction } from '../hooks/landing'

const MAIN = '/repo'
const CT = '/repo/.worktrees/demo'
const CD = 'template/openspec/changes/demo'
const FIX_TREE = '/repo/.claude/worktrees/flight-demo-fix'
const HOOKS = '/repo/template/.claude/hooks'
const FP = 'f'.repeat(64)
const FLIGHT: Flight = { change: 'demo', mainTree: MAIN, changeTree: CT, changeDir: CD, branch: 'worktree-demo', hooksDir: HOOKS, model: 'opus', session: 'sess-1' }
const PLAN = { waves: [['S1']], deps: { S1: [] } }
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
const HIGH = { severity: 'HIGH', file: 'src/a.py', line: 3, summary: '漏判空列表', fix: '补判空' }

function event(ev: string, x: object): FlightEvent {
  return { v: 1, ev, change: 'demo', at: '2026-10-09T11:00:00.000Z', by: { plugin: 'flight', session: 'sess-1' }, ...x }
}

const TAKEOFF = event('takeoff', { attempt: 1, fp: FP, branch: 'worktree-demo', waves: [['S1']], model: 'opus' })
const DISPATCH_A = event('dispatch', { attempt: 1, slice: 'S1', role: 'executor', agent: 'A', model: 'opus', worktree: '/repo/.claude/worktrees/flight-demo-S1' })
const MERGED = event('merge', { attempt: 1, slice: 'S1', ok: true, commit: 'm'.repeat(40), failed: [] })
const DISPATCH_R = event('dispatch', { attempt: 1, slice: 'S1', role: 'reviewer', agent: 'R', model: 'opus', worktree: CT })
const REVIEWED = event('review', { attempt: 1, slice: 'S1', agent: 'R', findings: [] })

function gateJson(x: Partial<GateJson>): string {
  return JSON.stringify({ slice: 'final', ok: true, commit: 'h'.repeat(40), failed: [], ...x }) + '\n'
}

type Call = { argv: string[]; cwd?: string }
type Log = { ledger: FlightEvent[]; calls: Call[]; commands: string[]; statuses: unknown[]; toasts: string[] }
type World = { ledger: FlightEvent[]; finalOut?: string; fixFinalOut?: string }

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const has = (c: Call, ...parts: string[]) => parts.every(p => c.argv.some(a => a === p || a.endsWith(`/${p}`)))
const finals = (log: Log) => log.calls.filter(c => has(c, 'slice-gate.py', 'final'))

/** git / python3 的作答：账本、final、ship、timeline、飞行记录的 git status / add / commit。 */
function answer(w: World, log: Log, argv: string[], opts: { cwd?: string; stdin?: string } | undefined): RunResult {
  const [cmd, ...args] = argv
  const cwd = opts?.cwd
  if (cmd === 'python3' && args[0]?.endsWith('/ledger.py')) return ok(log.ledger.map(x => JSON.stringify(x)).join('\n') + '\n')
  if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'final')
    return ok(cwd === FIX_TREE ? (w.fixFinalOut ?? gateJson({})) : (w.finalOut ?? gateJson({})))
  if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'ship') return ok('ready\n')
  if (cmd === 'python3' && args[0]?.endsWith('/timeline.py')) return ok('')
  if (cmd !== 'git') throw new Error(`unexpected argv: ${argv.join(' ')}`)
  const op = args[0] === '-C' ? args[2] : args[0]
  switch (op) {
    case 'hash-object':
      log.ledger.push(JSON.parse(String(opts?.stdin)))
      return ok('b'.repeat(40) + '\n')
    case 'mktree':
      return ok('e'.repeat(40) + '\n')
    case 'rev-parse':
      return ok('d'.repeat(40) + '\n')
    case 'commit-tree':
      return ok('c'.repeat(40) + '\n')
    case 'status':
      return ok(` M ${CD}/timeline.md\n`)
    case 'update-ref':
    case 'add':
    case 'commit':
      return ok('')
  }
  throw new Error(`unexpected git: ${args.join(' ')}`)
}

/** 假 Ctx：io 按同一个世界作答，status / toast / runCommand 记入 log；不派发 agent。 */
function ctxOf(w: World): { ctx: Ctx; log: Log } {
  const log: Log = { ledger: [...w.ledger], calls: [], commands: [], statuses: [], toasts: [] }
  const ctx: Ctx = {
    io: {
      async run(argv, opts) {
        log.calls.push({ argv: [...argv], cwd: opts?.cwd })
        return answer(w, log, [...argv], opts)
      },
      read: async () => '- [ ] S1 第一片\n',
      write: async () => undefined,
      exists: async () => false,
    },
    now: async () => NOW,
    spawn: async () => ({ deny: '测试不派发' }),
    status: async text => void log.statuses.push(text),
    toast: async text => void log.toasts.push(text),
    runCommand: async (command, args) => void log.commands.push(`${command} ${args}`),
  }
  return { ctx, log }
}

const foundOf = (log: Log): Found => ({ flight: FLIGHT, events: [...log.ledger] })

/** 推进飞行：按账本算下一批动作，把 final / land / halt 交给 runLandingAction，直到没有这类动作。 */
async function advance(ctx: Ctx, log: Log): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const acts = next(reduce(log.ledger), PLAN, FP).filter((a: Action) => a.kind === 'final' || a.kind === 'land' || a.kind === 'halt')
    if (!acts.length) return
    for (const a of acts) await runLandingAction(ctx, FLIGHT, a)
  }
}

test('findings-tool-accepts-flight-reviewer', async () => {
  // Given: 账本有 takeoff（attempt 1）与 dispatch（agent R、role reviewer、slice S1、attempt 1），found 由该账本构造
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_R] })
  const found = foundOf(log)

  // When: R 调用 submit_findings，findings 为 1 条 HIGH（src/a.py:3）
  const r = await onFindings(ctx, found, 'R', { findings: [HIGH] })

  // Then: 账本末条为 review 事件（slice S1、agent R、findings 即那 1 条），工具结果是字符串
  expect(log.ledger.at(-1)).toMatchObject({ ev: 'review', slice: 'S1', agent: 'R', findings: [HIGH] })
  expect(typeof (r as { result?: unknown }).result).toBe('string')
})

test('findings-tool-denies-others', async () => {
  // Given: 账本有 takeoff 与 dispatch（agent A、role executor、slice S1）；主会话没有 found 与 agentId，A 的 found 由该账本构造
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A] })
  const calls: [Found | undefined, string | undefined][] = [[undefined, undefined], [foundOf(log), 'A']]

  // When: 主会话与 A 各调用一次 submit_findings（各 1 条 HIGH）
  const results = await Promise.all(calls.map(([found, agent]) => onFindings(ctx, found, agent, { findings: [HIGH] })))

  // Then: 两次结果都含「只有本次飞行派发的评审员」，账本仍是原来 2 条
  for (const r of results) expect(JSON.stringify(r)).toContain('只有本次飞行派发的评审员')
  expect(log.ledger).toHaveLength(2)
})

test('reviewer-stop-without-findings-blocks-once', async () => {
  // Given: S1 已由 A 合回（commit mmmm…），评审员 R（slice S1）已派发且账本里没有它的 review 事件
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, DISPATCH_R] })
  const found = foundOf(log)

  // When: R 第一次与第二次收口
  const answers = [await onLandingStop(ctx, found, 'R'), await onLandingStop(ctx, found, 'R')]

  // Then: 第一次回答 block，文本含 submit_findings 与「空列表」；第二次没有 block；R 结束（追加 ended）后状态机给出 blocked review:S1（infra）
  expect(String(answers[0]?.block)).toMatch(/submit_findings[\s\S]*空列表|空列表[\s\S]*submit_findings/)
  expect(answers[1]?.block).toBeUndefined()
  const ended = event('ended', { attempt: 1, agent: 'R', reason: 'completed', model: 'opus' })
  expect(next(reduce([...log.ledger, ended]), PLAN, FP)).toContainEqual(expect.objectContaining({ kind: 'blocked', slice: 'review:S1', blockKind: 'infra' }))
})

test('fixer-stop-runs-final', async () => {
  // Given: 修复 agent F（slice fix、worktree /repo/.claude/worktrees/flight-demo-fix）已派发；修复 worktree 里 final 输出 ok false、failed ["G7 demo#s3"]
  const dispatchF = event('dispatch', { attempt: 1, slice: 'fix', role: 'fixer', agent: 'F', model: 'opus', worktree: FIX_TREE })
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, dispatchF], fixFinalOut: gateJson({ ok: false, failed: ['G7 demo#s3'] }) })
  const found = foundOf(log)

  // When: 处理 F 的收口
  const r = await onLandingStop(ctx, found, 'F')

  // Then: final 在修复 worktree 里跑；回答 block 且含 G7 demo#s3；账本末条为 slice fix、agent F、ok false 的 gate 事件
  expect(finals(log).map(c => c.cwd)).toEqual([FIX_TREE])
  expect(String(r?.block)).toContain('G7 demo#s3')
  expect(log.ledger.at(-1)).toMatchObject({ ev: 'gate', slice: 'fix', agent: 'F', ok: false })
})

test('landing-runs-pr-ship', async () => {
  // Given: S1 已合回且评审结果为空列表，无阻断；change 目录的 timeline.md 有未提交改动；change worktree 里 final 输出 ok true；slice-gate ship 退出 0（ready）
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED] })

  // When: 推进飞行
  await advance(ctx, log)

  // Then: 飞行记录的 git commit 先于 slice-gate.py final；账本新增依次为 final（ok true）与 land（verdict ready）；状态行被清除；运行了 /pr-ship demo
  const commitAt = log.calls.findIndex(c => c.argv[0] === 'git' && has(c, 'commit', 'chore(flight): 记录'))
  expect(commitAt).toBeGreaterThan(-1)
  expect(commitAt).toBeLessThan(log.calls.indexOf(finals(log)[0]))
  expect(log.ledger.slice(4)).toMatchObject([{ ev: 'final', ok: true }, { ev: 'land', verdict: 'ready' }])
  expect(log.statuses).toEqual([undefined])
  expect(log.commands).toEqual(['pr-ship demo'])
})

test('final-red-halts', async () => {
  // Given: S1 已合回且评审结果为空列表；change worktree 里 final 输出 ok false、failed ["G2 lint"]
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], finalOut: gateJson({ ok: false, failed: ['G2 lint'] }) })

  // When: 推进飞行
  await advance(ctx, log)

  // Then: 账本新增依次为 final（ok false）与 halt（原因含 G2 lint）；提示含「停飞」；没有运行任何命令
  expect(log.ledger.slice(4)).toMatchObject([{ ev: 'final', ok: false }, { ev: 'halt', reason: expect.stringContaining('G2 lint') }])
  expect(log.toasts.some(t => t.includes('停飞'))).toBe(true)
  expect(log.commands).toEqual([])
})
