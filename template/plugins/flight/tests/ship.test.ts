// scenario 来源：spec flight-ship-tool（ship-tool-* / ship-comment-*）。ship.ts 只经 Ctx / Io 访问外界，这里用假 Ctx：
// io.run 按 argv 作答并记下全部调用；账本 = git hash-object 的 stdin 即事件 JSON（与 landing.test.tsx 的世界同一写法）。
import { expect, test } from 'claude-code/testing'
import { reduce } from '../hooks/core'
import type { Ctx, Finding, Flight, FlightEvent, RunResult } from '../hooks/core'
import { shipComment, shipPr } from '../hooks/ship'
import type { ShipJson } from '../hooks/ship'

const MAIN = '/repo'
const CT = '/repo/.worktrees/demo'
const CD = 'template/openspec/changes/demo'
const HOOKS = '/repo/template/.claude/hooks'
const FP = 'f'.repeat(64)
const H1 = '1a'.repeat(20)
const H0 = '0b'.repeat(20)
const URL7 = 'https://github.com/o/r/pull/7'
const FLIGHT: Flight = { change: 'demo', mainTree: MAIN, changeTree: CT, changeDir: CD, branch: 'worktree-demo', hooksDir: HOOKS, model: 'opus', session: 'sess-1' }
const NOW = Date.UTC(2026, 9, 13, 9, 30, 0)
const HIGH: Finding = { severity: 'HIGH', file: 'a.ts', line: 3, summary: '空指针', fix: '判空' }
const MEDIUM: Finding = { severity: 'MEDIUM', file: 'b.ts', line: 5, summary: '命名', fix: '改名' }
const UNCLOSED = '1 条 CRITICAL/HIGH 评审未闭环'

function event(ev: string, x: object): FlightEvent {
  return { v: 1, ev, change: 'demo', at: '2026-10-13T08:00:00.000Z', by: { plugin: 'flight', session: 'sess-1' }, ...x }
}

const TAKEOFF = event('takeoff', { attempt: 1, fp: FP, branch: 'worktree-demo', waves: [['S1']], model: 'opus' })
const LAND = event('land', { attempt: 1, verdict: 'draft' })
const LANDED = [TAKEOFF, LAND]

function shipJson(x: Partial<ShipJson>): ShipJson {
  return { ready: true, commit: H1, reasons: [], blocked: [], blocking: [], deferred: [], fix: null, review: null, ...x }
}

type World = {
  ledger: FlightEvent[]
  origin?: string
  originFail?: RunResult // git remote get-url origin 的作答（读取失败的世界）
  view?: { headRefName?: string; headRefOid?: string; isDraft?: boolean }
  ship?: ShipJson | Record<string, unknown> // 形状不合的 ship 输出也照样打印
}
type Call = { argv: string[]; cwd?: string }
type Log = { ledger: FlightEvent[]; calls: Call[] }

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const has = (c: Call, ...parts: string[]) => parts.every(p => c.argv.some(a => a === p || a.endsWith(`/${p}`)))
const find = (log: Log, ...parts: string[]) => log.calls.findIndex(c => has(c, ...parts))
const gh = (log: Log, sub: string) => log.calls.filter(c => c.argv[0] === 'gh' && c.argv[2] === sub)

/** git / gh / python3 的作答：HEAD 为 H1、origin 缺省为 github、PR 7 缺省头相符且是 draft、ship 缺省 ready；账本写入记入 log.ledger。 */
function answer(w: World, log: Log, argv: string[], stdin: string | undefined): RunResult {
  const [cmd, ...args] = argv
  if (cmd === 'gh' && args[1] === 'view')
    return ok(JSON.stringify({ number: 7, url: URL7, headRefName: 'worktree-demo', headRefOid: H1, isDraft: true, ...w.view }) + '\n')
  if (cmd === 'gh') return ok('')
  if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'ship') {
    const j = w.ship ?? shipJson({})
    return { exitCode: j.ready === true ? 0 : 1, stdout: JSON.stringify(j) + '\n', stderr: '' }
  }
  if (cmd !== 'git') throw new Error(`unexpected argv: ${argv.join(' ')}`)
  const op = args[0] === '-C' ? args[2] : args[0]
  switch (op) {
    case 'remote':
      return w.originFail ?? ok(`${w.origin ?? 'git@github.com:o/r.git'}\n`)
    case 'rev-parse':
      if (args.includes('HEAD')) return ok(H1 + '\n')
      return ok('d'.repeat(40) + '\n')
    case 'hash-object':
      log.ledger.push(JSON.parse(String(stdin)))
      return ok('b'.repeat(40) + '\n')
    case 'mktree':
      return ok('e'.repeat(40) + '\n')
    case 'commit-tree':
      return ok('c'.repeat(40) + '\n')
    case 'update-ref':
      return ok('')
  }
  throw new Error(`unexpected git: ${args.join(' ')}`)
}

function ctxOf(w: World): { ctx: Ctx; log: Log } {
  const log: Log = { ledger: [...w.ledger], calls: [] }
  const ctx: Ctx = {
    io: {
      async run(argv, opts) {
        log.calls.push({ argv: [...argv], cwd: opts?.cwd })
        return answer(w, log, [...argv], opts?.stdin)
      },
      read: async () => undefined,
      write: async () => undefined,
      exists: async () => false,
    },
    now: async () => NOW,
    spawn: async () => ({ deny: '测试不派发' }),
    status: async () => undefined,
    toast: async () => undefined,
    runCommand: async () => undefined,
    log: async () => undefined,
  }
  return { ctx, log }
}

async function ship(w: World, pr: string) {
  const { ctx, log } = ctxOf(w)
  const out = await shipPr(ctx, FLIGHT, reduce(w.ledger), pr)
  return { out, log }
}

const denyOf = (out: { result: string } | { deny: string }) => ('deny' in out ? out.deny : '')

test('ship-tool-checks-pr-head', async () => {
  // Given: demo 分支 worktree-demo、HEAD 为 H1、origin 缺省 git@github.com:o/r.git；五个世界：
  //        ① 已落地、PR 7 的 headRefName 为 other ② 已落地、PR 7 的 headRefOid 为 H0 ③ 账本只有 takeoff 没有 land
  //        ④ 已落地、origin 为 git@gitlab.com:o/r.git ⑤ 已落地、pr 参数为 abc
  const worlds: [World, string][] = [
    [{ ledger: LANDED, view: { headRefName: 'other' } }, '7'],
    [{ ledger: LANDED, view: { headRefOid: H0 } }, '7'],
    [{ ledger: [TAKEOFF] }, '7'],
    [{ ledger: LANDED, origin: 'git@gitlab.com:o/r.git' }, '7'],
    [{ ledger: LANDED }, 'abc'],
  ]

  // When: 各调用一次 shipPr
  const runs = await Promise.all(worlds.map(([w, pr]) => ship(w, pr)))

  // Then: 五次都返回 deny，依次含 worktree-demo、先推送、还没落地、只支持 GitHub、PR 号；
  //       五个世界都没有运行 gh pr comment 与 gh pr ready，账本没有新事件
  const denies = runs.map(r => denyOf(r.out))
  expect(denies.every(d => d.startsWith('flight：'))).toBe(true)
  expect([denies[0].includes('worktree-demo'), denies[1].includes('先推送'), denies[2].includes('还没落地'), denies[3].includes('只支持 GitHub'), denies[4].includes('PR 号')])
    .toEqual([true, true, true, true, true])
  expect(runs.map(r => gh(r.log, 'comment').length + gh(r.log, 'ready').length)).toEqual([0, 0, 0, 0, 0])
  expect(runs.map((r, i) => r.log.ledger.length === worlds[i][0].ledger.length)).toEqual([true, true, true, true, true])
})

test('ship-tool-applies-ledger-verdict', async () => {
  // Given: demo 已落地、PR 7 头分支 worktree-demo、头 commit 与 HEAD H1 相符；三个世界：
  //        ① ship 裁决 ready、PR 是 draft ② ship 裁决 draft（reasons 为「1 条 CRITICAL/HIGH 评审未闭环」）、PR 不是 draft ③ ship 裁决 draft、PR 是 draft
  const draft = shipJson({ ready: false, reasons: [UNCLOSED], blocking: [HIGH] })
  const worlds: World[] = [
    { ledger: LANDED, view: { isDraft: true }, ship: shipJson({ ready: true }) },
    { ledger: LANDED, view: { isDraft: false }, ship: draft },
    { ledger: LANDED, view: { isDraft: true }, ship: draft },
  ]

  // When: 各调用一次 shipPr（pr 为 7）
  const [a, b, c] = await Promise.all(worlds.map(w => ship(w, '7')))

  // Then: ① 依次运行 gh pr view、slice-gate.py ship（cwd 为 change worktree）、gh pr comment 7、gh pr ready 7，账本末条为 ship 事件（pr 为 URL7、verdict ready、commit H1），result 含 ready；
  //       gh pr ready 的 argv 恰为 [gh, pr, ready, 7]；
  //       ② 运行了 gh pr ready 7 --undo，评论正文含「1 条 CRITICAL/HIGH 评审未闭环」；
  //       ③ 没有运行 gh pr ready，账本末条为 verdict draft 的 ship 事件
  const order = [find(a.log, 'gh', 'view'), find(a.log, 'slice-gate.py', 'ship'), find(a.log, 'gh', 'comment', '7'), find(a.log, 'gh', 'ready')]
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true)
  expect(a.log.calls[order[1]].cwd).toBe(CT)
  expect(gh(a.log, 'ready').map(c => c.argv)).toEqual([['gh', 'pr', 'ready', '7']])
  expect(a.log.ledger.at(-1)).toMatchObject({ ev: 'ship', attempt: 1, pr: URL7, verdict: 'ready', commit: H1, at: new Date(NOW).toISOString() })
  expect('result' in a.out && a.out.result.includes('ready')).toBe(true)
  expect(gh(b.log, 'ready').map(c => c.argv)).toEqual([['gh', 'pr', 'ready', '7', '--undo']])
  expect(gh(b.log, 'comment')[0]?.argv.join(' ')).toContain(UNCLOSED)
  expect(gh(c.log, 'ready')).toEqual([])
  expect(c.log.ledger.at(-1)).toMatchObject({ ev: 'ship', verdict: 'draft' })
})

// scenario 来源：spec flight-reliability（flight-ledger-guards）
test('ship-output-shape-checked', async () => {
  // Given: 三个已落地（land ready）的世界：
  //        甲：ship 输出的 JSON 缺 review 键；乙：git remote get-url origin 以 2 退出、stderr「fatal: No such remote」；
  //        丙：一切正常，裁决 ready，PR 7 是 draft
  const { review: _drop, ...noReview } = shipJson({})
  const landedReady = [TAKEOFF, event('land', { attempt: 1, verdict: 'ready' })]
  const worlds: World[] = [
    { ledger: landedReady, ship: noReview },
    { ledger: landedReady, originFail: { exitCode: 2, stdout: '', stderr: "fatal: No such remote 'origin'\n" } },
    { ledger: landedReady, view: { isDraft: true }, ship: shipJson({ ready: true }) },
  ]

  // When: 分别调用 shipPr(ctx, f, state, '7')
  const [a, b, c] = await Promise.all(worlds.map(w => ship(w, '7')))

  // Then: 甲返回 deny 含「ship 输出无法解析」，没有运行 gh pr comment 或 gh pr ready；
  //       乙返回 deny 含「读取 origin 失败」与「No such remote」，不含「只支持 GitHub」；
  //       丙运行的 gh pr ready 的 argv 恰为 [gh, pr, ready, 7]
  expect(denyOf(a.out)).toContain('ship 输出无法解析')
  expect(gh(a.log, 'comment').length + gh(a.log, 'ready').length).toBe(0)
  expect([denyOf(b.out).includes('读取 origin 失败'), denyOf(b.out).includes('No such remote'), denyOf(b.out).includes('只支持 GitHub')]).toEqual([true, true, false])
  expect(gh(c.log, 'ready').map(x => x.argv)).toEqual([['gh', 'pr', 'ready', '7']])
})

test('ship-comment-lists-findings', () => {
  // Given: ship JSON：ready false、reasons 为「1 条 CRITICAL/HIGH 评审未闭环」、review 为 whole-r1 / r9 / c10、
  //        blocking 一条 HIGH a.ts:3 空指针 / 判空、deferred 一条 MEDIUM b.ts:5 命名 / 改名；日期 2026-10-13
  const j = shipJson({ ready: false, reasons: [UNCLOSED], review: { slice: 'whole-r1', agent: 'r9', commit: 'c10' }, blocking: [HIGH], deferred: [MEDIUM] })

  // When: 生成评论
  const text = shipComment(j, { date: '2026-10-13' })

  // Then: 依次含「flight 裁决：draft」「1 条 CRITICAL/HIGH 评审未闭环」「whole-r1」「a.ts:3 — HIGH — 空指针 — 修法：判空」「b.ts:5 — MEDIUM — 命名 — 修法：改名」；
  //       末行为「— flight 插件，2026-10-13」
  const parts = ['flight 裁决：draft', UNCLOSED, 'whole-r1', 'a.ts:3 — HIGH — 空指针 — 修法：判空', 'b.ts:5 — MEDIUM — 命名 — 修法：改名']
  const at = parts.map(p => text.indexOf(p))
  expect(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]))).toBe(true)
  expect(text.trimEnd().split('\n').at(-1)).toBe('— flight 插件，2026-10-13')
})
