// scenario 来源：spec flight-integration（land-*）。land.ts 只经 Io 做副作用，这里用假 Io 记录调用、按 argv 返回预设结果。
import { expect, test } from 'claude-code/testing'
import { classifyDirty, closeout, commitArtifacts, commitRecords, finishResolve, mergeFix, mergeSlice, prepareResolve, validateFindings } from '../hooks/land'
import type { Flight, GateJson, Io, RunResult } from '../hooks/core'

const CT = '/repo/.worktrees/demo'
const CD = 'template/openspec/changes/demo'
const HOOKS = `${CT}/template/.claude/hooks`
const F: Flight = { change: 'demo', mainTree: '/repo', changeTree: CT, changeDir: CD, branch: 'worktree-demo', hooksDir: HOOKS, model: 'opus', session: 'sess' }
const RESOLVE = '/repo/.claude/worktrees/flight-demo-S2-resolve'

type Call = { argv: string[]; cwd?: string }
type Respond = (argv: string[]) => Partial<RunResult> | undefined

function fakeIo(files: Record<string, string>, respond: Respond) {
  const calls: Call[] = []
  const fs = new Map(Object.entries(files))
  const io: Io = {
    async run(argv, opts) {
      calls.push({ argv: [...argv], cwd: opts?.cwd })
      // 合回前的检查：未预设时第一父链上没有以切片尖端为第二父的合并提交（未合入过）、分叉点为 b0、合并结果树 t-merged 与 HEAD 的树 t-head 不同
      // rev-parse --verify 查分支：未预设时分支不存在
      const preset = argv.includes('merge-base') ? { stdout: 'b0\n' } : argv.includes('merge-tree') ? { stdout: 't-merged\n' } : argv.includes('HEAD^{tree}') ? { stdout: 't-head\n' }
        : argv.some(a => a.startsWith('refs/heads/')) ? { exitCode: 1 } : {}
      return { exitCode: 0, stdout: '', stderr: '', ...preset, ...(respond([...argv]) ?? {}) }
    },
    async read(p) {
      return fs.get(p)
    },
    async write(p, t) {
      fs.set(p, t)
    },
    async exists(p) {
      return fs.has(p)
    },
  }
  return { io, calls, fs }
}

/** argv 含全部这些项时为真；项可写成路径的末段（如 timeline.py 匹配 <hooks>/timeline.py） */
const has = (argv: string[], ...parts: string[]) => parts.every(p => argv.some(a => a === p || a.endsWith(`/${p}`)))
const find = (calls: Call[], ...parts: string[]) => calls.findIndex(c => has(c.argv, ...parts))

const gateOf = (slice: string): GateJson => ({ slice, ok: true, commit: `c-${slice}`, failed: [] })

test('land-merges-green-slice', async () => {
  // Given: change 目录里 gate-report.md 未提交（status 输出一行）、合并后 HEAD 为 m1；S1 的 owns 为 src/a.py（含 `def run(x):`）与 tests/test_a.py；S1 门禁绿
  const status = ` M ${CD}/gate-report.md\n`
  const { io, calls, fs } = fakeIo({ [`${CT}/src/a.py`]: 'import os\ndef run(x):\n    return x\n', [`${CT}/tests/test_a.py`]: 'def test_run():\n' }, argv =>
    has(argv, 'status') ? { stdout: status } : has(argv, 'rev-parse', 'HEAD') ? { stdout: 'm1\n' } : undefined,
  )
  const gate = gateOf('S1')

  // When: 合回 S1
  const result = await mergeSlice(io, F, 'S1', gate, ['src/a.py', 'tests/test_a.py'])

  // Then: 只 add gate-report.md 并提交「chore(flight): 记录」，之后 merge --no-ff flight/demo/S1；不运行 record；
  //       _interfaces.md 的 S1 一节含 def run(x): 且不含测试文件；返回 ok 与 m1
  const add = calls[find(calls, 'add')]
  expect(add.argv).toEqual(['git', '-C', CT, 'add', '--', `${CT}/${CD}/gate-report.md`])
  const order = [find(calls, 'add'), find(calls, 'commit', 'chore(flight): 记录'), find(calls, 'merge', '--no-ff')]
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true)
  expect(calls[order[2]].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', 'flight/demo/S1', '-m', 'integrate: S1'])
  expect(find(calls, 'record')).toBe(-1)
  const summary = fs.get(`${CT}/${CD}/slices/_interfaces.md`) ?? ''
  expect(summary).toContain('## S1\n')
  expect(summary).toContain('def run(x):')
  expect(summary).not.toContain('test_run')
  expect(result).toEqual({ ok: true, commit: 'm1' })
})

test('land-reports-conflict-and-aborts', async () => {
  // Given: 合回 S2 时 git merge 退出 1，diff --diff-filter=U 输出 a.py；飞行记录无改动
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'merge', '--no-ff') ? { exitCode: 1, stderr: 'CONFLICT (content): a.py' } : has(argv, '--diff-filter=U') ? { stdout: 'a.py\n' } : undefined,
  )

  // When: 合回 S2
  const result = await mergeSlice(io, F, 'S2', gateOf('S2'), [])

  // Then: change worktree 里运行了 merge --abort，未运行 record；返回冲突 [a.py]，failed 为 conflict: a.py
  expect(find(calls, 'merge', '--abort')).toBeGreaterThan(-1)
  expect(find(calls, 'record')).toBe(-1)
  expect(result).toEqual({ ok: false, conflicts: ['a.py'], failed: ['conflict: a.py'] })
})

test('land-reports-non-conflict-merge-failure', async () => {
  // Given: git merge 退出 1，stderr 首行为 merge: flight/demo/S2 - not something we can merge；没有未合并文件
  const { io, calls } = fakeIo({}, argv => (has(argv, 'merge', '--no-ff') ? { exitCode: 1, stderr: 'merge: flight/demo/S2 - not something we can merge\nmore' } : undefined))

  // When: 合回 S2
  const result = await mergeSlice(io, F, 'S2', gateOf('S2'), [])

  // Then: 不运行 merge --abort；返回失败，failed 含 stderr 首行
  expect(find(calls, 'merge', '--abort')).toBe(-1)
  expect(result).toEqual({ ok: false, conflicts: [], failed: ['git merge 失败：merge: flight/demo/S2 - not something we can merge'] })
})

test('land-refuses-direct-commit-in-owns', async () => {
  // Given: S2 的分叉点为 b0；change 分支自 b0 以来的第一父链上，非合并提交 466cf98 改了 S2 owns 内的 landing.tsx，记录提交 0247ab7 只改了 timeline.md
  const log = `@466cf98\n\ntemplate/plugins/flight/hooks/landing.tsx\n@0247ab7\n\n${CD}/timeline.md\n`
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'merge-base', 'HEAD', 'flight/demo/S2') ? { stdout: 'b0\n' } : has(argv, 'log', '--first-parent', '--no-merges', 'b0..HEAD') ? { stdout: log } : undefined,
  )

  // When: 合回 S2（owns 含 landing.tsx 与整个 change 目录）
  const result = await mergeSlice(io, F, 'S2', gateOf('S2'), ['template/plugins/flight/hooks/landing.tsx', `${CD}/**`])

  // Then: 不运行 merge --no-ff 与 record；返回失败，failed 指出 466cf98 与 landing.tsx，不提记录提交 0247ab7
  expect(find(calls, 'merge', '--no-ff')).toBe(-1)
  expect(find(calls, 'record')).toBe(-1)
  expect(result.ok).toBe(false)
  const failed = result.ok ? '' : result.failed.join('\n')
  expect(failed).toContain('466cf98 template/plugins/flight/hooks/landing.tsx')
  expect(failed).not.toContain('0247ab7')
})

test('land-records-already-integrated-slice', async () => {
  // Given: 切片分支 flight/demo/S1 的尖端 tip1 是 HEAD 第一父链上合并提交的第二父（上一 attempt 已 integrate，账本缺 merge 事件）；合并结果树与 HEAD 的树相同；HEAD 为 m1
  const { io, calls, fs } = fakeIo({ [`${CT}/src/a.py`]: 'def run(x):\n' }, argv =>
    has(argv, 'rev-parse', 'flight/demo/S1') ? { stdout: 'tip1\n' }
        : has(argv, 'log', '--first-parent', '--merges', 'tip1..HEAD') ? { stdout: 'p1 tip1\n' }
          : has(argv, 'merge-tree') ? { stdout: 't1\n' } : has(argv, 'rev-parse', 'HEAD^{tree}') ? { stdout: 't1\n' }
            : has(argv, 'rev-parse', 'HEAD') ? { stdout: 'm1\n' } : undefined,
  )
  const gate = gateOf('S1')

  // When: 合回 S1
  const result = await mergeSlice(io, F, 'S1', gate, ['src/a.py'])

  // Then: 不运行 merge --no-ff 与空合回检查，不运行 record，照常刷新接口摘要；返回 ok 与 m1
  expect(find(calls, 'merge', '--no-ff')).toBe(-1)
  expect(find(calls, 'merge-tree')).toBe(-1)
  expect(find(calls, 'record')).toBe(-1)
  expect(fs.get(`${CT}/${CD}/slices/_interfaces.md`) ?? '').toContain('## S1\n')
  expect(result).toEqual({ ok: true, commit: 'm1' })
})

test('land-refuses-zero-commit-slice-as-integrated', async () => {
  // Given: 切片分支 flight/demo/S2 没有自己的提交：尖端 x0 就是派发时的 change 分支尖端，在第一父链上，不是任何合并提交的第二父
  //        （x0..HEAD 第一父链上唯一的合并提交 p1 的第二父是 s1tip）；执行体把改动留在工作区或直接提交进了 change 分支，合并结果树与 HEAD 的树相同
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'rev-parse', 'flight/demo/S2') ? { stdout: 'x0\n' }
        : has(argv, 'log', '--first-parent', '--merges', 'x0..HEAD') ? { stdout: 'p1 s1tip\n' }
          : has(argv, 'merge-tree') ? { stdout: 't1\n' } : has(argv, 'rev-parse', 'HEAD^{tree}') ? { stdout: 't1\n' } : undefined,
  )

  // When: 合回 S2
  const result = await mergeSlice(io, F, 'S2', gateOf('S2'), ['a.py'])

  // Then: 不当作已合回：不 record、不 merge --no-ff；返回失败，写明合回对第一父无变更
  expect(find(calls, 'record')).toBe(-1)
  expect(find(calls, 'merge', '--no-ff')).toBe(-1)
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.failed.join('\n')).toContain('合回对第一父无变更')
})

test('land-refuses-merge-without-change', async () => {
  // Given: 第一父链上没有改动 S5 owns 的直接提交；merge-tree 算出的合并结果树 t1 与 HEAD 的树相同（S5 的改动已以别的路径进了 change 分支）
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'merge-tree', '--write-tree', 'HEAD', 'flight/demo/S5') ? { stdout: 't1\n' } : has(argv, 'rev-parse', 'HEAD^{tree}') ? { stdout: 't1\n' } : undefined,
  )

  // When: 合回 S5
  const result = await mergeSlice(io, F, 'S5', gateOf('S5'), ['docs/a.md'])

  // Then: 不运行 merge --no-ff 与 record；返回失败，failed 写明合回对第一父无变更
  expect(find(calls, 'merge', '--no-ff')).toBe(-1)
  expect(find(calls, 'record')).toBe(-1)
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.failed.join('\n')).toContain('合回对第一父无变更')
})

test('land-aborts-conflict-and-prepares-resolver', async () => {
  // Given: S2 合回因 a.py 冲突；在解冲突 worktree 里重做合并时 git merge 退出 1，diff --diff-filter=U 输出 a.py
  const { io, calls } = fakeIo({}, argv =>
    has(argv, RESOLVE, 'merge', '--no-ff') ? { exitCode: 1 } : has(argv, RESOLVE, '--diff-filter=U') ? { stdout: 'a.py\n' } : undefined,
  )

  // When: 准备 S2 的解冲突现场
  const result = await prepareResolve(io, F, 'S2')

  // Then: change worktree 里 merge --abort；基于 worktree-demo 建 flight-demo-S2-resolve（分支 flight/demo/S2-resolve）；在其中 merge --no-ff flight/demo/S2；返回该路径与冲突 [a.py]
  expect(calls[find(calls, 'merge', '--abort')].argv).toEqual(['git', '-C', CT, 'merge', '--abort'])
  expect(calls[find(calls, 'worktree', 'add')].argv).toEqual(['git', '-C', CT, 'worktree', 'add', '-b', 'flight/demo/S2-resolve', RESOLVE, 'worktree-demo'])
  expect(calls[find(calls, RESOLVE, 'merge', '--no-ff')].argv).toEqual(['git', '-C', RESOLVE, 'merge', '--no-ff', 'flight/demo/S2', '-m', 'integrate: S2'])
  expect(result).toEqual({ path: RESOLVE, conflicts: ['a.py'], branch: 'flight/demo/S2-resolve' })
})

test('land-prepare-resolve-reports-non-conflict-failure', async () => {
  // Given: 解冲突 worktree 里重做 S2 合并时 git merge 退出 1，stderr 首行为 merge: flight/demo/S2 - not something we can merge；diff --diff-filter=U 无输出
  const { io } = fakeIo({}, argv =>
    has(argv, RESOLVE, 'merge', '--no-ff') ? { exitCode: 1, stderr: 'merge: flight/demo/S2 - not something we can merge\nmore' } : undefined,
  )

  // When: 准备 S2 的解冲突现场
  const result = await prepareResolve(io, F, 'S2')

  // Then: 返回 error「git merge 失败：<stderr 首行>」，不含冲突列表
  expect(result).toEqual({ error: 'git merge 失败：merge: flight/demo/S2 - not something we can merge' })
})

test('land-prepare-resolve-rejects-clean-merge', async () => {
  // Given: 解冲突 worktree 里重做 S2 合并时 git merge 退出 0（意外地无冲突）
  const { io } = fakeIo({}, () => undefined)

  // When: 准备 S2 的解冲突现场
  const result = await prepareResolve(io, F, 'S2')

  // Then: 返回 error「解冲突现场合并意外成功：无需解冲突」
  expect(result).toEqual({ error: '解冲突现场合并意外成功：无需解冲突' })
})

test('land-commits-only-records', async () => {
  // Given: status 报 change 目录的 slices/_interfaces.md 有改动，以及 change 目录外的 src/x.py 有改动
  const status = ` M ${CD}/slices/_interfaces.md\n M src/x.py\n`
  const { io, calls } = fakeIo({}, argv => (has(argv, 'status') ? { stdout: status } : undefined))

  // When: 以「chore(flight): 记录」提交飞行记录
  const result = await commitRecords(io, F, 'chore(flight): 记录')

  // Then: 只 add change 目录内的 _interfaces.md；commit 带同一路径与该消息；返回 undefined
  expect(calls[find(calls, 'add')].argv).toEqual(['git', '-C', CT, 'add', '--', `${CT}/${CD}/slices/_interfaces.md`])
  expect(calls[find(calls, 'commit')].argv).toEqual(['git', '-C', CT, 'commit', '-m', 'chore(flight): 记录', '--', `${CT}/${CD}/slices/_interfaces.md`])
  expect(result).toBeUndefined()
})

test('land-commits-only-records/no-changes', async () => {
  // Given: status 无输出（没有未提交的飞行记录）
  const { io, calls } = fakeIo({}, () => undefined)

  // When: 以「chore(flight): 记录」提交飞行记录
  const result = await commitRecords(io, F, 'chore(flight): 记录')

  // Then: 不运行 git commit；返回 undefined
  expect(find(calls, 'commit')).toBe(-1)
  expect(result).toBeUndefined()
})

test('land-fast-forwards-after-resolution', async () => {
  // Given: 解冲突 worktree 无未合并文件，rev-list --parents 输出三个字段（HEAD 有两个父）；快进后 HEAD 为r2
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'rev-list', '--parents') ? { stdout: 'r2 p1 p2\n' } : has(argv, 'rev-parse', 'HEAD') ? { stdout: 'r2\n' } : undefined,
  )

  // When: 完成 S2 的合回
  const result = await finishResolve(io, F, 'S2', gateOf('S2'), [])

  // Then: change worktree 里运行 merge --ff-only flight/demo/S2-resolve，不运行 record；返回 ok 与 r2
  const ff = find(calls, 'merge', '--ff-only')
  expect(calls[ff].argv).toEqual(['git', '-C', CT, 'merge', '--ff-only', 'flight/demo/S2-resolve'])
  expect(find(calls, 'record')).toBe(-1)
  expect(result).toEqual({ ok: true, commit: 'r2' })
})

test('land-refuses-ff-with-unmerged-files', async () => {
  // Given: 解冲突 worktree 的 diff --diff-filter=U 仍输出 a.py，rev-list --parents 输出三个字段
  const { io, calls } = fakeIo({}, argv =>
    has(argv, '--diff-filter=U') ? { stdout: 'a.py\n' } : has(argv, 'rev-list', '--parents') ? { stdout: 'r2 p1 p2\n' } : undefined,
  )

  // When: 完成 S2 的合回
  const result = await finishResolve(io, F, 'S2', gateOf('S2'), [])

  // Then: 没有运行 --ff-only；返回失败且原因点名 a.py
  expect(find(calls, '--ff-only')).toBe(-1)
  expect(result).toEqual({ ok: false, failed: ['解冲突未完成：仍有未合并文件 a.py'] })
})

test('land-refuses-ff-without-merge-commit', async () => {
  // Given: 解冲突 worktree 无未合并文件，但 rev-list --parents 只输出两个字段（HEAD 不是合并提交）
  const { io, calls } = fakeIo({}, argv => (has(argv, 'rev-list', '--parents') ? { stdout: 'r2 p1\n' } : undefined))

  // When: 完成 S2 的合回
  const result = await finishResolve(io, F, 'S2', gateOf('S2'), [])

  // Then: 没有运行 --ff-only；返回失败且原因说明 HEAD 不是合并提交
  expect(find(calls, '--ff-only')).toBe(-1)
  expect(result).toEqual({ ok: false, failed: ['解冲突未完成：HEAD 不是合并提交'] })
})

test('land-merges-fix', async () => {
  // Given: 飞行记录无改动，修复合并后 HEAD 为 f1
  const { io, calls } = fakeIo({}, argv => (has(argv, 'rev-parse', 'HEAD') ? { stdout: 'f1\n' } : undefined))

  // When: 以备注 blocking=2 合回修复
  const result = await mergeFix(io, F, 'blocking=2')

  // Then: merge --no-ff flight/demo/fix -m "integrate: fix"；不运行 timeline.py；返回 ok 与 f1
  const m = find(calls, 'merge', '--no-ff')
  expect(calls[m].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', 'flight/demo/fix', '-m', 'integrate: fix'])
  expect(find(calls, 'timeline.py')).toBe(-1)
  expect(result).toEqual({ ok: true, commit: 'f1' })
})

const S1_A2 = 'flight/demo/S1-a2'
const RESOLVE_S1 = '/repo/.claude/worktrees/flight-demo-S1-resolve'
const RESOLVE_S1_A2 = '/repo/.claude/worktrees/flight-demo-S1-resolve-a2'

test('merges-use-recorded-branch', async () => {
  // Given: S1 这一轮在分支 flight/demo/S1-a2 上；飞行记录无改动，未合入过，合并后 HEAD 为 m2
  const { io, calls } = fakeIo({}, argv => (has(argv, 'rev-parse', 'HEAD') ? { stdout: 'm2\n' } : undefined))

  // When: 传入记下的分支 flight/demo/S1-a2 合回 S1
  const result = await mergeSlice(io, F, 'S1', gateOf('S1'), [], S1_A2)

  // Then: merge --no-ff 合并的是 flight/demo/S1-a2；任何 git 调用都不出现 flight/demo/S1；返回 ok 与 m2
  expect(calls[find(calls, 'merge', '--no-ff')].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', S1_A2, '-m', 'integrate: S1'])
  expect(calls.filter(c => c.argv.includes('flight/demo/S1'))).toEqual([])
  expect(result).toEqual({ ok: true, commit: 'm2' })
})

test('merges-use-recorded-branch/resolve', async () => {
  // Given: 解冲突 worktree flight-demo-S1-resolve 已存在（上一轮留下）；新解冲突现场里合并 flight/demo/S1-a2 时 git merge 退出 1，diff --diff-filter=U 输出 a.py
  const { io, calls } = fakeIo({ [RESOLVE_S1]: '' }, argv =>
    has(argv, RESOLVE_S1_A2, 'merge', '--no-ff') ? { exitCode: 1 } : has(argv, RESOLVE_S1_A2, '--diff-filter=U') ? { stdout: 'a.py\n' } : undefined,
  )

  // When: 以 attempt 2、分支 flight/demo/S1-a2 准备 S1 的解冲突现场
  const result = await prepareResolve(io, F, 'S1', { branch: S1_A2, attempt: 2 })

  // Then: 基于 worktree-demo 另建 flight-demo-S1-resolve-a2（分支 flight/demo/S1-resolve-a2）；在其中 merge --no-ff flight/demo/S1-a2；不碰旧的 flight-demo-S1-resolve；返回新路径、冲突 [a.py] 与解冲突分支
  expect(calls[find(calls, 'worktree', 'add')].argv).toEqual(['git', '-C', CT, 'worktree', 'add', '-b', 'flight/demo/S1-resolve-a2', RESOLVE_S1_A2, 'worktree-demo'])
  expect(calls[find(calls, RESOLVE_S1_A2, 'merge', '--no-ff')].argv).toEqual(['git', '-C', RESOLVE_S1_A2, 'merge', '--no-ff', S1_A2, '-m', 'integrate: S1'])
  expect(calls.filter(c => c.argv.includes(RESOLVE_S1))).toEqual([])
  expect(result).toEqual({ path: RESOLVE_S1_A2, conflicts: ['a.py'], branch: 'flight/demo/S1-resolve-a2' })
})

test('merges-use-recorded-branch/resolve-branch-left', async () => {
  // Given: 解冲突 worktree flight-demo-S1-resolve 已被人删掉，但分支 flight/demo/S1-resolve 还在；
  //   新解冲突现场里合并 flight/demo/S1-a2 时 git merge 退出 1，diff --diff-filter=U 输出 a.py
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'refs/heads/flight/demo/S1-resolve') ? { exitCode: 0 }
      : has(argv, RESOLVE_S1_A2, 'merge', '--no-ff') ? { exitCode: 1 } : has(argv, RESOLVE_S1_A2, '--diff-filter=U') ? { stdout: 'a.py\n' } : undefined,
  )

  // When: 以 attempt 2、分支 flight/demo/S1-a2 准备 S1 的解冲突现场
  const result = await prepareResolve(io, F, 'S1', { branch: S1_A2, attempt: 2 })

  // Then: 不按原名建（worktree add -b 会撞上已有分支），另建 flight-demo-S1-resolve-a2（分支 flight/demo/S1-resolve-a2）；返回新路径、冲突 [a.py] 与解冲突分支
  expect(calls[find(calls, 'worktree', 'add')].argv).toEqual(['git', '-C', CT, 'worktree', 'add', '-b', 'flight/demo/S1-resolve-a2', RESOLVE_S1_A2, 'worktree-demo'])
  expect(result).toEqual({ path: RESOLVE_S1_A2, conflicts: ['a.py'], branch: 'flight/demo/S1-resolve-a2' })
})

test('merges-use-recorded-branch/finish', async () => {
  // Given: 解冲突现场为 flight-demo-S1-resolve-a2（分支 flight/demo/S1-resolve-a2），无未合并文件、HEAD 有两个父；快进后 HEAD 为 r3
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'rev-list', '--parents') ? { stdout: 'r3 p1 p2\n' } : has(argv, 'rev-parse', 'HEAD') ? { stdout: 'r3\n' } : undefined,
  )

  // When: 传入该解冲突现场完成 S1 的合回
  const result = await finishResolve(io, F, 'S1', gateOf('S1'), [], { path: RESOLVE_S1_A2, branch: 'flight/demo/S1-resolve-a2' })

  // Then: 在 flight-demo-S1-resolve-a2 里查未合并文件；change worktree 里 merge --ff-only flight/demo/S1-resolve-a2；返回 ok 与 r3
  expect(calls[find(calls, '--diff-filter=U')].argv).toEqual(['git', '-C', RESOLVE_S1_A2, 'diff', '--name-only', '--diff-filter=U'])
  expect(calls[find(calls, 'merge', '--ff-only')].argv).toEqual(['git', '-C', CT, 'merge', '--ff-only', 'flight/demo/S1-resolve-a2'])
  expect(result).toEqual({ ok: true, commit: 'r3' })
})

test('merges-use-recorded-branch/fix', async () => {
  // Given: 修复体这一轮在分支 flight/demo/fix-a2 上；飞行记录无改动，合并后 HEAD 为 f2
  const { io, calls } = fakeIo({}, argv => (has(argv, 'rev-parse', 'HEAD') ? { stdout: 'f2\n' } : undefined))

  // When: 以备注 blocking=1、分支 flight/demo/fix-a2 合回修复
  const result = await mergeFix(io, F, 'blocking=1', 'flight/demo/fix-a2')

  // Then: merge --no-ff 合并的是 flight/demo/fix-a2；返回 ok 与 f2
  expect(calls[find(calls, 'merge', '--no-ff')].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', 'flight/demo/fix-a2', '-m', 'integrate: fix'])
  expect(result).toEqual({ ok: true, commit: 'f2' })
})

test('merges-write-no-records', async () => {
  // Given: 两个世界，飞行记录都无改动；世界一 S1 分支 flight/demo/S1 未合入过、可干净合并，合并后 HEAD 为 m1；世界二修复分支 flight/demo/fix-r1 可干净合并，合并后 HEAD 为 f1
  const one = fakeIo({}, argv => (has(argv, 'rev-parse', 'HEAD') ? { stdout: 'm1\n' } : undefined))
  const two = fakeIo({}, argv => (has(argv, 'rev-parse', 'HEAD') ? { stdout: 'f1\n' } : undefined))

  // When: 世界一合回 S1（门禁绿、owns 为空），世界二以备注 blocking=1、slice fix-r1 调用 mergeFix
  const results = await Promise.all([mergeSlice(one.io, F, 'S1', gateOf('S1'), []), mergeFix(two.io, F, 'blocking=1', undefined, 'fix-r1')])

  // Then: 两次分别返回 ok 与 m1、ok 与 f1；两个世界都没有 slice-gate.py record 调用，也没有任何 timeline.py 调用
  expect(results).toEqual([{ ok: true, commit: 'm1' }, { ok: true, commit: 'f1' }])
  expect([...one.calls, ...two.calls].filter(c => has(c.argv, 'slice-gate.py', 'record') || has(c.argv, 'timeline.py'))).toEqual([])
})

const finding = (severity: string) =>({ severity, file: 'a.py', line: 3, summary: 's', fix: 'f' })

test('land-validates-findings', () => {
  // Given: findings 两项，第 1 项合法，第 2 项 severity 为 "SEVERE"
  const input = { findings: [finding('LOW'), finding('SEVERE')] }

  // When: 校验
  const result = validateFindings(input)

  // Then: 拒绝，理由含「第 2 项」与 severity
  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.error).toContain('第 2 项的 severity')
})

test('land-accepts-empty-findings', () => {
  // Given: 输入为 {findings: []}
  const input = { findings: [] }

  // When: 校验
  const result = validateFindings(input)

  // Then: 接受，findings 为空列表
  expect(result).toEqual({ ok: true, findings: [] })
})

test('land-rejects-non-integer-line', () => {
  // Given: findings 只有一项，line 为 "3"（字符串）
  const input = { findings: [{ ...finding('HIGH'), line: '3' }] }

  // When: 校验
  const result = validateFindings(input)

  // Then: 拒绝，理由含「第 1 项的 line」
  expect(result.ok ? '' : result.error).toContain('第 1 项的 line')
})

test('land-closeout-writes-records', async () => {
  // Given: tasks.md 有 S1、S2、S3 三个未勾选行；S1、S2 已合回，S3 被阻断（gate，G7 x）；阻断项 0、deferred 1 条 LOW、无修复；
  //        status 报 tasks.md 与 review-findings.json 有改动；ship 退出 0、stdout 为 ready 的 JSON（blocked [S3]、deferred [LOW]、reasons 空）
  const tasks = '# tasks\n- [ ] S1 甲\n- [ ] S2 乙\n- [ ] S3 丙\n'
  const status = ` M ${CD}/tasks.md\n?? ${CD}/review-findings.json\n`
  const low = { severity: 'LOW' as const, file: 'a.py', line: 1, summary: 's', fix: 'f' }
  const lists = { blocked: [{ slice: 'S3', kind: 'gate' as const, reason: 'G7 x' }], blocking: [], deferred: [low], fix: null }
  const ship = JSON.stringify({ ready: true, commit: 'h1', reasons: [], ...lists, review: null })
  const { io, calls, fs } = fakeIo({ [`${CT}/${CD}/tasks.md`]: tasks }, argv =>
    has(argv, 'status') ? { stdout: status } : has(argv, 'ship') ? { stdout: ship + '\n' } : undefined,
  )

  // When: 落地收口
  const result = await closeout(io, F, ['S1', 'S2'])

  // Then: review-findings.json 为 {blocked:[S3], blocking:[], deferred:[LOW], fix:null}（2 空格缩进）；tasks.md 勾 S1、S2，S3 未勾；
  //       运行了 slice-gate.py ship；不运行 timeline.py、不提交（记录生成与收口提交挪到落地）；返回 ready 与空 reasons
  expect(fs.get(`${CT}/${CD}/review-findings.json`)).toBe(JSON.stringify(lists, null, 2) + '\n')
  expect(fs.get(`${CT}/${CD}/tasks.md`)).toBe('# tasks\n- [x] S1 甲\n- [x] S2 乙\n- [ ] S3 丙\n')
  expect(find(calls, 'slice-gate.py', 'ship')).toBeGreaterThan(-1)
  expect([find(calls, 'timeline.py'), find(calls, 'commit')]).toEqual([-1, -1])
  expect(result).toEqual({ verdict: 'ready', reasons: '' })
})

test('closeout-writes-ship-output', async () => {
  // Given: 世界一 ship 退出 1、输出 {ready:false, reasons:["阻断 1 条"], blocked:[], blocking:[HIGH a.ts:3], deferred:[LOW b.ts:1], fix:{ok:true, commit:"m1"}, review:null}；
  //        世界二 ship 退出 1、输出 oops；世界三飞行记录无改动、HEAD 为 f2；三个世界的 tasks.md 都有未勾选的 S1
  const high = { severity: 'HIGH' as const, file: 'a.ts', line: 3, summary: '空指针', fix: '判空' }
  const low = { severity: 'LOW' as const, file: 'b.ts', line: 1, summary: '命名', fix: '改名' }
  const fields = { blocked: [], blocking: [high], deferred: [low], fix: { ok: true, commit: 'm1' } }
  const shipOut = JSON.stringify({ ready: false, commit: 'h1', reasons: ['阻断 1 条'], ...fields, review: null })
  const tasks = { [`${CT}/${CD}/tasks.md`]: '- [ ] S1 甲\n' }
  const one = fakeIo(tasks, argv => (has(argv, 'ship') ? { exitCode: 1, stdout: shipOut + '\n' } : undefined))
  const two = fakeIo(tasks, argv => (has(argv, 'ship') ? { exitCode: 1, stdout: 'oops\n' } : undefined))
  const three = fakeIo({}, argv => (has(argv, 'rev-parse', 'HEAD') ? { stdout: 'f2\n' } : undefined))

  // When: 世界一、二各执行落地收口（已合回 S1）；世界三以备注 blocking=1、slice fix-r1 调用 mergeFix
  const [r1, r2, r3] = await Promise.all([closeout(one.io, F, ['S1']), closeout(two.io, F, ['S1']), mergeFix(three.io, F, 'blocking=1', undefined, 'fix-r1')])

  // Then: 世界一 review-findings.json 四字段恰为 JSON 中的值、不运行 timeline.py、verdict draft；
  //       世界二 verdict draft 且 reasons 含「ship 输出无法解析」、没有写 review-findings.json、没有跑 apply-done；
  //       世界三 merge --no-ff flight/demo/fix-r1 -m "integrate: fix-r1"，返回 ok 与 f2
  expect(one.fs.get(`${CT}/${CD}/review-findings.json`)).toBe(JSON.stringify(fields, null, 2) + '\n')
  expect(find(one.calls, 'timeline.py')).toBe(-1)
  expect(r1.verdict).toBe('draft')
  expect(r2.verdict).toBe('draft')
  expect(r2.reasons).toContain('ship 输出无法解析')
  expect(two.fs.has(`${CT}/${CD}/review-findings.json`)).toBe(false)
  expect(find(two.calls, 'apply-done')).toBe(-1)
  expect(three.calls[find(three.calls, 'merge', '--no-ff')].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', 'flight/demo/fix-r1', '-m', 'integrate: fix-r1'])
  expect(r3).toEqual({ ok: true, commit: 'f2' })
})

test('classify-dirty-paths', () => {
  // Given: change 目录 template/openspec/changes/demo、scenario 测试文件 tests/test_a.py；未提交 timeline.md、proposal.md、adr/DRAFT-x.md、adr/0001-y.md、tests/test_a.py、src/x.py
  const paths = [`${CD}/timeline.md`, `${CD}/proposal.md`, 'template/openspec/adr/DRAFT-x.md', 'template/openspec/adr/0001-y.md', 'tests/test_a.py', 'src/x.py']

  // When: 分类
  const r = classifyDirty(paths, { changeDir: CD, scenarioFiles: ['tests/test_a.py'] })

  // Then: 记录恰为 timeline.md；工件恰为 proposal.md、DRAFT-x.md、tests/test_a.py；工件之外恰为 0001-y.md 与 src/x.py
  expect(r.records).toEqual([`${CD}/timeline.md`])
  expect(r.artifacts).toEqual([`${CD}/proposal.md`, 'template/openspec/adr/DRAFT-x.md', 'tests/test_a.py'])
  expect(r.others).toEqual(['template/openspec/adr/0001-y.md', 'src/x.py'])
})

test('commit-artifacts-handles-staged-deletion', async () => {
  // Given: 工件 a.md 已修改未暂存；slices/S5.md 的删除已暂存，git status --porcelain 答「 M …/a.md」与「D  …/slices/S5.md」；其余 git 调用退出 0
  const a = `${CD}/a.md`
  const s5 = `${CD}/slices/S5.md`
  const { io, calls } = fakeIo({}, argv => (has(argv, 'status', '--porcelain') ? { stdout: argv.includes('-z') ? ` M ${a}\0D  ${s5}\0` : ` M ${a}\nD  ${s5}\n` } : undefined))

  // When: commitArtifacts(io, f, [a.md, S5.md])
  const err = await commitArtifacts(io, F, [a, s5])

  // Then: git add 的路径只有 a.md；git commit 的路径同时含 a.md 与 S5.md；返回没有错误
  expect(calls[find(calls, 'add')].argv).toEqual(['git', '-C', CT, 'add', '--', `${CT}/${a}`])
  expect(calls[find(calls, 'commit')].argv.slice(-3)).toEqual(['--', `${CT}/${a}`, `${CT}/${s5}`])
  expect(err).toBeUndefined()
})

// scenario 来源：spec flight-takeoff-commit#staged-deletion-edge-cases（甲、乙、丙三个世界分写成三个子用例）
test('staged-deletion-edge-cases/quoted-path', async () => {
  // Given: 甲：a.md 已修改未暂存；切片/S5.md 的删除已暂存；git status --porcelain -z 答「 M a.md\0D  切片/S5.md\0」，
  //        不带 -z 时按 core.quotePath 答成八进制转义的带引号路径；其余 git 调用退出 0
  const a = `${CD}/a.md`
  const s5 = `${CD}/切片/S5.md`
  const quoted = `"${CD}/\\345\\210\\207\\347\\211\\207/S5.md"`
  const { io, calls } = fakeIo({}, argv => (has(argv, 'status', '--porcelain') ? { stdout: argv.includes('-z') ? ` M ${a}\0D  ${s5}\0` : ` M ${a}\nD  ${quoted}\n` } : undefined))

  // When: commitArtifacts(io, f, [a.md, 切片/S5.md])
  const err = await commitArtifacts(io, F, [a, s5])

  // Then: git add 的路径只有 a.md；git commit 的路径同时含 a.md 与 切片/S5.md；返回没有错误
  expect(calls[find(calls, 'add')].argv).toEqual(['git', '-C', CT, 'add', '--', `${CT}/${a}`])
  expect(calls[find(calls, 'commit')].argv.slice(-3)).toEqual(['--', `${CT}/${a}`, `${CT}/${s5}`])
  expect(err).toBeUndefined()
})

test('staged-deletion-edge-cases/all-deleted', async () => {
  // Given: 乙：b.md 与 slices/S5.md 都是已暂存删除；git status 答两条「D  」（带 -z 时以 \0 分隔，否则以换行分隔）；其余 git 调用退出 0
  const b = `${CD}/b.md`
  const s5 = `${CD}/slices/S5.md`
  const { io, calls } = fakeIo({}, argv => (has(argv, 'status', '--porcelain') ? { stdout: argv.includes('-z') ? `D  ${b}\0D  ${s5}\0` : `D  ${b}\nD  ${s5}\n` } : undefined))

  // When: commitArtifacts(io, f, [b.md, S5.md])
  const err = await commitArtifacts(io, F, [b, s5])

  // Then: 没有 git add 调用；git commit 的路径同时含 b.md 与 S5.md；返回没有错误
  expect(find(calls, 'add')).toBe(-1)
  expect(calls[find(calls, 'commit')].argv.slice(-3)).toEqual(['--', `${CT}/${b}`, `${CT}/${s5}`])
  expect(err).toBeUndefined()
})

test('staged-deletion-edge-cases/status-fails', async () => {
  // Given: 丙：git status 以 1 退出（stderr 为 fatal: index file corrupt）；其余 git 调用退出 0
  const a = `${CD}/a.md`
  const s5 = `${CD}/slices/S5.md`
  const { io, calls } = fakeIo({}, argv => (has(argv, 'status', '--porcelain') ? { exitCode: 1, stderr: 'fatal: index file corrupt\n' } : undefined))

  // When: commitArtifacts(io, f, [a.md, S5.md])
  const err = await commitArtifacts(io, F, [a, s5])

  // Then: git add 带全部两个路径；返回没有错误
  expect(calls[find(calls, 'add')].argv).toEqual(['git', '-C', CT, 'add', '--', `${CT}/${a}`, `${CT}/${s5}`])
  expect(err).toBeUndefined()
})
