// scenario 来源：spec flight-orchestrator。插件之下的「世界」由测试 hook 作答：git / python3 判定器 / 文件系统 / 会话 / 派发。
// 账本：git hash-object 的 stdin 即事件 JSON，世界把它存进数组；ledger.py show 按顺序逐行返回。
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { ev } from '../hooks/core'
import { EVENT_TYPES } from '../hooks/io'

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
  /** 已经 integrate 过的切片：第一父链上有以其尖端 tip-<S> 为第二父的合并提交 */
  integrated?: string[]
  /** dispatch 事件写入账本总失败（update-ref 非 0，其余事件照常）：派出的 agent 停在登记中 */
  dispatchFails?: boolean
  /** `git --version` 的输出（缺省 git version 2.43.0） */
  gitVersion?: string
  /** slice-gate start 打印的 base：按切片 worktree 路径（缺省为 --base 参数，否则 base-<目录名>） */
  bases?: Record<string, string>
  /** slice-gate measure 的应答：按切片（缺省一个目标 XFAIL、changed 为空） */
  measures?: Record<string, Run>
  /** ledger.py events 的输出（缺省全部 EVENT_TYPES） */
  eventTypes?: readonly string[]
  /** ledger.py show 以 5 退出（账本读取失败） */
  ledgerFails?: boolean
  /** 环境变量（mock.env） */
  env?: Record<string, string>
  /** 预置的文件内容（绝对路径） */
  files?: Record<string, string>
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
  scenario_tests: { 'demo#s1': 'tests/test_s1.py::test_s1', 'demo#s2': 'tests/test_s1.py::test_s2' },
}
/** 本 change 的工件（相对 change worktree 根）：change 目录下的 proposal、同一 openspec 根下的 ADR 草稿、scenario 测试文件 */
const ARTIFACTS = [`${CD}/proposal.md`, 'template/openspec/adr/DRAFT-x.md', 'tests/test_s1.py']

// 测试里 $.plugin.root 是插件真实目录（本测试文件的上一级）
const PLUGIN_ROOT = String(import.meta.dir).replace(/\/tests$/, '')

function res(exitCode: number, stdout: string, stderr = ''): Run {
  return { exitCode, stdout, stderr }
}

/** slice-gate measure 退出 0 时打印的 JSON */
function measureJson(slice: string, base: string, outcomes: [string, string][], source: string[]): string {
  return JSON.stringify({ slice, base, commit: 'c'.repeat(40), outcomes, unmeasurable: [], changed: source, source, tail: '1 passed' })
}

function wrap(r: Run) {
  return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
}

function demoWorld(extra: Partial<World> = {}): World {
  return { takeoff: res(0, '已批准 3f9a1c07\n'), gates: {}, conflicts: {}, isResolved: false, ...extra }
}

function useWorld(on: On, w: World) {
  const files: Record<string, string> = {
    [`${TREE}/${CD}/slices.json`]: JSON.stringify(SLICES),
    [`${PLUGIN_ROOT}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'flight', version: '0.4.0' }),
    ...(w.files ?? {}),
  }
  const log = {
    events: [...(w.ledger ?? [])] as Record<string, unknown>[],
    spawns: [] as Spawn[],
    statuses: [] as string[],
    commands: [] as string[],
    runs: [] as { argv: string[]; cwd: string | undefined }[],
    logs: [] as string[],
    /** 每次 git commit 的提交信息与当时账本的事件数 */
    commits: [] as { message: string; events: number }[],
    /** 每次 git add 在 `--` 之后的路径 */
    adds: [] as string[][],
    /** 到达插件之下工具执行端的调用：`<工具> <目标路径或命令>` */
    reached: [] as string[],
    /** fs.exists / fs.read 问过的路径（Io.read 先问 exists，不存在就不再读） */
    asked: [] as string[],
    files,
  }
  const exists = new Set<string>([`${TREE}/${CD}`, `${HOOKS}/slice-gate.py`, ...(w.paths ?? []), ...Object.keys(files)])
  const dirty = new Set<string>(w.dirty ?? [])
  let agents = 0
  let conflicted = ''
  let pending: Record<string, unknown> | undefined
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
  mock.env(on, w.env ?? {})
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
  on('fs.exists', ($, e) => {
    log.asked.push(e.path)
    return { value: exists.has(e.path) }
  })
  // 与真实引擎一致：读不存在的文件抛错，原文 `$.fs.read(<path>) failed: ENOENT`
  on('fs.read', ($, e) => {
    log.asked.push(e.path)
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
      if (script === 'ledger.py' && sub === 'events') return wrap(res(0, (w.eventTypes ?? EVENT_TYPES).join('\n') + '\n'))
      if (script === 'ledger.py' && w.ledgerFails) return wrap(res(5, '', '账本 ref 读不出'))
      if (script === 'ledger.py') return wrap(res(0, log.events.map(x => JSON.stringify(x)).join('\n') + '\n'))
      if (script === 'slice-gate.py' && sub === 'preflight') return wrap(res(0, '[["S1", "S2"], ["S3"]]\n'))
      if (script === 'slice-gate.py' && sub === 'gate') {
        const s = String(argv[3])
        const queue = w.gates[s] ?? []
        const g = (queue.length > 1 ? queue.shift() : queue[0]) ?? { ok: true, failed: [] }
        return wrap(res(g.ok ? 0 : 1, JSON.stringify({ slice: s, ok: g.ok, commit: 'c'.repeat(40), failed: g.failed })))
      }
      if (script === 'slice-gate.py' && sub === 'start') {
        const b = baseOf(argv) ?? w.bases?.[String(cwd)] ?? `base-${String(cwd).split('/').pop()}`
        return wrap(res(0, JSON.stringify({ slice: argv[3], base: b, evidence: 'ledger' })))
      }
      if (script === 'slice-gate.py' && sub === 'measure') {
        const s = String(argv[3])
        return wrap(w.measures?.[s] ?? res(0, measureJson(s, baseOf(argv) ?? '', [[`tests/test_demo.py::test_${s.toLowerCase()}`, 'XFAIL']], [])))
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
        if (w.updateRefFails || (w.dispatchFails && pending?.ev === 'dispatch')) return wrap(res(1, '', 'cannot lock ref: is at dddd but expected 0000'))
        if (pending) log.events.push(pending)
        pending = undefined
        return wrap(res(0, ''))
      case 'mktree':
        return wrap(res(0, 'e'.repeat(40) + '\n'))
      case 'rev-parse': {
        // 切片分支尖端：tip-<切片>（integrated 的切片据此在第一父链的合并提交里当第二父）
        const ref = args.find(a => String(a).startsWith('flight/demo/'))
        return wrap(res(0, ref ? `tip-${String(ref).split('/').pop()}\n` : 'd'.repeat(40) + '\n'))
      }
      case 'commit-tree':
        return wrap(res(0, 'c'.repeat(40) + '\n'))
      case '--version':
        return wrap(res(0, (w.gitVersion ?? 'git version 2.43.0') + '\n'))
      case 'merge-base':
        return wrap(res(0, '0'.repeat(40) + '\n'))
      case 'log': {
        // `git log --first-parent --merges --format=%P tip-<S>..HEAD`：integrated 的切片有一个以 tip-<S> 为第二父的合并提交
        const range = args.find(a => /^tip-.+\.\.HEAD$/.test(String(a)))
        const s = range ? String(range).slice(4, -6) : ''
        return wrap(res(0, args.includes('--merges') && (w.integrated ?? []).includes(s) ? `p1 tip-${s}\n` : ''))
      }
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
        log.adds.push(args.slice(args.indexOf('--') + 1))
        return wrap(res(0, ''))
      case 'for-each-ref':
        // 只有本次飞行的账本：demo 已在插件进程登记，扫描不会再读别的 change
        return wrap(res(0, `refs/flight/demo/${'ledger'}\n`))
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
  // 起点测量（flight-measure）另有用例覆盖，这里只看 takeoff 与 dispatch
  expect(log.events.filter(x => x.ev !== 'measure').map(x => [x.ev, x.slice ?? null])).toEqual([['takeoff', null], ['dispatch', 'S1'], ['dispatch', 'S2']])
  expect(log.spawns.map(s => [s.subagent_type, s.model, s.cwd])).toEqual([
    ['flight:executor', 'opus', SLICE1],
    ['flight:executor', 'opus', SLICE2],
  ])
})

test('spawn-prompt-names-worktree', async ($, on) => {
  // Given: demo 已批准，waves [[S1, S2], [S3]]；引擎派发的 agent 不一定落在 cwd 参数给的目录里
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo，派发 S1、S2 的执行体
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 每份提示词都写明自己的切片 worktree 绝对路径、git 一律 git -C 该路径，且不得在别的 worktree 写入或提交
  expect(log.spawns.length).toBe(2)
  for (const s of log.spawns) {
    expect(s.prompt).toContain(`\`${s.cwd}\``)
    expect(s.prompt).toContain(`git -C ${s.cwd}`)
    expect(s.prompt).toContain('不得在别的 worktree 写入或提交')
  }
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
  expect(log.events.filter(x => x.ev !== 'measure').slice(3).map(x => [x.ev, x.ok ?? null])).toEqual([['ended', null], ['gate', false], ['dispatch', null]])
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

test('resume-regate-merges-already-integrated-slice', async ($, on) => {
  // Given: 同 resume-regates-green-slice 的账本与 S1 worktree；S1 分支在上一 attempt 已 integrate（尖端是 HEAD 的祖先），账本缺 merge 事件
  const log = useWorld(on, demoWorld({ ledger: haltedWithGreenS1(), paths: [SLICE1], integrated: ['S1'] }))

  // When: 人再次发出 /opsx-apply demo（attempt 2 起飞并 drive）
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 没有对 S1 运行 merge --no-ff；attempt 2 里 S1 的事件依次为 gate(regate, ok) 与 merge(ok)，没有 blocked
  expect(log.runs.some(x => x.argv.includes('merge') && x.argv.includes('--no-ff') && x.argv.includes('flight/demo/S1'))).toBe(false)
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

const artifactCommit = (log: { commits: { message: string; events: number }[] }) => log.commits.find(c => c.message.includes('工件'))

test('takeoff-commits-artifacts-when-authorized', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的只有 <change 目录>/proposal.md、template/openspec/adr/DRAFT-x.md 与 scenario 测试文件 tests/test_s1.py
  const log = useWorld(on, demoWorld({ dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo 授权提交
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo 授权提交' })

  // Then: 有一次说明含「工件」的提交、发生在 takeoff 事件写入之前（当时账本 0 条）；加入 proposal.md 的那次 git add 路径恰为这三个的绝对路径；回复含「✈ 起飞」
  expect(artifactCommit(log)?.events).toBe(0)
  expect(log.adds.find(a => a.includes(`${TREE}/${CD}/proposal.md`))).toEqual(ARTIFACTS.map(p => `${TREE}/${p}`))
  expect(r.text).toContain('✈ 起飞')
})

test('takeoff-accepts-glued-authorization', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的只有 proposal.md、DRAFT-x.md 与 tests/test_s1.py
  const log = useWorld(on, demoWorld({ dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo授权提交（授权词粘在 change 名后面）
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo授权提交' })

  // Then: 按 change demo 起飞：有一次说明含「工件」的提交，回复含「✈ 起飞 demo」
  expect(artifactCommit(log)).toBeDefined()
  expect(r.text).toContain('✈ 起飞 demo')
})

test('takeoff-never-commits-before-approval', async ($, on) => {
  // Given: takeoff-gate.py 以 1 退出、stderr「未批准」；未提交的只有 proposal.md、DRAFT-x.md 与 tests/test_s1.py
  const log = useWorld(on, demoWorld({ takeoff: res(1, '', '未批准'), dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo 授权提交
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo 授权提交' })

  // Then: 回复含「起飞守卫未通过」；没有任何提交；账本没有 takeoff
  expect(r.text).toContain('起飞守卫未通过')
  expect(log.commits).toEqual([])
  expect(log.events.filter(x => x.ev === 'takeoff')).toEqual([])
})

test('takeoff-hints-authorization-for-artifacts', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的只有 proposal.md、DRAFT-x.md 与 tests/test_s1.py
  const log = useWorld(on, demoWorld({ dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo（不带授权词）
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「工作区不干净」与 `/opsx-apply demo 授权提交`；没有提交；账本没有 takeoff
  expect(r.text).toContain('工作区不干净')
  expect(r.text).toContain('/opsx-apply demo 授权提交')
  expect(log.commits).toEqual([])
  expect(log.events.filter(x => x.ev === 'takeoff')).toEqual([])
})

test('takeoff-refuses-foreign-dirt-even-authorized', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的有 proposal.md、DRAFT-x.md、tests/test_s1.py，还有 src/x.py
  const log = useWorld(on, demoWorld({ dirty: [...ARTIFACTS, 'src/x.py'] }))

  // When: 人发出 /opsx-apply demo 授权提交
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo 授权提交' })

  // Then: 回复含「工作区不干净」与 src/x.py、不含任何工件路径；没有提交；账本没有 takeoff
  expect(r.text).toContain('工作区不干净')
  expect(r.text).toContain('src/x.py')
  expect(ARTIFACTS.filter(p => r.text.includes(p))).toEqual([])
  expect(log.commits).toEqual([])
  expect(log.events.filter(x => x.ev === 'takeoff')).toEqual([])
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

test('agent-spawn-guard-denies-child-of-flight-agent', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发；插件之下的派发端记录派发
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  const before = log.spawns.length

  // When: 以非 flight 来源、父 agent 为 agent-1 派发 general-purpose
  const r = await $.agent.spawn({ prompt: 'p', description: 'd', subagentType: 'general-purpose', model: 'opus', parentAgentId: 'agent-1' } as never)

  // Then: 答 deny 且理由含「不得再派发」；派发没有到达派发端
  expect(r).toMatchObject({ deny: expect.stringContaining('不得再派发') })
  expect(log.spawns.length).toBe(before)
})

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

// ---------------------------------------------------------------- flight-envelope-tightening（S4）

test('bash-runs-in-own-worktree', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发（worktree 为 S1 切片路径）；插件之下的执行端记录到达的完整命令
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // When: agent-1 调用 Bash git status
  await $.tool.call({ tool: 'Bash', command: 'git status', agentId: 'agent-1' } as never)

  // Then: 执行端收到的命令为 cd '<S1 worktree>' && git status
  expect(log.reached).toEqual([`Bash cd '${SLICE1}' && git status`])
})

test('commit-outside-own-worktree-denied', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发（worktree 为 S1 切片路径）；插件之下的执行端记录到达的调用
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // When: agent-1 调用 Bash git -C <change worktree> commit -m x
  const r = await $.tool.call({ tool: 'Bash', command: `git -C ${TREE} commit -m x`, agentId: 'agent-1' } as never)

  // Then: 答 deny 且理由含「自己的 worktree」；命令没有到达执行端
  expect(r).toMatchObject({ deny: expect.stringContaining('自己的 worktree') })
  expect(log.reached).toEqual([])
})

test('read-outside-repo-not-upgraded', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发；插件之下的引擎依次判 ask、ask
  useWorld(on, demoWorld({ checks: ['ask', 'ask'] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  const calls = [
    { tool: 'Read', input: { file_path: '~/.ssh/id_rsa' }, agentId: 'agent-1' },
    { tool: 'Read', input: { file_path: `${SLICE1}/a.py` }, agentId: 'agent-1' },
  ]

  // When: 依次对 agent-1 的 Read ~/.ssh/id_rsa 与 Read <S1 worktree>/a.py 做权限判定
  const answers: { decision?: string }[] = []
  for (const c of calls) answers.push((await $.tool.check(c as never)) as { decision?: string })

  // Then: 前者原样为 ask，后者改答 allow
  expect(answers.map(a => a.decision)).toEqual(['ask', 'allow'])
})

test('pending-agent-writes-denied', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，agent-1 已派发，但 dispatch 事件写入账本总失败（agent-1 停在登记中）；插件之下的执行端记录到达的调用
  const log = useWorld(on, demoWorld({ dispatchFails: true }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // When: agent-1 调用 Write <S1 worktree>/src/s1.py
  const r = await $.tool.call({ tool: 'Write', file_path: `${SLICE1}/src/s1.py`, content: 'x\n', agentId: 'agent-1' } as never)

  // Then: 答 deny 且理由含「登记中」；写入没有到达执行端
  expect(r).toMatchObject({ deny: expect.stringContaining('登记中') })
  expect(log.reached).toEqual([])
})

test('takeoff-refuses-old-git', async ($, on) => {
  // Given: demo 已批准、起飞检查都过，但 git --version 输出 git version 2.37.1
  const log = useWorld(on, demoWorld({ gitVersion: 'git version 2.37.1' }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: 回复含「git ≥ 2.38」与当前版本 2.37.1；账本没有 takeoff
  expect(r.text).toContain('git ≥ 2.38')
  expect(r.text).toContain('2.37.1')
  expect(log.events.filter(x => x.ev === 'takeoff')).toEqual([])
})

// ---------------------------------------------------------------- flight-measure（S7）

const B1 = '1'.repeat(40)
const B2 = '2'.repeat(40)
const R = '9'.repeat(40)
const isMeasure = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/slice-gate.py') && x.argv[2] === 'measure'
const isGate = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/slice-gate.py') && x.argv[2] === 'gate'
const measureCall = (agentId: string) => ({ tool: 'mcp__flight__measure', agentId }) as never

test('measure-tool-records-event', async ($, on) => {
  // Given: demo 已起飞，S1 的 start 打印 base B1，agent-1 是 S1 的执行体（dispatch 带 base B1）；之后测量应答为目标 tests/test_demo.py::test_s1 FAILED、source 为空
  const w = demoWorld({ bases: { [SLICE1]: B1 } })
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  w.measures = { S1: res(0, measureJson('S1', B1, [['tests/test_demo.py::test_s1', 'FAILED']], [])) }
  const runsBefore = log.runs.length
  const eventsBefore = log.events.length

  // When: agent-1 调用 mcp__flight__measure
  const r = (await $.tool.call(measureCall('agent-1'))) as { result?: unknown }

  // Then: 执行端收到 slice-gate measure S1 --change-dir <D> --base B1、cwd 为 S1 worktree；账本新增一条 agent-1、S1、base B1 的 measure；结果含该目标、FAILED 与「本次见红」
  expect(log.runs.slice(runsBefore).filter(isMeasure).map(x => [x.argv.slice(2), x.cwd])).toEqual([[['measure', 'S1', '--change-dir', CD, '--base', B1], SLICE1]])
  expect(log.events.slice(eventsBefore)).toEqual([expect.objectContaining({ ev: 'measure', agent: 'agent-1', slice: 'S1', base: B1 })])
  expect(String(r.result)).toContain('tests/test_demo.py::test_s1')
  expect(String(r.result)).toContain('FAILED')
  expect(String(r.result)).toContain('本次见红')
})

test('measure-tool-only-for-flight-executors', async ($, on) => {
  // Given: demo 已起飞；agent-1 收口门禁绿并结束，S1 合回后派发了 S1 的评审员；agent-x 不属于任何飞行
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-1') as never)
  await $.turn.complete(ended('agent-1') as never)
  const reviewer = log.spawns.find(s => s.subagent_type === 'flight:reviewer')?.agentId ?? '没有评审员'
  const runsBefore = log.runs.length
  const eventsBefore = log.events.length

  // When: 评审员与 agent-x 依次调用 mcp__flight__measure
  const answers: unknown[] = []
  for (const id of [reviewer, 'agent-x']) answers.push(await $.tool.call(measureCall(id)))

  // Then: 两次都答 deny、理由含「只有本次飞行的执行体可以请求测量」；没有运行测量命令；账本没有新增 measure
  const denied = { deny: expect.stringContaining('只有本次飞行的执行体可以请求测量') }
  expect(answers).toEqual([denied, denied])
  expect(log.runs.slice(runsBefore).filter(isMeasure)).toEqual([])
  expect(log.events.slice(eventsBefore).filter(x => x.ev === 'measure')).toEqual([])
})

test('measure-tool-upgraded-for-executor', async ($, on) => {
  // Given: demo 已起飞，agent-1 是 S1 的执行体；agent-1 收口门禁绿并结束后派发了 S1 的评审员；插件之下的引擎对 mcp__flight__measure 一律判 ask
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-1') as never)
  await $.turn.complete(ended('agent-1') as never)
  const reviewer = log.spawns.find(s => s.subagent_type === 'flight:reviewer')?.agentId ?? '没有评审员'

  // When: 依次对 agent-1 与评审员的 mcp__flight__measure 调用做权限判定
  const answers: { decision?: string }[] = []
  for (const id of ['agent-1', reviewer]) answers.push((await $.tool.check({ tool: 'mcp__flight__measure', input: {}, agentId: id } as never)) as { decision?: string })

  // Then: agent-1 改答 allow，评审员仍为 ask
  expect(answers.map(a => a.decision)).toEqual(['allow', 'ask'])
})

test('fresh-dispatch-takes-start-measure', async ($, on) => {
  // Given: demo 已批准；S1 的切片 worktree 新建、start 打印 base B1；S2 的测量应答为退出 1（error 为 pytest 运行超时）
  const measures = { S2: res(1, JSON.stringify({ slice: 'S2', error: 'pytest 运行超时' })) }
  const log = useWorld(on, demoWorld({ bases: { [SLICE1]: B1 }, measures }))

  // When: 人发出 /opsx-apply demo，控制面派发 wave 1 的 S1 与 S2
  await $.command.run({ command: 'opsx-apply', args: 'demo' })

  // Then: S1 的事件依次为 measure（agent dispatch、base B1）与 dispatch（agent-1、base B1）；S2 记 blocked（infra），理由含「起点测量失败」；没有在 S2 worktree 派发
  expect(log.events.filter(x => x.slice === 'S1').map(x => [x.ev, x.agent, x.base])).toEqual([
    ['measure', 'dispatch', B1],
    ['dispatch', 'agent-1', B1],
  ])
  expect(log.events.find(x => x.ev === 'blocked' && x.slice === 'S2')).toMatchObject({ kind: 'infra', reason: expect.stringContaining('起点测量失败') })
  expect(log.spawns.filter(s => s.cwd === SLICE2)).toEqual([])
})

test('gate-runs-with-ledger-evidence', async ($, on) => {
  // Given: demo 已起飞，start 打印的 base：S1 worktree 为 B1、S2 worktree 为 B2、S2 解冲突 worktree 为 R；S2 合回时 a.py 冲突，S2 执行体收口并结束后派发了解冲突 agent
  const log = useWorld(on, demoWorld({ bases: { [SLICE1]: B1, [SLICE2]: B2, [RESOLVE2]: R }, conflicts: { S2: ['a.py'] } }))
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  await $.classic.SubagentStop(subagentStop('agent-2') as never)
  await $.turn.complete(ended('agent-2') as never)
  const resolver = log.spawns.at(-1)?.agentId ?? '没有解冲突 agent'

  // When: S1 的执行体 agent-1 与解冲突 agent 依次收口
  for (const id of ['agent-1', resolver]) await $.classic.SubagentStop(subagentStop(id) as never)

  // Then: S1 的 start 参数含 --evidence ledger；S1 收口门禁参数含 --evidence ledger --base B1；解冲突收口门禁参数含 --evidence ledger --base R --measure-base B2
  const gateAt = (cwd: string) => log.runs.find(x => isGate(x) && x.cwd === cwd)?.argv.join(' ') ?? ''
  expect(log.runs.find(isStartS1)?.argv.join(' ')).toContain('--evidence ledger')
  expect(gateAt(SLICE1)).toContain(`--evidence ledger --base ${B1}`)
  expect(gateAt(RESOLVE2)).toContain(`--evidence ledger --base ${R} --measure-base ${B2}`)
})

// 测试里插件从仓库目录加载、不在缓存目录下，「已装 ≠ 已加载」的拒飞路径由 versions.test.ts 覆盖；这里只验证接线
test('takeoff-checks-versions', async ($, on) => {
  // Given: demo 已批准、其余起飞检查都过；CLAUDE_CONFIG_DIR 为 /cfg，/cfg 下没有 installed_plugins.json；两种 ledger.py events 输出：缺 measure、列出全部 EVENT_TYPES
  const w = demoWorld({ env: { CLAUDE_CONFIG_DIR: '/cfg' } })
  const log = useWorld(on, w)
  const listings = [EVENT_TYPES.filter(x => x !== 'measure'), EVENT_TYPES]
  const replies: string[] = []
  const counts: number[] = []

  // When: 依次以这两种输出各发一次 /opsx-apply demo
  for (const types of listings) {
    w.eventTypes = types
    replies.push(String((await $.command.run({ command: 'opsx-apply', args: 'demo' })).text))
    counts.push(log.events.length)
  }

  // Then: 第一次回复含「主检出」且账本无事件；第二次回复含「✈ 起飞」「插件 」「已安装版本未核对」；插件读取过 /cfg/plugins/installed_plugins.json；账本首条为 takeoff
  expect(replies[0]).toContain('主检出')
  expect(counts[0]).toBe(0)
  expect(replies[1]).toContain('✈ 起飞')
  expect(replies[1]).toContain('插件 ')
  expect(replies[1]).toContain('已安装版本未核对')
  expect(log.asked).toContain('/cfg/plugins/installed_plugins.json')
  expect(log.events[0]?.ev).toBe('takeoff')
})

test('unknown-owner-fails-closed', async ($, on) => {
  // Given: demo 已起飞（在飞）；之后 ledger.py show 以 5 退出（对 agent-7 的账本读取失败）；插件之下的引擎对 Bash 判 ask
  const w = demoWorld({ checks: ['ask'] })
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo' })
  w.ledgerFails = true
  const calls = [
    { tool: 'Write', file_path: `${SLICE1}/src/s1.py`, content: 'x\n', agentId: 'agent-7' },
    { tool: 'Bash', command: 'git status', agentId: 'agent-7' },
  ]

  // When: agent-7 依次调用 Write 与 Bash，再对它的 Bash 做权限判定
  const answers: unknown[] = []
  for (const c of calls) answers.push(await $.tool.call(c as never))
  const check = (await $.tool.check({ tool: 'Bash', input: { command: 'git status' }, agentId: 'agent-7' } as never)) as { decision?: string }

  // Then: Write 与 Bash 都答 deny、理由含「归属判定失败」，都没有到达执行端；tool.check 仍为 ask
  const denied = { deny: expect.stringContaining('归属判定失败') }
  expect(answers).toEqual([denied, denied])
  expect(log.reached).toEqual([])
  expect(check.decision).toBe('ask')
})
