// scenario 来源：spec flight-io（io-*）。io 函数跑在记录调用的假 Io 上；git / python3 / 文件系统由假 Io 作答。
// 不经 ioOf($)：测试侧 $ 只有事件面（无 fs / process），测试 hook 里的 $ 调 fs / process 会被宿主扫描规则拒绝（2.1.295 实测）。
import { expect, test } from 'claude-code/testing'
import { appendEvent, ensureWorktree, flightOfAgent, flights, judge, judgesDir } from '../hooks/io'
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
