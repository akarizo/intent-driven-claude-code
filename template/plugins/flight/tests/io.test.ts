// scenario 来源：spec flight-io（io-*）。io 函数跑在记录调用的假 Io 上；git / python3 / 文件系统由假 Io 作答。
// 不经 ioOf($)：测试侧 $ 只有事件面（无 fs / process），测试 hook 里的 $ 调 fs / process 会被宿主扫描规则拒绝（2.1.295 实测）。
import { expect, test } from 'claude-code/testing'
import { appendEvent, ensureWorktree, judge, judgesDir } from '../hooks/io'
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
