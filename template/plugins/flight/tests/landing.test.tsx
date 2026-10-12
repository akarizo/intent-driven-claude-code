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
type Log = { ledger: FlightEvent[]; calls: Call[]; commands: string[]; statuses: unknown[]; toasts: string[]; writes: string[]; logs: string[]; seq: string[] }
type World = {
  ledger: FlightEvent[]
  finalOut?: string
  fixFinalOut?: string
  ledgerFails?: boolean
  timelineReport?: string
  timelineFails?: string
  timelineExit?: number
  timelineThrows?: string
  commandThrows?: string
  dirty?: string
  mainHead?: string
  mergeBase?: RunResult
}

const SHIP_READY = JSON.stringify({ ready: true, commit: 'h'.repeat(40), reasons: [], blocked: [], blocking: [], deferred: [], fix: null, review: null }) + '\n'

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const has = (c: Call, ...parts: string[]) => parts.every(p => c.argv.some(a => a === p || a.endsWith(`/${p}`)))
const finals = (log: Log) => log.calls.filter(c => has(c, 'slice-gate.py', 'final'))

/** git / python3 的作答：账本、final、ship、timeline、飞行记录的 git status / add / commit。 */
function answer(w: World, log: Log, argv: string[], opts: { cwd?: string; stdin?: string } | undefined): RunResult {
  const [cmd, ...args] = argv
  const cwd = opts?.cwd
  if (cmd === 'python3' && args[0]?.endsWith('/ledger.py') && w.ledgerFails) return { exitCode: 1, stdout: '', stderr: 'fatal: bad object refs/flight/demo/ledger\n' }
  if (cmd === 'python3' && args[0]?.endsWith('/ledger.py')) return ok(log.ledger.map(x => JSON.stringify(x)).join('\n') + '\n')
  if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'final')
    return ok(cwd === FIX_TREE ? (w.fixFinalOut ?? gateJson({})) : (w.finalOut ?? gateJson({})))
  if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'ship') return ok(SHIP_READY)
  if (cmd === 'python3' && args[0]?.endsWith('/timeline.py') && args[1] === 'report' && w.timelineThrows !== undefined) throw new Error(w.timelineThrows)
  if (cmd === 'python3' && args[0]?.endsWith('/timeline.py') && args[1] === 'report' && w.timelineFails !== undefined)
    return { exitCode: w.timelineExit ?? 1, stdout: '', stderr: w.timelineFails }
  if (cmd === 'python3' && args[0]?.endsWith('/timeline.py')) return ok(args[1] === 'report' ? (w.timelineReport ?? '') : '')
  if (cmd !== 'git') throw new Error(`unexpected argv: ${argv.join(' ')}`)
  const op = args[0] === '-C' ? args[2] : args[0]
  switch (op) {
    case 'hash-object':
      log.ledger.push(JSON.parse(String(opts?.stdin)))
      return ok('b'.repeat(40) + '\n')
    case 'mktree':
      return ok('e'.repeat(40) + '\n')
    case 'rev-parse':
      // rev-parse --verify refs/heads/<分支>（freshWorktree 查占用）：分支都不存在
      if (args.some(a => String(a).startsWith('refs/heads/'))) return { exitCode: 1, stdout: '', stderr: '' }
      // git -C <主 worktree> rev-parse HEAD：全量评审取主 worktree 的 HEAD
      if (args[0] === '-C' && args[1] === MAIN && w.mainHead !== undefined) return ok(w.mainHead + '\n')
      return ok('d'.repeat(40) + '\n')
    case 'merge-base':
      return w.mergeBase ?? ok('b'.repeat(40) + '\n')
    case 'commit-tree':
      return ok('c'.repeat(40) + '\n')
    case 'status':
      return ok(` M ${CD}/${w.dirty ?? 'timeline.md'}\n`)
    case 'update-ref':
    case 'worktree':
    case 'add':
    case 'commit':
      return ok('')
  }
  throw new Error(`unexpected git: ${args.join(' ')}`)
}

/** 假 Ctx：io 按同一个世界作答，status / toast / runCommand / log 记入 log（log 与 runCommand 的先后另记入 seq）；不派发 agent。 */
function ctxOf(w: World): { ctx: Ctx; log: Log } {
  const log: Log = { ledger: [...w.ledger], calls: [], commands: [], statuses: [], toasts: [], writes: [], logs: [], seq: [] }
  const ctx: Ctx = {
    io: {
      async run(argv, opts) {
        log.calls.push({ argv: [...argv], cwd: opts?.cwd })
        return answer(w, log, [...argv], opts)
      },
      read: async () => '- [ ] S1 第一片\n',
      write: async path => void log.writes.push(path),
      exists: async () => false,
    },
    now: async () => NOW,
    spawn: async () => ({ deny: '测试不派发' }),
    status: async text => void log.statuses.push(text),
    toast: async text => void log.toasts.push(text),
    runCommand: async (command, args) => {
      log.commands.push(`${command} ${args}`)
      log.seq.push('command')
      if (w.commandThrows !== undefined) throw new Error(w.commandThrows)
    },
    log: async text => {
      log.logs.push(text)
      log.seq.push('log')
    },
  }
  return { ctx, log }
}

const foundOf = (log: Log): Found => ({ flight: FLIGHT, events: [...log.ledger] })

/** 全量评审员 W 的一次往返：派发（commit 为 final 的 commit）、评审结果为空列表、结束时实际模型 claude-opus-5-5。 */
function cleanWholeReview(commit: string): FlightEvent[] {
  return [
    event('dispatch', { attempt: 1, slice: 'whole', role: 'reviewer', agent: 'W', model: 'opus', worktree: CT, commit, base: 'b'.repeat(40) }),
    event('review', { attempt: 1, slice: 'whole', agent: 'W', findings: [] }),
    event('ended', { attempt: 1, agent: 'W', reason: 'completed', model: 'claude-opus-5-5' }),
  ]
}

/** 推进飞行：按账本算下一批动作，把 final / land / halt 交给 runLandingAction；全量评审派发不经 spawn，直接记下 W 以空列表返回；直到没有这类动作。 */
async function advance(ctx: Ctx, log: Log): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const all = next(reduce(log.ledger), PLAN, FP)
    const whole = all.flatMap((a: Action) => (a.kind === 'dispatch' && a.role === 'reviewer' && a.mode === 'whole' ? [a] : []))[0]
    if (whole) {
      log.ledger.push(...cleanWholeReview(whole.commit))
      continue
    }
    const acts = all.filter((a: Action) => a.kind === 'final' || a.kind === 'land' || a.kind === 'halt')
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
  // Given: S1 已合回且评审结果为空列表，无阻断；change 目录的 timeline.md 有未提交改动；change worktree 里 final 输出 ok true；全量评审员 W 以空列表返回；slice-gate ship 退出 0（ready）
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED] })

  // When: 推进飞行
  await advance(ctx, log)

  // Then: 飞行记录的 git commit 先于 slice-gate.py final；账本新增依次为 final（ok true）、全量评审 W 的 dispatch / review / ended 与 land（verdict ready）；状态行被清除；运行了 /flight:pr-ship --worktree /repo/.worktrees/demo --change-dir template/openspec/changes/demo --judges /repo/template/.claude/hooks
  const commitAt = log.calls.findIndex(c => c.argv[0] === 'git' && has(c, 'commit', 'chore(flight): 记录'))
  expect(commitAt).toBeGreaterThan(-1)
  expect(commitAt).toBeLessThan(log.calls.indexOf(finals(log)[0]))
  expect(log.ledger.slice(4)).toMatchObject([
    { ev: 'final', ok: true },
    { ev: 'dispatch', role: 'reviewer', slice: 'whole' },
    { ev: 'review', slice: 'whole', findings: [] },
    { ev: 'ended', agent: 'W' },
    { ev: 'land', verdict: 'ready' },
  ])
  expect(log.statuses).toEqual([undefined])
  expect(log.commands).toEqual([`flight:pr-ship --worktree ${CT} --change-dir ${CD} --judges ${HOOKS}`])
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

test('landing-stops-when-ledger-unreadable', async () => {
  // Given: 账本里 S1 已合回、评审有 1 条 HIGH 未闭环；但此刻 ledger.py show 以 1 退出（账本读取失败）
  const reviewedHigh = event('review', { attempt: 1, slice: 'S1', agent: 'R', findings: [HIGH] })
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, reviewedHigh], ledgerFails: true })

  // When: drive 交来 land 动作
  await runLandingAction(ctx, FLIGHT, { kind: 'land' })

  // Then: 没有写 review-findings.json；没有运行任何命令；账本无新增；提示含「账本读取失败」
  expect(log.writes.filter(p => p.endsWith('/review-findings.json'))).toEqual([])
  expect(log.commands).toEqual([])
  expect(log.ledger).toHaveLength(4)
  expect(log.toasts.some(t => t.includes('账本读取失败'))).toBe(true)
})

test('landing-prints-flight-record', async () => {
  // Given: S1 已由 A 合回、R 的评审结果为空列表，A 与 R 结束时实际模型都是 claude-opus-5-5（起飞主模型 opus）；final 绿；全量评审员 W 以空列表返回、实际模型同为 claude-opus-5-5；timeline report 输出「批准 → apply 完成：12.0 min」
  const endedA = event('ended', { attempt: 1, agent: 'A', reason: 'completed', model: 'claude-opus-5-5' })
  const endedR = event('ended', { attempt: 1, agent: 'R', reason: 'completed', model: 'claude-opus-5-5' })
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, endedA, MERGED, DISPATCH_R, REVIEWED, endedR], timelineReport: '批准 → apply 完成：12.0 min\n' })

  // When: 推进飞行（final 后执行落地动作）
  await advance(ctx, log)

  // Then: Ctx.log 只收到一段文本，含「飞行记录 · demo」「批准 → apply 完成：12.0 min」「路由对账：一致」；打印先于运行 /flight:pr-ship
  expect(log.logs).toHaveLength(1)
  expect(log.logs[0]).toContain('飞行记录 · demo')
  expect(log.logs[0]).toContain('批准 → apply 完成：12.0 min')
  expect(log.logs[0]).toContain('路由对账：一致')
  expect(log.seq).toEqual(['log', 'command'])
})

test('halt-prints-flight-record', async () => {
  // Given: S1 已合回且评审结果为空列表；timeline report 输出「门禁红次数：2」
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], timelineReport: '门禁红次数：2\n' })

  // When: drive 交来停飞动作，原因「final 红：G2 lint」
  await runLandingAction(ctx, FLIGHT, { kind: 'halt', reason: 'final 红：G2 lint' })

  // Then: Ctx.log 收到一段文本，含「停飞 · demo：final 红：G2 lint」与「门禁红次数：2」
  expect(log.logs).toHaveLength(1)
  expect(log.logs[0]).toContain('停飞 · demo：final 红：G2 lint')
  expect(log.logs[0]).toContain('门禁红次数：2')
})

test('fixer-dispatch-commits-records-first', async () => {
  // Given: 账本里 S1 已合回；change 目录的 slices/_interfaces.md 有未提交改动；修复 worktree 尚不存在
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED], dirty: 'slices/_interfaces.md' })

  // When: drive 交来派发修复 agent 的动作（1 条 HIGH）
  await runLandingAction(ctx, FLIGHT, { kind: 'dispatch', role: 'fixer', findings: [HIGH] } as Action)

  // Then: 「chore(flight): 记录」的 git commit 存在，且排在修复 worktree 的 git worktree add 之前
  const commitAt = log.calls.findIndex(c => c.argv[0] === 'git' && has(c, 'commit', 'chore(flight): 记录'))
  const addAt = log.calls.findIndex(c => c.argv[0] === 'git' && has(c, 'worktree', 'add'))
  expect(commitAt).toBeGreaterThan(-1)
  expect(commitAt).toBeLessThan(addAt)
})

test('halt-prints-flight-record-when-report-fails', async () => {
  // Given: S1 已合回且评审结果为空列表；timeline report 以 exit 1 退出，stderr 为「boom: no timeline\nsecond」
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], timelineFails: 'boom: no timeline\nsecond' })

  // When: drive 交来停飞动作，原因「final 红：G2 lint」
  await runLandingAction(ctx, FLIGHT, { kind: 'halt', reason: 'final 红：G2 lint' })

  // Then: Ctx.log 仍收到一段文本，含「（timeline report 失败：boom: no timeline）」且不含 stderr 第二行「second」
  expect(log.logs).toHaveLength(1)
  expect(log.logs[0]).toContain('（timeline report 失败：boom: no timeline）')
  expect(log.logs[0]).not.toContain('second')
})

test('land-handoff-failure-keeps-landing', async () => {
  // Given: S1 已合回且评审结果为空列表；slice-gate ship 为 ready；运行 /flight:pr-ship 抛出 Error「no command named /flight:pr-ship in this session」
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], commandThrows: 'no command named /flight:pr-ship in this session' })

  // When: drive 交来 land 动作
  const thrown = await runLandingAction(ctx, FLIGHT, { kind: 'land' }).then(() => undefined, (e: unknown) => e)

  // Then: 落地动作不抛错；账本末条为 land；toast 含「手动运行 /flight:pr-ship」；Ctx.log 有一段含「接 /flight:pr-ship 失败：no command named」的文本
  expect(thrown).toBeUndefined()
  expect(log.ledger.at(-1)).toMatchObject({ ev: 'land' })
  expect(log.toasts.some(t => t.includes('手动运行 /flight:pr-ship'))).toBe(true)
  expect(log.logs.some(t => t.includes('接 /flight:pr-ship 失败：no command named'))).toBe(true)
})

test('flight-record-survives-report-throw', async () => {
  // Given: S1 已合回且评审结果为空列表、final 绿、全量评审员 W 以空列表返回；timeline report 时 io.run 抛出 Error「spawn ENOENT」
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], timelineThrows: 'spawn ENOENT' })

  // When: 推进飞行（final 后执行落地动作）
  await advance(ctx, log)

  // Then: Ctx.log 首段含「（timeline report 失败：spawn ENOENT）」；调用顺序为先 log 后运行 /flight:pr-ship
  expect(log.logs[0]).toContain('（timeline report 失败：spawn ENOENT）')
  expect(log.seq).toEqual(['log', 'command'])
})

test('flight-record-shows-exit-code', async () => {
  // Given: S1 已合回且评审结果为空列表；timeline report 以 2 退出、stderr 为空串
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], timelineFails: '', timelineExit: 2 })

  // When: drive 交来停飞动作，原因「final 红：G2 lint」
  await runLandingAction(ctx, FLIGHT, { kind: 'halt', reason: 'final 红：G2 lint' })

  // Then: Ctx.log 收到一段文本，含「（timeline report 失败：exit 2）」
  expect(log.logs).toHaveLength(1)
  expect(log.logs[0]).toContain('（timeline report 失败：exit 2）')
})

test('flight-record-lists-routing-mismatch', async () => {
  // Given: 起飞主模型 opus；A 结束时实际模型为 claude-sonnet-4-6（不符），R 结束时为 claude-opus-5-5（相符）；timeline report 输出空
  const endedA = event('ended', { attempt: 1, agent: 'A', reason: 'completed', model: 'claude-sonnet-4-6' })
  const endedR = event('ended', { attempt: 1, agent: 'R', reason: 'completed', model: 'claude-opus-5-5' })
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, endedA, MERGED, DISPATCH_R, REVIEWED, endedR] })

  // When: drive 交来停飞动作，原因「final 红：G2 lint」
  await runLandingAction(ctx, FLIGHT, { kind: 'halt', reason: 'final 红：G2 lint' })

  // Then: Ctx.log 的文本含「路由对账：1 条不符」与「路由不符：executor（agent A）期望 opus，实际 claude-sonnet-4-6」
  expect(log.logs[0]).toContain('路由对账：1 条不符')
  expect(log.logs[0]).toContain('路由不符：executor（agent A）期望 opus，实际 claude-sonnet-4-6')
})

test('landing-final-requests-fix-reuse', async () => {
  // Given: S1 已合回且评审结果为空列表，无阻断；change worktree 里 final 输出 ok true；slice-gate ship 退出 0（ready）
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED] })

  // When: 推进飞行到 final 与落地
  await advance(ctx, log)

  // Then: slice-gate.py final 只调用一次，cwd 为 change worktree，argv 含 --reuse-fix
  expect(finals(log)).toHaveLength(1)
  expect(finals(log)[0].cwd).toBe(CT)
  expect(finals(log)[0].argv).toContain('--reuse-fix')
})

test('fixer-stop-final-never-reuses', async () => {
  // Given: 修复 agent F（slice fix、worktree /repo/.claude/worktrees/flight-demo-fix）已派发；修复 worktree 里 final 输出 ok true
  const dispatchF = event('dispatch', { attempt: 1, slice: 'fix', role: 'fixer', agent: 'F', model: 'opus', worktree: FIX_TREE })
  const { ctx, log } = ctxOf({ ledger: [TAKEOFF, dispatchF] })
  const found = foundOf(log)

  // When: 处理 F 的收口
  await onLandingStop(ctx, found, 'F')

  // Then: slice-gate.py final 的调用 cwd 为修复 worktree，argv 不含 --reuse-fix
  expect(finals(log).map(c => c.cwd)).toEqual([FIX_TREE])
  expect(finals(log)[0].argv).not.toContain('--reuse-fix')
})

/** 同 ctxOf，但 spawn 一律放行为 agent，并记下派发参数。 */
function spawningCtx(w: World, agent: string) {
  const { ctx, log } = ctxOf(w)
  const spawned: { role: string; cwd: string; prompt: string; description: string }[] = []
  ctx.spawn = async x => {
    spawned.push({ role: x.role, cwd: x.cwd, prompt: x.prompt, description: x.description })
    return { agentId: agent }
  }
  return { ctx, log, spawned }
}

test('whole-review-dispatch-records-range', async () => {
  // Given: 三个世界，S1 都已合回且评审结果为空列表；世界一主 worktree HEAD 为 m0、git merge-base c9 m0 输出 b0、派发得 agent W；
  //        世界二 merge-base 以 1 退出；世界三修复体派发得 agent F1、修复 worktree 里 final 输出 ok true
  const ledger = [TAKEOFF, DISPATCH_A, MERGED, REVIEWED]
  const one = spawningCtx({ ledger, mainHead: 'm0', mergeBase: ok('b0\n') }, 'W')
  const two = spawningCtx({ ledger, mainHead: 'm0', mergeBase: { exitCode: 1, stdout: '', stderr: 'fatal: Not a valid commit name c9' } }, 'W')
  const three = spawningCtx({ ledger }, 'F1')
  const whole = { kind: 'dispatch', role: 'reviewer', slice: 'whole', mode: 'whole', commit: 'c9', prior: [] } as unknown as Action
  const fixer = { kind: 'dispatch', role: 'fixer', slice: 'fix-r1', findings: [HIGH] } as unknown as Action

  // When: 世界一、二执行全量评审的派发动作；世界三执行修复体动作（slice fix-r1）并让 F1 收口
  await Promise.all([runLandingAction(one.ctx, FLIGHT, whole), runLandingAction(two.ctx, FLIGHT, whole)])
  await runLandingAction(three.ctx, FLIGHT, fixer).then(() => onLandingStop(three.ctx, foundOf(three.log), 'F1'))

  // Then: 世界一派发的提示词含 git diff b0 c9，账本末条为 slice whole、commit c9、base b0 的 dispatch；
  //       世界二没有派发，账本末条为 blocked review:whole（infra），原因含「算不出全量评审的起点」；
  //       世界三的修复体 dispatch 的 worktree 为 flight-demo-fix-r1、branch 为 flight/demo/fix-r1，收口门禁事件的 slice 为 fix-r1
  expect(one.spawned[0]?.prompt).toContain('git diff b0 c9')
  expect(one.log.ledger.at(-1)).toMatchObject({ ev: 'dispatch', role: 'reviewer', slice: 'whole', commit: 'c9', base: 'b0' })
  expect(two.spawned).toEqual([])
  expect(two.log.ledger.at(-1)).toMatchObject({ ev: 'blocked', slice: 'review:whole', kind: 'infra', reason: expect.stringContaining('算不出全量评审的起点') })
  expect(three.log.ledger.find(e => e.ev === 'dispatch' && e.agent === 'F1')).toMatchObject({ slice: 'fix-r1', worktree: `${MAIN}/.claude/worktrees/flight-demo-fix-r1`, branch: 'flight/demo/fix-r1' })
  expect(three.log.ledger.at(-1)).toMatchObject({ ev: 'gate', agent: 'F1', slice: 'fix-r1' })
})

test('followup-review-dispatch-uses-action-range', async () => {
  // Given: S1 已合回且评审结果为空列表；派发得 agent V；动作为 slice whole-r1、mode followup、base c9、commit c10、prior 一条 HIGH src/a.py:3
  const { ctx, log, spawned } = spawningCtx({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED] }, 'V')
  const followup = { kind: 'dispatch', role: 'reviewer', slice: 'whole-r1', mode: 'followup', base: 'c9', commit: 'c10', prior: [HIGH] } as unknown as Action

  // When: 执行复核的派发动作
  await runLandingAction(ctx, FLIGHT, followup)

  // Then: 提示词含 git diff c9 c10 与「第 1 轮」，description 为「复核 第 1 轮」；账本末条为 slice whole-r1、commit c10、base c9 的 dispatch
  expect(spawned[0]?.prompt).toContain('git diff c9 c10')
  expect(spawned[0]?.prompt).toContain('第 1 轮')
  expect(spawned[0]?.description).toBe('复核 第 1 轮')
  expect(log.ledger.at(-1)).toMatchObject({ ev: 'dispatch', role: 'reviewer', slice: 'whole-r1', commit: 'c10', base: 'c9' })
})

test('landing-hands-off-to-flight-pr-ship', async () => {
  // Given: 两个世界，S1 都已合回且评审结果为空列表、slice-gate ship 为 ready；change worktree /repo/.worktrees/demo、change 目录 template/openspec/changes/demo、判定器 /repo/template/.claude/hooks；第二个世界里运行命令抛出 Error「no command named /flight:pr-ship」
  const ok = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED] })
  const bad = ctxOf({ ledger: [TAKEOFF, DISPATCH_A, MERGED, REVIEWED], commandThrows: 'no command named /flight:pr-ship' })
  const args = `--worktree ${CT} --change-dir ${CD} --judges ${HOOKS}`

  // When: 两个世界各自执行一次 land 动作
  await Promise.all([runLandingAction(ok.ctx, FLIGHT, { kind: 'land' }), runLandingAction(bad.ctx, FLIGHT, { kind: 'land' })])

  // Then: 第一个世界运行的命令恰为 flight:pr-ship 加三项参数；第二个世界账本末条为 land、toast 含「请手动运行 /flight:pr-ship」加完整参数、Ctx.log 含「落地完成，但接 /flight:pr-ship 失败：no command named /flight:pr-ship」
  expect(ok.log.commands).toEqual([`flight:pr-ship ${args}`])
  expect(bad.log.ledger.at(-1)).toMatchObject({ ev: 'land' })
  expect(bad.log.toasts.some(t => t.includes(`请手动运行 /flight:pr-ship ${args}`))).toBe(true)
  expect(bad.log.logs).toContain('落地完成，但接 /flight:pr-ship 失败：no command named /flight:pr-ship')
})
