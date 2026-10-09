// scenario 来源：spec flight-orchestrator。插件之下的「世界」由测试 hook 作答：git / python3 判定器 / 文件系统 / 会话 / 派发。
// 账本：git hash-object 的 stdin 即事件 JSON，世界把它存进数组；ledger.py show 按顺序逐行返回。
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const MAIN = '/repo'
const TREE = '/repo/.worktrees/demo'
const CD = 'template/openspec/changes/demo'
const HOOKS = `${MAIN}/template/.claude/hooks`
const F = '3f9a1c07' + 'a'.repeat(56)
const SLICE1 = `${MAIN}/.claude/worktrees/flight-demo-S1`
const SLICE2 = `${MAIN}/.claude/worktrees/flight-demo-S2`
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
  const log = {
    events: [] as Record<string, unknown>[],
    spawns: [] as Spawn[],
    statuses: [] as string[],
    commands: [] as string[],
    runs: [] as { argv: string[]; cwd: string | undefined }[],
  }
  const exists = new Set<string>([`${TREE}/${CD}`, `${HOOKS}/slice-gate.py`, `${TREE}/${CD}/slices.json`])
  const files: Record<string, string> = { [`${TREE}/${CD}/slices.json`]: JSON.stringify(SLICES) }
  let agents = 0
  let conflicted = ''
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
  on('session.version', () => ({ value: { version: '2.1.295' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: TREE }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', ($, e) => {
    log.statuses.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.SubagentStop', () => ({}))
  on('command.run', ($, e) => {
    log.commands.push(`${e.command} ${e.args ?? ''}`)
    return { text: 'from-model' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.spawn', ($, e) => {
    const x = e as unknown as Omit<Spawn, 'agentId'>
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
  on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', ($, e) => {
    files[e.path] = String((e as { text?: unknown }).text ?? '')
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
      if (script === 'plan_fp.py') return wrap(res(0, F + '\n'))
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
      case 'status':
        return wrap(res(0, ''))
      case 'hash-object':
        log.events.push(JSON.parse(String(e.init?.stdin)))
        return wrap(res(0, 'b'.repeat(40) + '\n'))
      case 'mktree':
        return wrap(res(0, 'e'.repeat(40) + '\n'))
      case 'rev-parse':
        return wrap(res(0, 'd'.repeat(40) + '\n'))
      case 'commit-tree':
        return wrap(res(0, 'c'.repeat(40) + '\n'))
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
      case 'add':
      case 'commit':
      case 'update-ref':
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
