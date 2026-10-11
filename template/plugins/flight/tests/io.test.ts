// scenario 来源：spec flight-io（io-*）。io 函数跑在记录调用的假 Io 上；git / python3 / 文件系统由假 Io 作答。
// 不经 ioOf($)：测试侧 $ 只有事件面（无 fs / process），测试 hook 里的 $ 调 fs / process 会被宿主扫描规则拒绝（2.1.295 实测）。
import { expect, test } from 'claude-code/testing'
import { EVENT_TYPES, active, appendEvent, ensureWorktree, eventProblem, flightOfAgent, flights, judge, judgesDir, markPending, ownership, resetOwnership } from '../hooks/io'
import type { Flight, FlightEvent, Io, RunResult } from '../hooks/core'

const MAIN = '/repo'
const CHANGE_TREE = '/repo/.worktrees/demo'
const SLICE = '/repo/.claude/worktrees/flight-demo-S1'
const CHANGE_DIR = 'template/openspec/changes/demo'
const HOOKS = '/repo/template/.claude/hooks'
const HEAD = 'd'.repeat(40)

type Call = { argv: string[]; cwd: string | undefined; stdin: string | undefined; timeoutMs: number | undefined }

function ok(stdout: string): RunResult {
  return { exitCode: 0, stdout, stderr: '' }
}

function fail(stderr: string): RunResult {
  return { exitCode: 1, stdout: '', stderr }
}

function flight(hooksDir: string): Flight {
  return { change: 'demo', mainTree: MAIN, changeTree: CHANGE_TREE, changeDir: CHANGE_DIR, branch: 'worktree-demo', hooksDir, model: 'opus', session: 'sess' }
}

/** 假 Io：files 为存在的路径；updateRefFailures 为前几次 update-ref 旧值不符。 */
function world(w: { files: string[]; updateRefFailures?: number }): { io: Io; calls: Call[] } {
  const calls: Call[] = []
  let updateRefs = 0
  const io: Io = {
    async run(argv, opts = {}) {
      calls.push({ argv: [...argv], cwd: opts.cwd, stdin: opts.stdin, timeoutMs: opts.timeoutMs })
      if (argv[0] === 'python3') return ok('{"ok": true}\n')
      switch (argv[1]) {
        case 'hash-object':
          return ok('b'.repeat(40) + '\n')
        case 'mktree':
          return ok('e'.repeat(40) + '\n')
        case 'rev-parse':
          return ok(HEAD + '\n')
        case 'commit-tree':
          return ok('c'.repeat(40) + '\n')
        case 'update-ref':
          updateRefs += 1
          return updateRefs <= (w.updateRefFailures ?? 0) ? fail('cannot lock ref: is at ffff but expected dddd') : ok('')
        case 'worktree':
          return ok('')
      }
      throw new Error(`unexpected argv: ${argv.join(' ')}`)
    },
    read: async () => undefined,
    write: async () => undefined,
    exists: async path => w.files.includes(path),
  }
  return { io, calls }
}

const DISPATCH: FlightEvent = {
  v: 1,
  ev: 'dispatch',
  change: 'demo',
  at: '2026-10-09T00:00:00Z',
  by: { plugin: 'flight', session: 'sess' },
  attempt: 1,
  slice: 'S1',
  role: 'executor',
  agent: 'a1',
  model: 'claude-opus-5-5',
  worktree: SLICE,
}

// PR #39 评审 HIGH（R2）：写入方与读取方（ledger.py）的 schema 必须对称，坏事件一条就会让整条账本判损坏
test('io-refuses-invalid-event', async () => {
  // Given: 一条 takeoff 事件的 fp 为空串（plan_fp.py 失败时会出现）
  const { io, calls } = world({ files: [] })
  const bad: FlightEvent = {
    v: 1, ev: 'takeoff', change: 'demo', at: '2026-10-10T00:00:00Z', by: { plugin: 'flight', session: 'sess' },
    attempt: 1, fp: '', branch: 'worktree-demo', waves: [['S1']], model: 'opus',
  }

  // When: 追加它
  const r = await appendEvent(io, flight(HOOKS), bad)

  // Then: 返回 false，没有任何 git 调用
  expect(r).toBe(false)
  expect(calls).toEqual([])
})

test('io-refuses-invalid-event/dispatch-without-agent', async () => {
  // Given: 一条 dispatch 事件缺 agent（派发结果没有 agentId 时 JSON 会丢掉这个字段）
  const { io, calls } = world({ files: [] })
  const { agent: _dropped, ...bad } = DISPATCH

  // When: 追加它
  const r = await appendEvent(io, flight(HOOKS), bad as FlightEvent)

  // Then: 返回 false，没有任何 git 调用
  expect(r).toBe(false)
  expect(calls).toEqual([])
})

test('io-runs-judges-from-main-worktree', async () => {
  // Given: 主 worktree /repo 只有 template/.claude/hooks/slice-gate.py，change worktree /repo/.worktrees/demo 里也有一份；起飞时按主 worktree 解析判定器目录
  const { io, calls } = world({ files: [`${HOOKS}/slice-gate.py`, `${CHANGE_TREE}/template/.claude/hooks/slice-gate.py`] })
  const f = flight(await judgesDir(io, MAIN))

  // When: 对切片 worktree /repo/.claude/worktrees/flight-demo-S1 跑 S1 的门禁（超时 600 秒）
  await judge(io, f, 'slice-gate', ['gate', 'S1', '--change-dir', `${SLICE}/${CHANGE_DIR}`], SLICE, 600000)

  // Then: 运行的是 python3 /repo/template/.claude/hooks/slice-gate.py gate S1 …，工作目录是切片 worktree
  expect(calls.map(c => c.argv)).toEqual([['python3', `${HOOKS}/slice-gate.py`, 'gate', 'S1', '--change-dir', `${SLICE}/${CHANGE_DIR}`]])
  expect(calls[0]?.cwd).toBe(SLICE)
})

test('io-appends-event-with-cas-retry', async () => {
  // Given: 链尾为 dddd…；第 1 次 update-ref 旧值不符失败、第 2 次成功
  const { io, calls } = world({ files: [], updateRefFailures: 1 })

  // When: 追加一条 S1 的 dispatch 事件
  const isAppended = await appendEvent(io, flight(HOOKS), DISPATCH)

  // Then: 返回成功；update-ref 共 2 次，每次都以重读到的链尾 dddd… 为旧值；hash-object 写入的 blob 就是该事件的 JSON
  expect(isAppended).toBe(true)
  expect(calls.filter(c => c.argv[1] === 'update-ref').map(c => c.argv.slice(1))).toEqual([
    ['update-ref', 'refs/flight/demo/ledger', 'c'.repeat(40), HEAD],
    ['update-ref', 'refs/flight/demo/ledger', 'c'.repeat(40), HEAD],
  ])
  expect(JSON.parse(calls.find(c => c.argv[1] === 'hash-object')?.stdin ?? '')).toEqual(DISPATCH)
})

test('io-appends-event-gives-up-after-three-conflicts', async () => {
  // Given: update-ref 每次都旧值不符失败
  const { io, calls } = world({ files: [], updateRefFailures: 99 })

  // When: 追加一条 S1 的 dispatch 事件
  const isAppended = await appendEvent(io, flight(HOOKS), DISPATCH)

  // Then: 返回失败，且 update-ref 恰好尝试 3 次
  expect(isAppended).toBe(false)
  expect(calls.filter(c => c.argv[1] === 'update-ref')).toHaveLength(3)
})

test('io-creates-or-reuses-slice-worktree', async () => {
  // Given: change demo 的分支为 worktree-demo，切片 S1 的 worktree /repo/.claude/worktrees/flight-demo-S1 不存在
  const { io, calls } = world({ files: [] })

  // When: 准备 S1 的 worktree
  const r = await ensureWorktree(io, flight(HOOKS), 'S1')

  // Then: 在主 worktree 运行 git worktree add -b flight/demo/S1 /repo/.claude/worktrees/flight-demo-S1 worktree-demo，返回该路径且 created 为真
  expect(calls.map(c => [c.cwd, ...c.argv])).toEqual([[MAIN, 'git', 'worktree', 'add', '-b', 'flight/demo/S1', SLICE, 'worktree-demo']])
  expect(r).toEqual({ path: SLICE, created: true })
})

test('io-reuses-existing-slice-worktree', async () => {
  // Given: 切片 S1 的 worktree /repo/.claude/worktrees/flight-demo-S1 已存在
  const { io, calls } = world({ files: [SLICE] })

  // When: 准备 S1 的 worktree
  const r = await ensureWorktree(io, flight(HOOKS), 'S1')

  // Then: 不运行任何 git 命令，返回同一路径且 created 为假
  expect(calls).toEqual([])
  expect(r).toEqual({ path: SLICE, created: false })
})

const TAKEOFF: FlightEvent = {
  v: 1,
  ev: 'takeoff',
  change: 'demo',
  at: '2026-10-09T00:00:00Z',
  by: { plugin: 'flight', session: 'sess' },
  attempt: 1,
  fp: 'f'.repeat(64),
  branch: 'worktree-demo',
  waves: [['S1']],
  model: 'opus',
}

/** 假 Io：仓库有 refs/flight/demo/ledger（takeoff + agent a1 的 dispatch），worktree 列表为 /repo 与 /repo/.worktrees/demo。 */
/** changeDirs：磁盘上存在的 change 目录；ledger.py 与真实一样 git -C change 目录，目录不存在即失败。 */
function ledgerWorld(changeDirs: string[] = [`${MAIN}/${CHANGE_DIR}`]): Io {
  const porcelain = `worktree ${MAIN}\nHEAD ${HEAD}\nbranch refs/heads/main\n\nworktree ${CHANGE_TREE}\nHEAD ${HEAD}\nbranch refs/heads/worktree-demo\n\n`
  const present = [`${HOOKS}/slice-gate.py`, ...changeDirs]
  return {
    async run(argv) {
      if (argv[0] === 'python3' && argv[1] === `${HOOKS}/ledger.py`)
        return present.includes(String(argv[4])) ? ok([TAKEOFF, DISPATCH].map(e => JSON.stringify(e)).join('\n') + '\n') : fail(`fatal: cannot change to '${argv[4]}'`)
      if (argv.join(' ') === 'git for-each-ref --format=%(refname) refs/flight/') return ok('refs/flight/demo/ledger\n')
      if (argv.join(' ') === 'git -C . worktree list --porcelain') return ok(porcelain)
      throw new Error(`unexpected argv: ${argv.join(' ')}`)
    },
    read: async () => undefined,
    write: async () => undefined,
    exists: async path => present.includes(path),
  }
}

test('io-finds-flight-from-ledger', async () => {
  // Given: 进程内无登记飞行；仓库有 refs/flight/demo/ledger（takeoff branch worktree-demo、model opus、session sess，agent a1 的 dispatch）；worktree 列表 /repo 与 /repo/.worktrees/demo
  flights.clear()
  const io = ledgerWorld()

  // When: 按 agent a1 查找飞行
  const found = await flightOfAgent(io, 'a1')

  // Then: 找到 demo，changeTree 为 /repo/.worktrees/demo、branch worktree-demo、model opus、hooksDir 为主 worktree 的判定器目录；事件即账本两条
  expect(found?.flight).toEqual({ change: 'demo', mainTree: MAIN, changeTree: CHANGE_TREE, changeDir: CHANGE_DIR, branch: 'worktree-demo', hooksDir: HOOKS, model: 'opus', session: 'sess' })
  expect(found?.events).toEqual([TAKEOFF, DISPATCH])
})

test('io-finds-flight-from-ledger/unknown-agent', async () => {
  // Given: 同一仓库与账本，进程内无登记飞行；agent zz 从未被派发
  flights.clear()
  const io = ledgerWorld()

  // When: 按 agent zz 查找飞行
  const found = await flightOfAgent(io, 'zz')

  // Then: 返回空
  expect(found).toBeUndefined()
})

test('io-finds-flight-from-ledger/change-dir-only-in-change-worktree', async () => {
  // Given: 进程内无登记飞行；同一账本；change 目录只在 change worktree /repo/.worktrees/demo 下存在，主 worktree /repo 下没有（未合入的活跃飞行）
  flights.clear()
  const io = ledgerWorld([`${CHANGE_TREE}/${CHANGE_DIR}`])

  // When: 按 agent a1 查找飞行
  const found = await flightOfAgent(io, 'a1')

  // Then: 找到 demo，changeTree 为 /repo/.worktrees/demo、changeDir 为 template/openspec/changes/demo
  expect(found?.flight.changeTree).toBe(CHANGE_TREE)
  expect(found?.flight.changeDir).toBe(CHANGE_DIR)
})

test('io-cas-rereads-tip', async () => {
  // Given: 第 1 次 rev-parse 读到链尾 T1、update-ref 旧值不符；第 2 次 rev-parse 读到 T2、update-ref 成功
  const T1 = '1'.repeat(40)
  const T2 = '2'.repeat(40)
  const calls: string[][] = []
  let revParses = 0
  let updateRefs = 0
  const io: Io = {
    async run(argv) {
      calls.push([...argv])
      switch (argv[1]) {
        case 'hash-object':
          return ok('b'.repeat(40) + '\n')
        case 'mktree':
          return ok('e'.repeat(40) + '\n')
        case 'rev-parse':
          revParses += 1
          return ok((revParses === 1 ? T1 : T2) + '\n')
        case 'commit-tree':
          return ok('c'.repeat(40) + '\n')
        case 'update-ref':
          updateRefs += 1
          return updateRefs === 1 ? fail('cannot lock ref: is at 2222 but expected 1111') : ok('')
      }
      throw new Error(`unexpected argv: ${argv.join(' ')}`)
    },
    read: async () => undefined,
    write: async () => undefined,
    exists: async () => false,
  }

  // When: 追加一条 S1 的 dispatch 事件
  await appendEvent(io, flight(HOOKS), DISPATCH)

  // Then: rev-parse 调 2 次；第 2 次 commit-tree 以 T2 为父；两次 update-ref 旧值依次为 T1、T2
  expect(calls.filter(c => c[1] === 'rev-parse')).toHaveLength(2)
  expect(calls.filter(c => c[1] === 'commit-tree')[1]?.join(' ')).toContain(`-p ${T2}`)
  expect(calls.filter(c => c[1] === 'update-ref').map(c => c[4])).toEqual([T1, T2])
})

test('io-refuses-prototype-ev', async () => {
  // Given: 两条事件的 ev 分别为 toString 与 constructor（Object 原型上的键），其余公共字段合法
  const { io, calls } = world({ files: [] })
  const common = { v: 1, change: 'demo', at: '2026-10-10T00:00:00Z', by: { plugin: 'flight', session: 'sess' } }
  const events = ['toString', 'constructor'].map(ev => ({ ...common, ev }) as FlightEvent)

  // When: 分别追加
  const results = await Promise.all(events.map(e => appendEvent(io, flight(HOOKS), e)))

  // Then: 都返回 false，没有任何 git 调用
  expect(results).toEqual([false, false])
  expect(calls).toEqual([])
})

// ---------------------------------------------------------------- flight-envelope-tightening S3（spec flight-agent-ownership）

/** 假 Io：账本扫描由 ledgerWorld 作答（账本只有 takeoff 与 a1 的 dispatch），追加事件的 git 命令由 world 作答；calls 记录全部调用。 */
function ownershipWorld(): { io: Io; calls: string[][] } {
  const calls: string[][] = []
  const ledger = ledgerWorld()
  const { io: append } = world({ files: [] })
  const APPEND = ['hash-object', 'mktree', 'rev-parse', 'commit-tree', 'update-ref']
  const io: Io = {
    async run(argv, opts) {
      calls.push([...argv])
      return argv[0] === 'git' && APPEND.includes(String(argv[1])) ? append.run(argv, opts) : ledger.run(argv, opts)
    },
    read: async () => undefined,
    write: async () => undefined,
    exists: ledger.exists,
  }
  return { io, calls }
}

test('owner-pending-until-dispatch', async () => {
  // Given: 归属表与进程内飞行清空；markPending('agent-9', 'demo')；账本里还没有 agent-9 的 dispatch
  resetOwnership()
  flights.clear()
  const { io } = ownershipWorld()
  markPending('agent-9', 'demo')
  const dispatch: FlightEvent = { ...DISPATCH, slice: 'S2', agent: 'agent-9', worktree: '/W2' }

  // When: 查询 agent-9 的归属；写入 agent-9 的 dispatch（S2、worktree /W2）后再查询
  const first = await ownership(io, 'agent-9')
  await appendEvent(io, flight(HOOKS), dispatch)
  const second = await ownership(io, 'agent-9')

  // Then: 第一次为登记中（change demo）；第二次为 { change demo、executor、S2、/W2 } 的正式归属
  expect(first).toEqual({ pending: true, change: 'demo' })
  expect(second).toEqual({ change: 'demo', role: 'executor', slice: 'S2', worktree: '/W2' })
})

test('owner-miss-cached-until-dispatch', async () => {
  // Given: 归属表与进程内飞行清空；账本只有 takeoff 与 a1 的 dispatch，没有 agent-x 的 dispatch；已查过一次 agent-x（未命中）
  resetOwnership()
  flights.clear()
  const { io, calls } = ownershipWorld()
  await ownership(io, 'agent-x')
  const afterFirst = calls.length

  // When: 再查 agent-x；写入 a1 的 dispatch；再查一次 agent-x
  const second = await ownership(io, 'agent-x')
  const afterSecond = calls.length
  await appendEvent(io, flight(HOOKS), DISPATCH)
  const afterAppend = calls.length
  const third = await ownership(io, 'agent-x')

  // Then: 第二次未命中且没有任何调用（未读账本）；dispatch 写入后的那次查询重新读了账本（又运行了 ledger.py），结果仍未命中
  expect(second).toBeUndefined()
  expect(afterSecond).toBe(afterFirst)
  expect(calls.slice(afterAppend).some(c => c[0] === 'python3' && c[1] === `${HOOKS}/ledger.py`)).toBe(true)
  expect(third).toBeUndefined()
})

// ---------------------------------------------------------------- flight-measure S5（spec flight-ownership-fail-closed · flight-measure）

test('ledger-read-failure-not-cached', async () => {
  // Given: 归属表清空；demo 是本进程登记的在飞飞行（flights 与 active 都有）；ledger.py show 第一次退出 5（stderr "ledger: 损坏"）、之后返回 takeoff 与 agent-7 的 dispatch（S1、worktree W1）；refs/flight/ 下只有 demo 的账本；已查过一次 agent-7
  resetOwnership()
  flights.clear()
  active.clear()
  flights.set('demo', flight(HOOKS))
  active.set('demo', { change: 'demo', changeTree: CHANGE_TREE, slicePrefix: '/repo/.claude/worktrees/flight-demo-' })
  const dispatch: FlightEvent = { ...DISPATCH, agent: 'agent-7', slice: 'S1', worktree: 'W1' }
  let shows = 0
  const io: Io = {
    async run(argv) {
      if (argv[0] === 'python3' && argv[1] === `${HOOKS}/ledger.py`) {
        shows += 1
        return shows === 1 ? { exitCode: 5, stdout: '', stderr: 'ledger: 损坏' } : ok([TAKEOFF, dispatch].map(e => JSON.stringify(e)).join('\n') + '\n')
      }
      if (argv.join(' ') === 'git for-each-ref --format=%(refname) refs/flight/') return ok('refs/flight/demo/ledger\n')
      throw new Error(`unexpected argv: ${argv.join(' ')}`)
    },
    read: async () => undefined,
    write: async () => undefined,
    exists: async () => false,
  }
  const first = await ownership(io, 'agent-7')

  // When: 再查一次 agent-7 的归属
  const second = await ownership(io, 'agent-7')

  // Then: 第一次为判不出（change demo、原因即 stderr）；第二次重新读账本，得到 demo / executor / S1 / W1 的正式归属
  expect(first).toEqual({ unknown: true, change: 'demo', error: 'ledger: 损坏' })
  expect(second).toEqual({ change: 'demo', role: 'executor', slice: 'S1', worktree: 'W1' })
  flights.clear()
  active.clear()
})

const MEASURE: FlightEvent = {
  v: 1,
  ev: 'measure',
  change: 'demo',
  at: '2026-10-10T00:00:00Z',
  by: { plugin: 'flight', session: 'sess' },
  attempt: 1,
  slice: 'S1',
  agent: 'a1',
  base: 'a'.repeat(40),
  commit: '',
  outcomes: [['tests/test_x.py::test_a', 'FAILED'], ['tests/test_x.py::test_b', 'MISSING']],
  changed: ['tests/test_x.py'],
  source: [],
}

test('measure-event-checked-before-write', async () => {
  // Given: 一条字段齐全的 measure 事件，与一条同样内容但缺 base 的 measure 事件
  const { io, calls } = world({ files: [] })
  const { base: _dropped, ...noBase } = MEASURE

  // When: 分别追加这两条事件
  const results = await Promise.all([MEASURE, noBase as FlightEvent].map(e => appendEvent(io, flight(HOOKS), e)))

  // Then: 齐全的写入成功、缺 base 的返回 false；git hash-object 只调用一次，写入的正是齐全那条
  expect(results).toEqual([true, false])
  expect(calls.filter(c => c.argv[1] === 'hash-object').map(c => JSON.parse(c.stdin ?? ''))).toEqual([MEASURE])
})

test('measure-event-checked-before-write/reason', () => {
  // Given: 一条缺 base 的 measure 事件
  const { base: _dropped, ...noBase } = MEASURE

  // When: 求它的不合规原因
  const why = eventProblem(noBase as FlightEvent, 'demo')

  // Then: 原因为「measure 的 base 不是非空字符串」
  expect(why).toBe('measure 的 base 不是非空字符串')
})

test('measure-event-checked-before-write/bad-outcome', () => {
  // Given: 一条 measure 事件的 outcomes 为 [['tests/test_x.py::test_a', 'PASS']]（PASS 不在状态集合里）
  const bad: FlightEvent = { ...MEASURE, outcomes: [['tests/test_x.py::test_a', 'PASS']] }

  // When: 求它的不合规原因
  const why = eventProblem(bad, 'demo')

  // Then: 原因以「measure 的 outcomes」开头
  expect(why?.startsWith('measure 的 outcomes')).toBe(true)
})

test('event-types-exported', () => {
  // Given: 写入校验的事件字段表（approve 至 halt 共 11 种，再加 measure）

  // When: 读取导出的 EVENT_TYPES 并排序
  const types = [...EVENT_TYPES].sort()

  // Then: 恰为这 12 种事件类型
  expect(types).toEqual(['approve', 'blocked', 'dispatch', 'ended', 'final', 'gate', 'halt', 'land', 'measure', 'merge', 'review', 'takeoff'])
})
