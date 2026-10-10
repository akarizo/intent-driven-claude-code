// scenario 来源：spec flight-integration（land-*）。land.ts 只经 Io 做副作用，这里用假 Io 记录调用、按 argv 返回预设结果。
import { expect, test } from 'claude-code/testing'
import { closeout, commitRecords, finishResolve, mergeFix, mergeSlice, prepareResolve, validateFindings } from '../hooks/land'
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
      // 合回前的检查：未预设时切片分支不是 HEAD 的祖先（未合入过）、分叉点为 b0、合并结果树 t-merged 与 HEAD 的树 t-head 不同
      const preset = argv.includes('--is-ancestor') ? { exitCode: 1 } : argv.includes('merge-base') ? { stdout: 'b0\n' } : argv.includes('merge-tree') ? { stdout: 't-merged\n' } : argv.includes('HEAD^{tree}') ? { stdout: 't-head\n' } : {}
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

  // Then: 只 add gate-report.md 并提交「chore(flight): 记录」，之后 merge --no-ff flight/demo/S1，再 record --json <门禁 JSON>（cwd 为 change worktree）；
  //       _interfaces.md 的 S1 一节含 def run(x): 且不含测试文件；返回 ok 与 m1
  const add = calls[find(calls, 'add')]
  expect(add.argv).toEqual(['git', '-C', CT, 'add', '--', `${CT}/${CD}/gate-report.md`])
  const order = [find(calls, 'add'), find(calls, 'commit', 'chore(flight): 记录'), find(calls, 'merge', '--no-ff'), find(calls, 'record', '--json')]
  expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true)
  expect(calls[order[2]].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', 'flight/demo/S1', '-m', 'integrate: S1'])
  expect(calls[order[3]]).toEqual({ argv: ['python3', `${HOOKS}/slice-gate.py`, 'record', '--change-dir', CD, '--json', JSON.stringify(gate)], cwd: CT })
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
    has(argv, 'merge-base', '--is-ancestor', 'flight/demo/S1', 'HEAD') ? { exitCode: 0 }
      : has(argv, 'rev-parse', 'flight/demo/S1') ? { stdout: 'tip1\n' }
        : has(argv, 'log', '--first-parent', '--merges', 'tip1..HEAD') ? { stdout: 'p1 tip1\n' }
          : has(argv, 'merge-tree') ? { stdout: 't1\n' } : has(argv, 'rev-parse', 'HEAD^{tree}') ? { stdout: 't1\n' }
            : has(argv, 'rev-parse', 'HEAD') ? { stdout: 'm1\n' } : undefined,
  )
  const gate = gateOf('S1')

  // When: 合回 S1
  const result = await mergeSlice(io, F, 'S1', gate, ['src/a.py'])

  // Then: 不运行 merge --no-ff 与空合回检查，照常 record --json 并刷新接口摘要；返回 ok 与 m1
  expect(find(calls, 'merge', '--no-ff')).toBe(-1)
  expect(find(calls, 'merge-tree')).toBe(-1)
  expect(find(calls, 'record', '--json')).toBeGreaterThan(-1)
  expect(fs.get(`${CT}/${CD}/slices/_interfaces.md`) ?? '').toContain('## S1\n')
  expect(result).toEqual({ ok: true, commit: 'm1' })
})

test('land-refuses-zero-commit-slice-as-integrated', async () => {
  // Given: 切片分支 flight/demo/S2 没有自己的提交：尖端 x0 就是派发时的 change 分支尖端（是 HEAD 的祖先，但不是任何合并提交的第二父）；
  //        执行体把改动留在工作区或直接提交进了 change 分支，合并结果树与 HEAD 的树相同
  const { io, calls } = fakeIo({}, argv =>
    has(argv, 'merge-base', '--is-ancestor', 'flight/demo/S2', 'HEAD') ? { exitCode: 0 }
      : has(argv, 'rev-parse', 'flight/demo/S2') ? { stdout: 'x0\n' }
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
  expect(result).toEqual({ path: RESOLVE, conflicts: ['a.py'] })
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

  // Then: change worktree 里运行 merge --ff-only flight/demo/S2-resolve，之后 record；返回 ok 与 r2
  const ff = find(calls, 'merge', '--ff-only')
  expect(calls[ff].argv).toEqual(['git', '-C', CT, 'merge', '--ff-only', 'flight/demo/S2-resolve'])
  expect(find(calls, 'record', '--json')).toBeGreaterThan(ff)
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

  // Then: 先 merge --no-ff flight/demo/fix -m "integrate: fix"，再 timeline.py record fix --note blocking=2；返回 ok 与 f1
  const m = find(calls, 'merge', '--no-ff')
  expect(calls[m].argv).toEqual(['git', '-C', CT, 'merge', '--no-ff', 'flight/demo/fix', '-m', 'integrate: fix'])
  expect(calls[find(calls, 'timeline.py')]).toEqual({ argv: ['python3', `${HOOKS}/timeline.py`, 'record', 'fix', '--change-dir', CD, '--note', 'blocking=2'], cwd: CT })
  expect(find(calls, 'timeline.py')).toBeGreaterThan(m)
  expect(result).toEqual({ ok: true, commit: 'f1' })
})

const finding = (severity: string) => ({ severity, file: 'a.py', line: 3, summary: 's', fix: 'f' })

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
  //        status 报 tasks.md 与 review-findings.json 有改动；ship 退出 0、stdout 为 ready: 全绿
  const tasks = '# tasks\n- [ ] S1 甲\n- [ ] S2 乙\n- [ ] S3 丙\n'
  const status = ` M ${CD}/tasks.md\n?? ${CD}/review-findings.json\n`
  const { io, calls, fs } = fakeIo({ [`${CT}/${CD}/tasks.md`]: tasks }, argv =>
    has(argv, 'status') ? { stdout: status } : has(argv, 'ship') ? { stdout: 'ready: 全绿\n' } : undefined,
  )
  const low = { severity: 'LOW' as const, file: 'a.py', line: 1, summary: 's', fix: 'f' }
  const lists = { blocked: [{ slice: 'S3', kind: 'gate' as const, reason: 'G7 x' }], blocking: [], deferred: [low], fix: null }

  // When: 落地收口
  const result = await closeout(io, F, lists, ['S1', 'S2'])

  // Then: review-findings.json 为 {blocked:[S3], blocking:[], deferred:[LOW], fix:null}（2 空格缩进）；tasks.md 勾 S1、S2，S3 未勾；
  //       依次运行 timeline.py record apply-done --note "blocked=1 blocking=0"、提交「chore(flight): 收口」、slice-gate.py ship；返回 ready 与 ship 的 stdout
  expect(fs.get(`${CT}/${CD}/review-findings.json`)).toBe(JSON.stringify(lists, null, 2) + '\n')
  expect(fs.get(`${CT}/${CD}/tasks.md`)).toBe('# tasks\n- [x] S1 甲\n- [x] S2 乙\n- [ ] S3 丙\n')
  const steps = [find(calls, 'timeline.py', 'apply-done', 'blocked=1 blocking=0'), find(calls, 'commit', 'chore(flight): 收口'), find(calls, 'slice-gate.py', 'ship')]
  expect(steps.every((i, k) => i >= 0 && (k === 0 || i > steps[k - 1]))).toBe(true)
  expect(result).toEqual({ verdict: 'ready', reasons: 'ready: 全绿\n' })
})
