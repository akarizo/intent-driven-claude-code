// scenario 来源：spec flight-orchestrator。插件之下的「世界」由测试 hook 作答：git / python3 判定器 / 文件系统 / 会话 / 派发。
// 账本：git hash-object 的 stdin 即事件 JSON，世界把它存进数组；ledger.py show 按顺序逐行返回。
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { ev } from '../hooks/core'

const MAIN = '/repo'
const TREE = '/repo/.worktrees/demo'
const CD = 'template/openspec/changes/demo'
const HOOKS = `${MAIN}/template/.claude/hooks`
const F = '3f9a1c07' + 'a'.repeat(56)
const G = '9b0e44d2' + 'b'.repeat(56)
const SLICE1 = `${MAIN}/.claude/worktrees/flight-demo-S1`
const SLICE2 = `${MAIN}/.claude/worktrees/flight-demo-S2`
const SLICE3 = `${MAIN}/.claude/worktrees/flight-demo-S3`
const RESOLVE2 = `${MAIN}/.claude/worktrees/flight-demo-S2-resolve`

type Run = { exitCode: number; stdout: string; stderr: string }
type Gate = { ok: boolean; failed: string[] }
type World = {
  /** takeoff-gate.py 的结果 */
  takeoff: Run
  /** 每片门禁的结论队列（取完后沿用最后一个；缺省绿） */
  gates: Record<string, Gate[]>
  /** 在 change worktree 合回时冲突的切片 → 冲突文件 */
  conflicts: Record<string, string[]>
  /** 解冲突 agent 已解完（解冲突 worktree 里不再有未合并文件） */
  isResolved: boolean
  /** plan_fp.py 输出的当前指纹（缺省 F） */
  fp?: string
  /** plan_fp.py 的整个结果（给了就覆盖 fp，用来模拟非 0 退出或输出格式不对） */
  fpRun?: Run
  /** 派发 agent 时抛异常 */
  spawnThrows?: boolean
  /** update-ref 一直返回非 0（旧值不符，账本写入总失败） */
  updateRefFails?: boolean
  /** 跟踪 change 目录飞行记录的提交状态：fs.write 写过 → `git status --porcelain -- <记录>` 报改动，git commit 后清空 */
  tracksRecords?: boolean
  /** agent.list 的应答（缺省空） */
  agents?: { id: string; status: string }[]
  /** 账本预置事件 */
  ledger?: Record<string, unknown>[]
  /** 预置为已存在的路径（如上一 attempt 留下的切片 worktree） */
  paths?: string[]
  /** 预置的未提交路径（相对 change worktree 根）：整树 `git status --porcelain` 会报出它们，git commit 后清空 */
  dirty?: string[]
  /** 插件之下 tool.check 的引擎判定队列（按调用顺序取；取完后为 ask） */
  checks?: string[]
}
type Spawn = { subagent_type: string; model: string; cwd: string; prompt: string; agentId: string }

const SLICES = {
  version: 1,
  change: 'demo',
  slices: [
    { id: 'S1', owns: ['src/s1.py'], deps: [] },
    { id: 'S2', owns: ['a.py'], deps: [] },
    { id: 'S3', owns: ['src/s3.py'], deps: ['S1'] },
  ],
}

function res(exitCode: number, stdout: string, stderr = ''): Run {
  return { exitCode, stdout, stderr }
}

function wrap(r: Run) {
  return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
}

function demoWorld(extra: Partial<World> = {}): World {
  return { takeoff: res(0, '已批准 3f9a1c07\n'), gates: {}, conflicts: {}, isResolved: false, ...extra }
}

function useWorld(on: On, w: World) {
  const files: Record<string, string> = { [`${TREE}/${CD}/slices.json`]: JSON.stringify(SLICES) }
  const log = {
    events: [...(w.ledger ?? [])] as Record<string, unknown>[],
    spawns: [] as Spawn[],
    statuses: [] as string[],
    commands: [] as string[],
    runs: [] as { argv: string[]; cwd: string | undefined }[],
    logs: [] as string[],
    /** 每次 git commit 的提交信息与当时账本的事件数 */
    commits: [] as { message: string; events: number }[],
    /** 到达插件之下工具执行端的调用：`<工具> <目标路径或命令>` */
    reached: [] as string[],
    files,
  }
  const exists = new Set<string>([`${TREE}/${CD}`, `${HOOKS}/slice-gate.py`, `${TREE}/${CD}/slices.json`, ...(w.paths ?? [])])
  const dirty = new Set<string>(w.dirty ?? [])
  let agents = 0
  let conflicted = ''
  let pending: Record<string, unknown> | undefined
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
  on('session.version', () => ({ value: { version: '2.1.295' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: TREE }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', ($, e) => {
    log.statuses.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    log.logs.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('agent.list', () => ({ value: (w.agents ?? []) as never }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SubagentStop', () => ({}))
  on('command.run', ($, e) => {
    log.commands.push(`${e.command} ${e.args ?? ''}`)
    return { text: 'from-model' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('tool.call', ($, e) => {
    const x = e as unknown as { tool: string; file_path?: string; notebook_path?: string; command?: string }
    log.reached.push(`${x.tool} ${x.file_path ?? x.notebook_path ?? x.command ?? ''}`)
    return { result: {}, text: '' } as never
  })
  const checks = [...(w.checks ?? [])]
  on('tool.check', () => ({ decision: checks.shift() ?? 'ask' }) as never)
  on('agent.spawn', ($, e) => {
    const x = e as unknown as Omit<Spawn, 'agentId'>
    if (w.spawnThrows) throw new Error('spawn 炸了')
    agents += 1
    const agentId = `agent-${agents}`
    log.spawns.push({ subagent_type: x.subagent_type, model: x.model, cwd: x.cwd, prompt: x.prompt, agentId })
    return {
      model: 'claude-opus-5-5',
      agentId,
      result: { status: 'async_launched', agentId, description: 'd', prompt: x.prompt, outputFile: '/dev/null' },
    } as never
  })
  on('fs.exists', ($, e) => ({ value: exists.has(e.path) }))
  // 与真实引擎一致：读不存在的文件抛错，原文 `$.fs.read(<path>) failed: ENOENT`
  on('fs.read', ($, e) => {
    if (!(e.path in files)) throw new Error(`$.fs.read(${e.path}) failed: ENOENT`)
    return { value: files[e.path] }
  })
  on('fs.write', ($, e) => {
    files[e.path] = String((e as { text?: unknown }).text ?? '')
    exists.add(e.path)
    if (w.tracksRecords && e.path.startsWith(`${TREE}/${CD}/`)) dirty.add(e.path.slice(`${TREE}/`.length))
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    let cwd = e.init?.cwd
    log.runs.push({ argv, cwd })
    if (argv[0] === 'python3') {
      const script = String(argv[1]).split('/').pop()
      const sub = argv[2]
      if (script === 'takeoff-gate.py') return wrap(w.takeoff)
      if (script === 'plan_fp.py') return wrap(w.fpRun ?? res(0, (w.fp ?? F) + '\n'))
      if (script === 'session-model.py') return wrap(res(0, 'opus\n'))
      if (script === 'timeline.py') return wrap(res(0, ''))
      if (script === 'ledger.py') return wrap(res(0, log.events.map(x => JSON.stringify(x)).join('\n') + '\n'))
      if (script === 'slice-gate.py' && sub === 'preflight') return wrap(res(0, '[["S1", "S2"], ["S3"]]\n'))
      if (script === 'slice-gate.py' && sub === 'gate') {
        const s = String(argv[3])
        const queue = w.gates[s] ?? []
        const g = (queue.length > 1 ? queue.shift() : queue[0]) ?? { ok: true, failed: [] }
        return wrap(res(g.ok ? 0 : 1, JSON.stringify({ slice: s, ok: g.ok, commit: 'c'.repeat(40), failed: g.failed })))
      }
      if (script === 'slice-gate.py') return wrap(res(0, ''))
      throw new Error(`unexpected argv: ${argv.join(' ')}`)
    }
    if (argv[0] !== 'git') throw new Error(`unexpected argv: ${argv.join(' ')}`)
    let args = argv.slice(1)
    if (args[0] === '-C') {
      cwd = args[1]
      args = args.slice(2)
    }
    switch (args[0]) {
      case 'worktree':
        if (args[1] === 'list') return wrap(res(0, `worktree ${MAIN}\nbranch refs/heads/main\n\nworktree ${TREE}\nbranch refs/heads/worktree-demo\n`))
        exists.add(String(args[4]))
        return wrap(res(0, ''))
      case 'status': {
        // 带路径的 status（commitRecords 查飞行记录）只报所列路径里的改动；不带路径的整树检查报全部改动
        const paths = args.includes('--') ? args.slice(args.indexOf('--') + 1).map(p => p.slice(`${TREE}/`.length)) : [...dirty]
        return wrap(res(0, paths.filter(p => dirty.has(p)).map(p => ` M ${p}\n`).join('')))
      }
      case 'hash-object':
        pending = JSON.parse(String(e.init?.stdin))
        return wrap(res(0, 'b'.repeat(40) + '\n'))
      case 'update-ref':
        if (w.updateRefFails) return wrap(res(1, '', 'cannot lock ref: is at dddd but expected 0000'))
        if (pending) log.events.push(pending)
        pending = undefined
        return wrap(res(0, ''))
      case 'mktree':
        return wrap(res(0, 'e'.repeat(40) + '\n'))
      case 'rev-parse':
        return wrap(res(0, 'd'.repeat(40) + '\n'))
      case 'commit-tree':
        return wrap(res(0, 'c'.repeat(40) + '\n'))
      case 'merge-base':
        return wrap(res(0, '0'.repeat(40) + '\n'))
      case 'log':
        return wrap(res(0, ''))
      case 'merge-tree':
        return wrap(res(0, 'a'.repeat(40) + '\n'))
      case 'rev-list':
        return wrap(res(0, `${'f'.repeat(40)} ${'1'.repeat(40)} ${'2'.repeat(40)}\n`))
      case 'diff':
        if (cwd === RESOLVE2) return wrap(res(0, w.isResolved ? '' : 'a.py\n'))
        return wrap(res(0, conflicted))
      case 'merge': {
        const s = String(args[2]).split('/').pop() ?? ''
        if (args[1] === '--no-ff' && cwd === TREE && w.conflicts[s]) {
          conflicted = w.conflicts[s].join('\n') + '\n'
          return wrap(res(1, '', 'CONFLICT'))
        }
        if (args[1] === '--no-ff' && cwd === RESOLVE2) return wrap(res(1, '', 'CONFLICT'))
        if (args[1] === '--abort') conflicted = ''
        return wrap(res(0, ''))
      }
      case 'commit':
        log.commits.push({ message: String(args[args.indexOf('-m') + 1]), events: log.events.length })
        dirty.clear()
        return wrap(res(0, ''))
      case 'add':
        return wrap(res(0, ''))
    }
    throw new Error(`unexpected git: ${args.join(' ')}`)
  })
  return log
}

const ended = (agentId: string) => ({
  answer: '',
  durationMs: 1,
  isAborted: false,
  turnId: `t-${agentId}`,
  reason: 'answer',
  agentId,
  usage: { model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1 },
})

const subagentStop = (agentId: string) => ({
  agent_id: agentId,
  agent_type: 'flight:executor',
  hook_event_name: 'SubagentStop',
  stop_hook_active: false,
})

test('opsx-apply-taken-over', async ($, on) => {
  // Given: demo 已批准（takeoff-gate 退出 0）、worktree 干净、lint/preflight 绿、waves [[S1, S2], [S3]]、session-model.py 输出 opus
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 插件作答（含「起飞 demo」）、命令没到达模型；账本依次为 takeoff 与 S1、S2 的 dispatch；两次派发都是 flight:executor、opus、各自切片 worktree
  expect(r.text).toContain('起飞 demo')
  expect(log.commands).toEqual([])
  expect(log.events.map(x => [x.ev, x.slice ?? null])).toEqual([['takeoff', null], ['dispatch', 'S1'], ['dispatch', 'S2']])
  expect(log.spawns.map(s => [s.subagent_type, s.model, s.cwd])).toEqual([
    ['flight:executor', 'opus', SLICE1],
    ['flight:executor', 'opus', SLICE2],
  ])
})

test('takeoff-refused-without-approval', async ($, on) => {
  // Given: takeoff-gate.py 以 3 退出，stderr 为「未批准」
  const log = useWorld(on, demoWorld({ takeoff: res(3, '', '未批准') }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「未批准」与 spec.html 绝对路径；账本没有事件、没有派发
  expect(r.text).toContain('未批准')
  expect(r.text).toContain(`${TREE}/${CD}/spec.html`)
  expect(log.events).toEqual([])
  expect(log.spawns).toEqual([])
})

test('engine-workflow-passes-through', async ($, on) => {
  // Given: 插件已加载，世界里 demo 已批准
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo --engine=workflow
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo --engine=workflow' })

  // Then: 命令原样到达模型并由它作答；账本没有事件
  expect(log.commands).toEqual(['opsx-apply demo --engine=workflow'])
  expect(r.text).toBe('from-model')
  expect(log.events).toEqual([])
})

test('stop-gate-blocks-red-executor', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 的执行体 A 是 agent-1；它收口时 S1 门禁 ok false、failed [G7 demo#s1]
  const log = useWorld(on, demoWorld({ gates: { S1: [{ ok: false, failed: ['G7 demo#s1'] }] } }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // When: 处理 A 的收口（SubagentStop）
  const r = (await $.classic.SubagentStop(subagentStop('agent-1') as never)) as { block?: string }

  // Then: 回答 block 且含 G7 demo#s1；账本最后一条是 A 的 S1 gate（ok false），门禁在 S1 的切片 worktree 里跑
  expect(r.block).toContain('G7 demo#s1')
  expect(log.events.at(-1)).toMatchObject({ ev: 'gate', slice: 'S1', ok: false, agent: 'agent-1' })
  expect(log.runs.find(x => x.argv[2] === 'gate')?.cwd).toBe(SLICE1)
})

test('silent-end-runs-gate-and-respawns', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；A 未经收口就结束（answer 为空），补跑的 S1 门禁为红 [G3 RED 缺失]
  const log = useWorld(on, demoWorld({ gates: { S1: [{ ok: false, failed: ['G3 RED 缺失'] }] } }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // When: 处理 A 的结束（turn.complete）
  await $.turn.complete(ended('agent-1') as never)

  // Then: 起飞后的账本依次追加 ended、gate（ok false）、S1 的 dispatch；新执行体在 S1 原 worktree 派发，提示词含「未正常收口」
  expect(log.events.slice(3).map(x => [x.ev, x.ok ?? null])).toEqual([['ended', null], ['gate', false], ['dispatch', null]])
  expect(log.spawns.at(-1)?.cwd).toBe(SLICE1)
  expect(log.spawns.at(-1)?.prompt).toContain('未正常收口')
})

test('conflict-spawns-resolver', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S2 的执行体 B = agent-2）；S2 门禁绿，在 change worktree 合回时 a.py 冲突
  const w = demoWorld({ conflicts: { S2: ['a.py'] } })
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-2') as never)
  await $.turn.complete(ended('agent-2') as never)
  const resolver = log.spawns.at(-1)
  w.isResolved = true

  // When: 处理解冲突 agent（agent-3）的收口与结束
  await $.classic.SubagentStop(subagentStop('agent-3') as never)
  await $.turn.complete(ended('agent-3') as never)

  // Then: 解冲突 agent 以 flight:fixer 在 flight-demo-S2-resolve 派发、提示词含 a.py；结束后 change worktree 里 --ff-only 快进；账本有 S2 的 merge（ok true）
  expect(resolver?.subagent_type).toBe('flight:fixer')
  expect(resolver?.cwd).toBe(RESOLVE2)
  expect(resolver?.prompt).toContain('a.py')
  expect(log.runs.some(x => x.argv.join(' ') === `git -C ${TREE} merge --ff-only flight/demo/S2-resolve`)).toBe(true)
  expect(log.events.some(x => x.ev === 'merge' && x.slice === 'S2' && x.ok === true)).toBe(true)
})

test('flight-status-line', async ($, on) => {
  // Given: 世界里 demo 已批准，waves [[S1, S2], [S3]]
  const log = useWorld(on, demoWorld())

  // When: /opsx-apply demo 起飞并派发完第一个 wave
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 最后一次状态行含 demo、W1/2 与「运行 2」
  expect(log.statuses.at(-1)).toContain('demo')
  expect(log.statuses.at(-1)).toContain('W1/2')
  expect(log.statuses.at(-1)).toContain('运行 2')
})

test('flight-types-hidden-from-model', async ($, on) => {
  // Given: 插件已加载；插件之下的引擎对任何类型都答「提供」
  on('agent.offer', () => ({ isOffered: true }))
  const offer = (agent: string) => $.agent.offer({ agent, description: 'x', source: 'plugin' } as never)

  // When: 引擎依次询问 flight:executor / flight:reviewer / flight:fixer / general-purpose
  const answers = await Promise.all(['flight:executor', 'flight:reviewer', 'flight:fixer', 'general-purpose'].map(offer))

  // Then: 三个飞行类型都不提供；general-purpose 照常提供
  expect(answers.map(a => a.isOffered)).toEqual([false, false, false, true])
})

test('takeoff-exception-stays-grounded', async ($, on) => {
  // Given: demo 已批准、起飞检查全部通过（takeoff-gate 0、worktree 干净、lint / preflight 绿），但派发 agent 时 agent.spawn 抛出「spawn 炸了」
  const log = useWorld(on, demoWorld({ spawnThrows: true }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 插件作答且回复含「起飞异常」；命令没有交给模型
  expect(r.text).toContain('起飞异常')
  expect(log.commands).toEqual([])
})

test('drive-hands-landing-actions', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；A 收口时 S1 门禁绿，在 change worktree 合回 S1 无冲突
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-1') as never)

  // When: 处理 A 的结束（turn.complete）
  await $.turn.complete(ended('agent-1') as never)

  // Then: 最后一次派发是 flight:reviewer、cwd 为 change worktree；账本有 role reviewer、slice S1 的 dispatch
  expect(log.spawns.at(-1)?.subagent_type).toBe('flight:reviewer')
  expect(log.spawns.at(-1)?.cwd).toBe(TREE)
  expect(log.events.some(x => x.ev === 'dispatch' && x.role === 'reviewer' && x.slice === 'S1')).toBe(true)
})

test('drive-stops-without-progress', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；之后 plan_fp 输出变为 G（drive 会得出停飞动作），且 update-ref 一直返回非 0（账本写入总失败）
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  w.fp = G
  w.updateRefFails = true
  const before = log.runs.length

  // When: 处理 A 的结束（turn.complete）
  await $.turn.complete(ended('agent-1') as never)

  // Then: 本次处理调用 ledger.py show 至多 4 次（查 A 所属飞行 1 次 + 停飞动作 1 次 + drive 至多 2 轮），没有跑满 MAX_ROUNDS
  expect(log.runs.slice(before).filter(x => String(x.argv[1]).endsWith('/ledger.py') && x.argv[2] === 'show').length).toBeLessThanOrEqual(4)
})

test('drive-halts-on-action-exception', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；A 收口时 S1 门禁绿、合回无冲突；之后派发 agent 时 agent.spawn 抛出「spawn 炸了」
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-1') as never)
  w.spawnThrows = true

  // When: 处理 A 的结束（turn.complete），drive 合回 S1 后派发评审员
  const outcome = await $.turn.complete(ended('agent-1') as never).then(
    () => 'resolved',
    (err: unknown) => `rejected: ${String(err)}`,
  )

  // Then: 处理正常返回、异常不冒到引擎；账本末条为 halt，原因含「动作异常」
  expect(outcome).toBe('resolved')
  expect(log.events.at(-1)).toMatchObject({ ev: 'halt', reason: expect.stringContaining('动作异常') })
})

// PR #39 评审 HIGH（R1）：指纹算不出时写进账本的空 fp 会让整条账本判损坏、起飞被永久拒绝
test('takeoff-refuses-bad-fingerprint', async ($, on) => {
  // Given: 起飞检查都过，但 plan_fp.py 以 1 退出，stderr 为「读取 slices.json 失败」
  const log = useWorld(on, demoWorld({ fpRun: res(1, '', '读取 slices.json 失败') }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「计算计划指纹失败」与 stderr；账本没有事件、没有派发、没有记 approve
  expect(r.text).toContain('计算计划指纹失败')
  expect(r.text).toContain('读取 slices.json 失败')
  expect(log.events).toEqual([])
  expect(log.spawns).toEqual([])
  expect(log.runs.some(x => String(x.argv[1]).endsWith('timeline.py'))).toBe(false)
})

test('takeoff-refuses-bad-fingerprint/not-hex', async ($, on) => {
  // Given: 起飞检查都过，plan_fp.py 以 0 退出，但输出不是 64 位十六进制
  const log = useWorld(on, demoWorld({ fpRun: res(0, 'not-a-fingerprint\n') }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「计算计划指纹失败」；账本没有事件、没有派发
  expect(r.text).toContain('计算计划指纹失败')
  expect(log.events).toEqual([])
  expect(log.spawns).toEqual([])
})

// ---------------------------------------------------------------- flight-hardening（S3）

test('drive-reports-fp-failure-distinctly', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；之后 plan_fp.py 以 1 退出、stderr「plan_fp 超时」
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  w.fpRun = res(1, '', 'plan_fp 超时')

  // When: 处理 A 的结束（turn.complete）
  await $.turn.complete(ended('agent-1') as never)

  // Then: 账本末条为 halt，原因含「计算计划指纹失败」与「plan_fp 超时」、不含「计划指纹已变」；$.ui.log 收到含「停飞 · demo」的文本
  const last = log.events.at(-1)
  expect(last).toMatchObject({ ev: 'halt', reason: expect.stringContaining('计算计划指纹失败') })
  expect(String(last?.reason)).toContain('plan_fp 超时')
  expect(String(last?.reason)).not.toContain('计划指纹已变')
  expect(log.logs.some(t => t.includes('停飞 · demo'))).toBe(true)
})

test('executor-dispatch-commits-records-first', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，waves [[S1, S2], [S3]]；世界跟踪飞行记录的提交状态；S1（agent-1）已收口结束并合回，S2（agent-2）已收口——合回 S2 后刷新的 slices/_interfaces.md 尚未提交
  const log = useWorld(on, demoWorld({ tracksRecords: true }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-1') as never)
  await $.turn.complete(ended('agent-1') as never)
  await $.classic.SubagentStop(subagentStop('agent-2') as never)

  // When: 处理 S2 执行体的结束，drive 合回 S2 后派发 S3 的执行体
  await $.turn.complete(ended('agent-2') as never)

  // Then: S3 切片 worktree 的 git worktree add 与 S2 的合回都发生过；两者之间有一次「chore(flight): 记录」的 git commit
  const addS3 = log.runs.findIndex(x => x.argv[1] === 'worktree' && x.argv[2] === 'add' && x.argv.includes(SLICE3))
  const mergeS2 = log.runs.findIndex(x => x.argv.join(' ').includes('merge --no-ff flight/demo/S2'))
  const between = log.runs.slice(mergeS2, Math.max(addS3, 0))
  expect(addS3).toBeGreaterThan(-1)
  expect(mergeS2).toBeGreaterThan(-1)
  expect(between.some(x => x.argv.includes('commit') && x.argv.includes('chore(flight): 记录'))).toBe(true)
})

test('takeoff-waits-for-live-agents-after-halt', async ($, on) => {
  // Given: 账本预置 demo attempt 1 的 takeoff、S1 的 dispatch（agent-1）、halt；agent.list 里 agent-1 仍为 running
  const b = { change: 'demo', at: '2026-10-09T12:00:00.000Z', session: 'sess-1' }
  const ledger = [
    ev.takeoff(b, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }),
    ev.dispatch(b, { attempt: 1, slice: 'S1', role: 'executor', agent: 'agent-1', model: 'opus', worktree: SLICE1 }),
    ev.halt(b, { attempt: 1, reason: '计划指纹已变' }),
  ]
  const log = useWorld(on, demoWorld({ ledger, agents: [{ id: 'agent-1', status: 'running' }] }))

  // When: 人再次发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「仍在运行」；账本仍只有预置的 3 条事件（没有新的 takeoff）
  expect(r.text).toContain('仍在运行')
  expect(log.events.length).toBe(3)
})

test('merge-survives-missing-interfaces-summary', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；世界的 fs.read 对不存在的文件抛 ENOENT，change 目录还没有 slices/_interfaces.md；A 收口时 S1 门禁绿
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-1') as never)

  // When: 处理 A 的结束（turn.complete），drive 合回 S1
  await $.turn.complete(ended('agent-1') as never)

  // Then: 账本有 S1 的 merge 且 ok；没有 halt；_interfaces.md 被写出且含「## S1」
  expect(log.events.some(x => x.ev === 'merge' && x.slice === 'S1' && x.ok === true)).toBe(true)
  expect(log.events.some(x => x.ev === 'halt')).toBe(false)
  expect(log.files[`${TREE}/${CD}/slices/_interfaces.md`]).toContain('## S1')
})

// ---------------------------------------------------------------- flight-envelope（S4）

const B0 = { change: 'demo', at: '2026-10-09T12:00:00.000Z', session: 'sess-1' }
const BASE_B = 'b'.repeat(40)
/** attempt 1：S1 执行体 agent-1 收口门禁绿（base B）后停飞，S1 未合回 */
const haltedWithGreenS1 = () => [
  ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }),
  ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'executor', agent: 'agent-1', model: 'opus', worktree: SLICE1 }),
  ev.gate(B0, { attempt: 1, agent: 'agent-1', slice: 'S1', ok: true, commit: 'c'.repeat(40), failed: [], base: BASE_B }),
  ev.halt(B0, { attempt: 1, reason: '计划指纹已变' }),
]
const isGateS1 = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/slice-gate.py') && x.argv[2] === 'gate' && x.argv[3] === 'S1'
const isStartS1 = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/slice-gate.py') && x.argv[2] === 'start' && x.argv[3] === 'S1'
const baseOf = (argv: string[]) => (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : undefined)

test('resume-regates-green-slice', async ($, on) => {
  // Given: 账本预置 attempt 1 的 takeoff、S1 执行体 agent-1 的 dispatch（worktree 为 S1 切片路径）、S1 gate（ok，base B）、halt；S1 切片 worktree 仍在；补跑门禁缺省绿
  const log = useWorld(on, demoWorld({ ledger: haltedWithGreenS1(), paths: [SLICE1] }))

  // When: 人再次发出 /opsx-apply demo（attempt 2 起飞并 drive）
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 在 S1 worktree 跑了带 --base B 的 slice-gate gate S1；S1 没有新的执行体派发；attempt 2 里 S1 的事件依次为 gate(regate, ok) 与 merge(ok)
  expect(log.runs.some(x => isGateS1(x) && x.cwd === SLICE1 && baseOf(x.argv) === BASE_B)).toBe(true)
  expect(log.spawns.filter(s => s.cwd === SLICE1)).toEqual([])
  expect(log.events.filter(x => x.attempt === 2 && x.slice === 'S1' && x.ev !== 'dispatch').map(x => [x.ev, x.agent ?? null, x.ok])).toEqual([
    ['gate', 'regate', true],
    ['merge', null, true],
  ])
})

test('resume-red-regate-dispatches-with-original-base', async ($, on) => {
  // Given: 同 resume-regates-green-slice 的账本与 S1 worktree，但 S1 的补跑门禁为红 [G7 demo#s1]
  const log = useWorld(on, demoWorld({ ledger: haltedWithGreenS1(), paths: [SLICE1], gates: { S1: [{ ok: false, failed: ['G7 demo#s1'] }] } }))

  // When: 人再次发出 /opsx-apply demo（attempt 2 起飞并 drive）
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: slice-gate start S1 带 --base B；在 S1 worktree 派发了一次执行体
  expect(log.runs.filter(isStartS1).map(x => baseOf(x.argv))).toEqual([BASE_B])
  expect(log.spawns.filter(s => s.cwd === SLICE1).map(s => s.subagent_type)).toEqual(['flight:executor'])
})

test('takeoff-commits-leftover-records', async ($, on) => {
  // Given: demo 已批准、attempt 1 已 halt；change worktree 只有 <change 目录>/timeline.md 与 gate-report.md 未提交
  const ledger = haltedWithGreenS1()
  const log = useWorld(on, demoWorld({ ledger, dirty: [`${CD}/timeline.md`, `${CD}/gate-report.md`] }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 「chore(flight): 记录」的提交发生在 takeoff 事件写入之前；回复含「✈ 起飞」
  expect(log.commits.find(c => c.message === 'chore(flight): 记录')?.events).toBe(ledger.length)
  expect(r.text).toContain('✈ 起飞')
})

test('takeoff-commits-leftover-records/foreign-dirty', async ($, on) => {
  // Given: demo 已批准、attempt 1 已 halt；未提交的有 <change 目录>/timeline.md、gate-report.md 与 src/x.py
  const ledger = haltedWithGreenS1()
  const log = useWorld(on, demoWorld({ ledger, dirty: [`${CD}/timeline.md`, `${CD}/gate-report.md`, 'src/x.py'] }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「工作区不干净」；账本没有新的 takeoff
  expect(r.text).toContain('工作区不干净')
  expect(log.events.filter(x => x.ev === 'takeoff').length).toBe(1)
})

test('drive-stops-after-terminal-without-fp', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（agent-1 派 S1、agent-2 派 S2）；plan_fp.py 改为以 1 退出，agent-1 结束后 attempt 1 已因「计算计划指纹失败」halt
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  w.fpRun = res(1, '', 'plan_fp 超时')
  await $.turn.complete(ended('agent-1') as never)
  const before = log.runs.length

  // When: agent-2 结束（turn.complete）
  await $.turn.complete(ended('agent-2') as never)

  // Then: 本次处理没有运行 plan_fp.py；账本里 attempt 1 的 halt 仍只有 1 条
  expect(log.runs.slice(before).some(x => String(x.argv[1]).endsWith('/plan_fp.py'))).toBe(false)
  expect(log.events.filter(x => x.ev === 'halt' && x.attempt === 1).length).toBe(1)
})

// ---------------------------------------------------------------- flight-envelope（S6）

test('tool-call-denies-out-of-envelope-write', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发（owns 为 src/s1.py，worktree 为 S1 切片路径）；插件之下的执行端记录到达的调用
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  const paths = [`${SLICE1}/src/b.py`, `${SLICE1}/src/s1.py`]

  // When: agent-1 分别 Write <S1 worktree>/src/b.py 与 <S1 worktree>/src/s1.py
  const results = await Promise.all(paths.map(file_path => $.tool.call({ tool: 'Write', file_path, content: 'x\n', agentId: 'agent-1' } as never)))

  // Then: 前者答 deny 且理由含「owns」；只有后者到达执行端
  expect(results[0]).toMatchObject({ deny: expect.stringContaining('owns') })
  expect(log.reached).toEqual([`Write ${SLICE1}/src/s1.py`])
})

test('tool-check-upgrades-ask-only-in-envelope', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发；插件之下的引擎依次判 ask、deny、ask、ask、ask
  useWorld(on, demoWorld({ checks: ['ask', 'deny', 'ask', 'ask', 'ask'] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  const write = { tool: 'Write', input: { file_path: `${SLICE1}/src/s1.py`, content: 'x\n' } }
  const calls = [
    { ...write, agentId: 'agent-1' },
    { ...write, agentId: 'agent-1' },
    { ...write, agentId: 'agent-1', ceiling: 'ask' },
    { tool: 'Bash', input: { command: 'npm install' }, agentId: 'agent-1' },
    { tool: 'Write', input: { file_path: `${TREE}/src/s1.py`, content: 'x\n' } },
  ]

  // When: 依次对 agent-1 包络内的 Write（引擎 ask / deny / ask 且 ceiling 为 ask）、agent-1 的 Bash npm install、主会话的 Write 做权限判定
  const answers: { decision?: string; reason?: string }[] = []
  for (const c of calls) answers.push((await $.tool.check(c as never)) as { decision?: string; reason?: string })

  // Then: 只有第一次改答 allow 且理由为「flight 包络内」；其余原样为引擎的 deny / ask / ask / ask
  expect(answers[0]).toMatchObject({ decision: 'allow', reason: 'flight 包络内' })
  expect(answers.slice(1).map(a => a.decision)).toEqual(['deny', 'ask', 'ask', 'ask'])
})

test('main-session-read-only-during-flight', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（在飞，S1 执行体 agent-1）；plan_fp.py 改为以 1 退出，agent-1 结束时 drive 会停飞
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  w.fpRun = res(1, '', 'plan_fp 超时')
  const edit = { tool: 'Edit', file_path: `${TREE}/src/a.py`, old_string: 'a', new_string: 'b' }

  // When: 主会话 Edit <change worktree>/src/a.py 一次；agent-1 结束、attempt 1 停飞后，主会话再 Edit 一次
  const before = await $.tool.call(edit as never)
  await $.turn.complete(ended('agent-1') as never)
  await $.tool.call(edit as never)

  // Then: 停飞前答 deny 且理由含「只读」；账本末条为 halt；停飞后的 Edit 到达执行端
  expect(before).toMatchObject({ deny: expect.stringContaining('只读') })
  expect(log.events.at(-1)?.ev).toBe('halt')
  expect(log.reached).toEqual([`Edit ${TREE}/src/a.py`])
})

test('agent-spawn-guard-wired', async ($, on) => {
  // Given: 插件已加载；插件之下的派发端记录派发
  const log = useWorld(on, demoWorld())

  // When: 以引擎来源（模型的 Agent 工具）派发 subagentType flight:executor、model opus
  const r = await $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'flight:executor', model: 'opus' } as never)

  // Then: 答 deny 且理由含「控制面」；派发没有到达派发端
  expect(r).toMatchObject({ deny: expect.stringContaining('控制面') })
  expect(log.spawns).toEqual([])
})
