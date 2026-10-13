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
/** 人在终端发出的命令来源 */
const HUMAN = { origin: { kind: 'composer' } }

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
  /** 第 n 个 agent.spawn 返回前等它（用来让 drive 停在一个动作中途） */
  spawnHold?: (n: number) => Promise<void>
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
  /** slice-gate base 打印的 base：按切片 worktree 路径（缺省为 --base 参数，否则 base-<目录名>） */
  bases?: Record<string, string>
  /** slice-gate base 的整个结果（给了就覆盖 bases，用来模拟 G0 不过） */
  baseRun?: Run
  /** slice-gate preflight 输出的 waves（缺省 [[S1, S2], [S3]]） */
  waves?: string[][]
  /** session.model 的应答（缺省 claude-opus-5-5）；为 Error 时以其 message 拒绝（deny），$.session.model() 随即抛错。测试 hook 直接 throw 会被引擎跳过，到不了插件 */
  model?: string | Error
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
  /** slice-gate final 的结论（缺省无输出，按红记）；commit 缺省 c×40 */
  final?: Gate & { commit?: string }
  /** 在 change worktree 里第几次（从 1 数）`git merge --no-ff` 以非冲突原因失败 */
  mergeFails?: number[]
  /** TaskStop 的应答为 isError 及此文本（对已结束的 agent，引擎不抛错） */
  stopError?: string
  /** turn.complete 的最终回答：按 agentId（缺省空串） */
  answers?: Record<string, string>
  /** ui.notify 的应答（缺省 isSent true、channel iterm2） */
  notify?: Record<string, unknown>
  /** 这些 agent 的 turn.step（模型请求）一直不结束 */
  stalls?: string[]
  /** slice-gate features 的输出（缺省全部能力） */
  features?: string
  /** command.register 拒绝的命令名（模拟引擎拒绝与项目命令文件同名的注册） */
  registerRefuses?: string[]
  /** session.cwd 的应答（缺省 change worktree） */
  cwd?: string
  /** session.id 的应答（缺省 sess-1） */
  session?: string
  /** `git rev-parse --path-format=absolute --git-common-dir` 的输出（缺省 /repo/.git） */
  commonDir?: string
  /** intent-gate.py check 拒绝的绝对路径（缺省全部放行） */
  intentDenies?: string[]
  /** slice-gate gate 运行时以此消息拒绝（插件的 $.process.run 随即抛错） */
  gateThrows?: string
  /** 每次 process.run 到达世界时先调用（用来在某条命令运行时改动账本） */
  onRun?: (argv: string[]) => void
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

/** change worktree 的 HEAD（世界里不带分支名的 rev-parse 一律答它） */
const HEAD = 'd'.repeat(40)
const PR_VIEW = JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', headRefName: 'worktree-demo', headRefOid: HEAD, isDraft: true })
/** slice-gate ship 的裁决：ready */
const SHIP_READY = JSON.stringify({ ready: true, commit: HEAD, reasons: [], blocked: [], blocking: [], deferred: [], fix: null, review: { slice: 'whole', agent: 'r9', commit: HEAD } })

function res(exitCode: number, stdout: string, stderr = ''): Run {
  return { exitCode, stdout, stderr }
}

/** slice-gate measure 退出 0 时打印的 JSON */
function measureJson(slice: string, base: string, outcomes: [string, string][], source: string[], guards: string[] = []): string {
  return JSON.stringify({ slice, base, commit: 'c'.repeat(40), outcomes, unmeasurable: [], changed: source, source, guards, tail: '1 passed' })
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
    /** 插件登记的斜杠命令名 */
    registered: [] as string[],
    /** 插件 $.ui.open 的面板 id */
    opens: [] as string[],
    /** TaskStop 停过的 task_id，及当时账本是否已有 halt */
    stops: [] as { id: string; halted: boolean }[],
    /** 每次 TaskStop 时账本的事件数 */
    stopsAt: [] as number[],
    /** ui.notify 收到的事件 */
    notifies: [] as unknown[],
    /** mock.clock 的句柄（advance / settle） */
    clock: undefined as unknown as { advance(ms: number): unknown; settle(): unknown },
  }
  const exists = new Set<string>([`${TREE}/${CD}`, `${HOOKS}/slice-gate.py`, ...(w.paths ?? []), ...Object.keys(files)])
  const dirty = new Set<string>(w.dirty ?? [])
  // worktree add -b 建过的分支（freshWorktree 用 rev-parse --verify refs/heads/<分支> 查占用）
  const branches = new Set<string>()
  let agents = 0
  let merges = 0
  let conflicted = ''
  let pending: Record<string, unknown> | undefined
  log.clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) }) as never
  mock.env(on, w.env ?? {})
  on('session.version', () => ({ value: { version: '2.1.295' } }))
  on('session.id', () => ({ value: w.session ?? 'sess-1' }))
  on('session.cwd', () => ({ value: w.cwd ?? TREE }))
  on('session.model', () => {
    if (w.model instanceof Error) return { deny: w.model.message } as never
    return { value: w.model ?? 'claude-opus-5-5' }
  })
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
  on('turn.complete', ($, e) => ({ text: w.answers?.[String((e as { agentId?: unknown }).agentId)] ?? '' }))
  on('ui.notify', ($, e) => {
    log.notifies.push(e)
    return { value: w.notify ?? { isSent: true, channel: 'iterm2' } } as never
  })
  // 插件之下没有实现应答 turn.step：stalls 里的 agent 的请求永不结束
  on('turn.step', async function* ($, e) {
    if (w.stalls?.includes(String((e as { agentId?: unknown }).agentId))) await new Promise(() => undefined)
    return {} as never
  } as never)
  on('classic.SubagentStop', () => ({}))
  on('command.run', ($, e) => {
    log.commands.push(`${e.command} ${e.args ?? ''}`)
    return { text: 'from-model' }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    if (w.registerRefuses?.includes(e.name)) throw new Error(`$.command.register: "/${e.name}" refused: it is the user's /${e.name}`)
    log.registered.push(e.name)
    return { value: { command: e.name } }
  })
  // 插件之下的引擎绘制（插件没有接 Pane 时由它作答）
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine">
        <Text>engine</Text>
      </Box>
    )
  })
  on('ui.open', ($, e) => {
    log.opens.push(String((e as unknown as { id?: unknown }).id))
    return { value: undefined } as never
  })
  on('tool.call', ($, e) => {
    const x = e as unknown as { tool: string; file_path?: string; notebook_path?: string; command?: string; task_id?: string }
    if (x.tool === 'TaskStop') {
      log.stops.push({ id: String(x.task_id), halted: log.events.some(y => y.ev === 'halt') })
      log.stopsAt.push(log.events.length)
      if (w.stopError) return { result: w.stopError, isError: true, text: w.stopError } as never
      return { result: { message: `Successfully stopped task: ${x.task_id}` } } as never
    }
    log.reached.push(`${x.tool} ${x.file_path ?? x.notebook_path ?? x.command ?? ''}`)
    return { result: {}, text: '' } as never
  })
  const checks = [...(w.checks ?? [])]
  on('tool.check', () => ({ decision: checks.shift() ?? 'ask' }) as never)
  on('agent.spawn', async ($, e) => {
    const x = e as unknown as Omit<Spawn, 'agentId'>
    if (w.spawnThrows) throw new Error('spawn 炸了')
    agents += 1
    const agentId = `agent-${agents}`
    log.spawns.push({ subagent_type: x.subagent_type, model: x.model, cwd: x.cwd, prompt: x.prompt, agentId })
    if (w.spawnHold) await w.spawnHold(agents)
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
    w.onRun?.(argv)
    if (argv[0] === 'python3') {
      const script = String(argv[1]).split('/').pop()
      const sub = argv[2]
      if (script === 'takeoff-gate.py') return wrap(w.takeoff)
      // check --cwd <C> <PATH>…：intentDenies 里的路径拒绝，其余放行
      if (script === 'intent-gate.py' && sub === 'check') {
        const denied = argv.slice(5).filter(p => (w.intentDenies ?? []).includes(p)).map(path => ({ path, reason: '无 apply 上下文' }))
        return wrap(res(0, JSON.stringify({ allow: denied.length === 0, denied }) + '\n'))
      }
      // 测试 hook 直接 throw 会被引擎跳过：以 deny 拒绝，插件的 $.process.run 随即抛出含该消息的错误
      if (script === 'slice-gate.py' && sub === 'gate' && w.gateThrows) return { deny: w.gateThrows } as never
      if (script === 'plan_fp.py') return wrap(w.fpRun ?? res(0, (w.fp ?? F) + '\n'))
      // 起飞不写 timeline：见到 record approve 就报错
      if (script === 'timeline.py' && sub === 'record' && argv[3] === 'approve') throw new Error(`unexpected argv: ${argv.join(' ')}`)
      if (script === 'timeline.py') return wrap(res(0, ''))
      if (script === 'ledger.py' && sub === 'events') return wrap(res(0, (w.eventTypes ?? EVENT_TYPES).join('\n') + '\n'))
      if (script === 'ledger.py' && w.ledgerFails) return wrap(res(5, '', '账本 ref 读不出'))
      if (script === 'ledger.py') return wrap(res(0, log.events.map(x => JSON.stringify(x)).join('\n') + '\n'))
      if (script === 'slice-gate.py' && sub === 'features') return wrap(res(0, w.features ?? 'evidence-ledger-only\ng5-per-target\nguards\nship-ledger\nledger-records\ninteg-guard\n'))
      if (script === 'slice-gate.py' && sub === 'ship') return wrap(res(0, SHIP_READY))
      if (script === 'slice-gate.py' && sub === 'preflight') return wrap(res(0, JSON.stringify(w.waves ?? [['S1', 'S2'], ['S3']]) + '\n'))
      if (script === 'slice-gate.py' && sub === 'gate') {
        const s = String(argv[3])
        const queue = w.gates[s] ?? []
        const g = (queue.length > 1 ? queue.shift() : queue[0]) ?? { ok: true, failed: [] }
        return wrap(res(g.ok ? 0 : 1, JSON.stringify({ slice: s, ok: g.ok, commit: 'c'.repeat(40), failed: g.failed })))
      }
      if (script === 'slice-gate.py' && sub === 'base') {
        if (w.baseRun) return wrap(w.baseRun)
        const b = baseOf(argv) ?? w.bases?.[String(cwd)] ?? `base-${String(cwd).split('/').pop()}`
        return wrap(res(0, JSON.stringify({ slice: argv[3], base: b })))
      }
      if (script === 'slice-gate.py' && sub === 'measure') {
        const s = String(argv[3])
        return wrap(w.measures?.[s] ?? res(0, measureJson(s, baseOf(argv) ?? '', [[`tests/test_demo.py::test_${s.toLowerCase()}`, 'XFAIL']], [])))
      }
      if (script === 'slice-gate.py' && sub === 'final' && w.final) {
        return wrap(res(w.final.ok ? 0 : 1, JSON.stringify({ slice: 'final', ok: w.final.ok, commit: w.final.commit ?? 'c'.repeat(40), failed: w.final.failed })))
      }
      if (script === 'slice-gate.py') return wrap(res(0, ''))
      throw new Error(`unexpected argv: ${argv.join(' ')}`)
    }
    // gh：pr view 应答 PR 7（头分支 worktree-demo、头 commit 与 change worktree 的 HEAD 相同、draft）；pr comment / pr ready 一律成功
    if (argv[0] === 'gh') return wrap(argv[2] === 'view' ? res(0, PR_VIEW) : res(0, ''))
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
        branches.add(String(args[3]))
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
        if (args.includes('--git-common-dir')) return wrap(res(0, (w.commonDir ?? `${MAIN}/.git`) + '\n'))
        const head = args.find(a => String(a).startsWith('refs/heads/'))
        if (head) return wrap(res(branches.has(String(head).slice('refs/heads/'.length)) ? 0 : 1, ''))
        // 切片分支尖端：tip-<切片>（integrated 的切片据此在第一父链的合并提交里当第二父）
        const ref = args.find(a => String(a).startsWith('flight/demo/'))
        return wrap(res(0, ref ? `tip-${String(ref).split('/').pop()}\n` : 'd'.repeat(40) + '\n'))
      }
      case 'commit-tree':
        return wrap(res(0, 'c'.repeat(40) + '\n'))
      case 'remote':
        return wrap(res(0, 'git@github.com:o/r.git\n'))
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
        if (args[1] === '--no-ff' && cwd === TREE) merges += 1
        if (args[1] === '--no-ff' && cwd === TREE && w.mergeFails?.includes(merges)) return wrap(res(128, '', 'fatal: refusing to merge unrelated histories'))
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

/** 最后一条 halt；其后只允许诊断员的 dispatch / ended / triage（停飞后派诊断员），否则为 undefined */
function haltAtEnd(events: Record<string, unknown>[]): Record<string, unknown> | undefined {
  const i = events.map(x => x.ev).lastIndexOf('halt')
  if (i < 0) return undefined
  const diag = new Set(events.filter(x => x.ev === 'dispatch' && x.role === 'diagnostician').map(x => String(x.agent)))
  const tail = events.slice(i + 1)
  const ok = tail.every(x => (x.ev === 'dispatch' && x.role === 'diagnostician') || ((x.ev === 'ended' || x.ev === 'triage') && diag.has(String(x.agent))))
  return ok ? events[i] : undefined
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
  // Given: demo 已批准（takeoff-gate 退出 0）、worktree 干净、lint/preflight 绿、waves [[S1, S2], [S3]]、session.model 应答 claude-opus-5-5
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 回复含「未批准」与 spec.html 绝对路径；账本没有事件、没有派发
  expect(r.text).toContain('未批准')
  expect(r.text).toContain(`${TREE}/${CD}/spec.html`)
  expect(log.events).toEqual([])
  expect(log.spawns).toEqual([])
})

test('engine-workflow-refused', async ($, on) => {
  // Given: 插件已加载，世界里 demo 已批准
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo --engine=workflow
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo --engine=workflow', ...HUMAN } as never)

  // Then: 插件作答含「旧 Workflow 引擎已删除」与 DRAFT-flight-single-implementation；命令没到达模型；账本没有事件
  expect(r.text).toContain('旧 Workflow 引擎已删除')
  expect(r.text).toContain('DRAFT-flight-single-implementation')
  expect(log.commands).toEqual([])
  expect(log.events).toEqual([])
})

test('per-task-passes-through', async ($, on) => {
  // Given: 插件已加载，世界里 demo 已批准；项目已有 /opsx-apply 命令文件（command.register 拒绝 opsx-apply），会话已开始
  const log = useWorld(on, demoWorld({ registerRefuses: ['opsx-apply'] }))
  await $.session.start(START as never)

  // When: 人发出 /opsx-apply demo --gate=per-task
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo --gate=per-task', ...HUMAN } as never)

  // Then: 命令原样到达模型并由它作答（legacy 路径）；账本没有事件
  expect(log.commands).toEqual(['opsx-apply demo --gate=per-task'])
  expect(r.text).toBe('from-model')
  expect(log.events).toEqual([])
})

test('stop-gate-blocks-red-executor', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 的执行体 A 是 agent-1；它收口时 S1 门禁 ok false、failed [G7 demo#s1]
  const log = useWorld(on, demoWorld({ gates: { S1: [{ ok: false, failed: ['G7 demo#s1'] }] } }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 插件作答且回复含「起飞异常」；命令没有交给模型
  expect(r.text).toContain('起飞异常')
  expect(log.commands).toEqual([])
})

test('drive-hands-landing-actions', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；A 收口时 S1 门禁绿，在 change worktree 合回 S1 无冲突
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  await $.classic.SubagentStop(subagentStop('agent-1') as never)
  w.spawnThrows = true

  // When: 处理 A 的结束（turn.complete），drive 合回 S1 后派发评审员
  const outcome = await $.turn.complete(ended('agent-1') as never).then(
    () => 'resolved',
    (err: unknown) => `rejected: ${String(err)}`,
  )

  // Then: 处理正常返回、异常不冒到引擎；最后一条 halt 之后只有诊断员的事件，原因含「动作异常」
  expect(outcome).toBe('resolved')
  expect(haltAtEnd(log.events)).toMatchObject({ ev: 'halt', reason: expect.stringContaining('动作异常') })
})

// PR #39 评审 HIGH（R1）：指纹算不出时写进账本的空 fp 会让整条账本判损坏、起飞被永久拒绝
test('takeoff-refuses-bad-fingerprint', async ($, on) => {
  // Given: 起飞检查都过，但 plan_fp.py 以 1 退出，stderr 为「读取 slices.json 失败」
  const log = useWorld(on, demoWorld({ fpRun: res(1, '', '读取 slices.json 失败') }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  w.fpRun = res(1, '', 'plan_fp 超时')

  // When: 处理 A 的结束（turn.complete）
  await $.turn.complete(ended('agent-1') as never)

  // Then: 最后一条 halt 之后只有诊断员的事件，原因含「计算计划指纹失败」与「plan_fp 超时」、不含「计划指纹已变」；$.ui.log 收到含「停飞 · demo」的文本
  const last = haltAtEnd(log.events)
  expect(last).toMatchObject({ ev: 'halt', reason: expect.stringContaining('计算计划指纹失败') })
  expect(String(last?.reason)).toContain('plan_fp 超时')
  expect(String(last?.reason)).not.toContain('计划指纹已变')
  expect(log.logs.some(t => t.includes('停飞 · demo'))).toBe(true)
})

test('executor-dispatch-commits-records-first', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，waves [[S1, S2], [S3]]；世界跟踪飞行记录的提交状态；S1（agent-1）已收口结束并合回，S2（agent-2）已收口——合回 S2 后刷新的 slices/_interfaces.md 尚未提交
  const log = useWorld(on, demoWorld({ tracksRecords: true }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 回复含「仍在运行」；账本仍只有预置的 3 条事件（没有新的 takeoff）
  expect(r.text).toContain('仍在运行')
  expect(log.events.length).toBe(3)
})

test('merge-survives-missing-interfaces-summary', async ($, on) => {
  // Given: /opsx-apply demo 已起飞（S1 的执行体 A = agent-1）；世界的 fs.read 对不存在的文件抛 ENOENT，change 目录还没有 slices/_interfaces.md；A 收口时 S1 门禁绿
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
const isBaseS1 = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/slice-gate.py') && x.argv[2] === 'base' && x.argv[3] === 'S1'
const baseOf = (argv: string[]) => (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : undefined)

test('resume-regates-green-slice', async ($, on) => {
  // Given: 账本预置 attempt 1 的 takeoff、S1 执行体 agent-1 的 dispatch（worktree 为 S1 切片路径）、S1 gate（ok，base B）、halt；S1 切片 worktree 仍在；补跑门禁缺省绿
  const log = useWorld(on, demoWorld({ ledger: haltedWithGreenS1(), paths: [SLICE1] }))

  // When: 人再次发出 /opsx-apply demo（attempt 2 起飞并 drive）
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: slice-gate base S1 带 --base B；在 S1 worktree 派发了一次执行体
  expect(log.runs.filter(isBaseS1).map(x => baseOf(x.argv))).toEqual([BASE_B])
  expect(log.spawns.filter(s => s.cwd === SLICE1).map(s => s.subagent_type)).toEqual(['flight:executor'])
})

test('takeoff-commits-leftover-records', async ($, on) => {
  // Given: demo 已批准、attempt 1 已 halt；change worktree 只有 <change 目录>/timeline.md 与 gate-report.md 未提交
  const ledger = haltedWithGreenS1()
  const log = useWorld(on, demoWorld({ ledger, dirty: [`${CD}/timeline.md`, `${CD}/gate-report.md`] }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 「chore(flight): 记录」的提交发生在 takeoff 事件写入之前；回复含「✈ 起飞」
  expect(log.commits.find(c => c.message === 'chore(flight): 记录')?.events).toBe(ledger.length)
  expect(r.text).toContain('✈ 起飞')
})

test('takeoff-commits-leftover-records/foreign-dirty', async ($, on) => {
  // Given: demo 已批准、attempt 1 已 halt；未提交的有 <change 目录>/timeline.md、gate-report.md 与 src/x.py
  const ledger = haltedWithGreenS1()
  const log = useWorld(on, demoWorld({ ledger, dirty: [`${CD}/timeline.md`, `${CD}/gate-report.md`, 'src/x.py'] }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 回复含「工作区不干净」；账本没有新的 takeoff
  expect(r.text).toContain('工作区不干净')
  expect(log.events.filter(x => x.ev === 'takeoff').length).toBe(1)
})

const artifactCommit = (log: { commits: { message: string; events: number }[] }) => log.commits.find(c => c.message.includes('工件'))

test('takeoff-commits-artifacts-when-authorized', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的只有 <change 目录>/proposal.md、template/openspec/adr/DRAFT-x.md 与 scenario 测试文件 tests/test_s1.py
  const log = useWorld(on, demoWorld({ dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo 授权提交
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo 授权提交', ...HUMAN } as never)

  // Then: 有一次说明含「工件」的提交、发生在 takeoff 事件写入之前（当时账本 0 条）；加入 proposal.md 的那次 git add 路径恰为这三个的绝对路径；回复含「✈ 起飞」
  expect(artifactCommit(log)?.events).toBe(0)
  expect(log.adds.find(a => a.includes(`${TREE}/${CD}/proposal.md`))).toEqual(ARTIFACTS.map(p => `${TREE}/${p}`))
  expect(r.text).toContain('✈ 起飞')
})

test('takeoff-accepts-glued-authorization', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的只有 proposal.md、DRAFT-x.md 与 tests/test_s1.py
  const log = useWorld(on, demoWorld({ dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo授权提交（授权词粘在 change 名后面）
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo授权提交', ...HUMAN } as never)

  // Then: 按 change demo 起飞：有一次说明含「工件」的提交，回复含「✈ 起飞 demo」
  expect(artifactCommit(log)).toBeDefined()
  expect(r.text).toContain('✈ 起飞 demo')
})

test('takeoff-never-commits-before-approval', async ($, on) => {
  // Given: takeoff-gate.py 以 1 退出、stderr「未批准」；未提交的只有 proposal.md、DRAFT-x.md 与 tests/test_s1.py
  const log = useWorld(on, demoWorld({ takeoff: res(1, '', '未批准'), dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo 授权提交
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo 授权提交', ...HUMAN } as never)

  // Then: 回复含「起飞守卫未通过」；没有任何提交；账本没有 takeoff
  expect(r.text).toContain('起飞守卫未通过')
  expect(log.commits).toEqual([])
  expect(log.events.filter(x => x.ev === 'takeoff')).toEqual([])
})

test('takeoff-hints-authorization-for-artifacts', async ($, on) => {
  // Given: demo 已批准、账本为空；未提交的只有 proposal.md、DRAFT-x.md 与 tests/test_s1.py
  const log = useWorld(on, demoWorld({ dirty: ARTIFACTS }))

  // When: 人发出 /opsx-apply demo（不带授权词）
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo 授权提交', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  w.fpRun = res(1, '', 'plan_fp 超时')
  const edit = { tool: 'Edit', file_path: `${TREE}/src/a.py`, old_string: 'a', new_string: 'b' }

  // When: 主会话 Edit <change worktree>/src/a.py 一次；agent-1 结束、attempt 1 停飞后，主会话再 Edit 一次
  const before = await $.tool.call(edit as never)
  await $.turn.complete(ended('agent-1') as never)
  await $.tool.call(edit as never)

  // Then: 停飞前答 deny 且理由含「只读」；最后一条 halt 之后只有诊断员的事件；停飞后的 Edit 到达执行端
  expect(before).toMatchObject({ deny: expect.stringContaining('只读') })
  expect(haltAtEnd(log.events)?.ev).toBe('halt')
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // When: agent-1 调用 Bash git status
  await $.tool.call({ tool: 'Bash', command: 'git status', agentId: 'agent-1' } as never)

  // Then: 执行端收到的命令为 cd '<S1 worktree>' && git status
  expect(log.reached).toEqual([`Bash cd '${SLICE1}' && git status`])
})

test('commit-outside-own-worktree-denied', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发（worktree 为 S1 切片路径）；插件之下的执行端记录到达的调用
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // When: agent-1 调用 Bash git -C <change worktree> commit -m x
  const r = await $.tool.call({ tool: 'Bash', command: `git -C ${TREE} commit -m x`, agentId: 'agent-1' } as never)

  // Then: 答 deny 且理由含「自己的 worktree」；命令没有到达执行端
  expect(r).toMatchObject({ deny: expect.stringContaining('自己的 worktree') })
  expect(log.reached).toEqual([])
})

test('read-outside-repo-not-upgraded', async ($, on) => {
  // Given: /opsx-apply demo 已起飞，S1 执行体 agent-1 已派发；插件之下的引擎依次判 ask、ask
  useWorld(on, demoWorld({ checks: ['ask', 'ask'] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  await $.classic.SubagentStop(subagentStop('agent-2') as never)
  await $.turn.complete(ended('agent-2') as never)
  const resolver = log.spawns.at(-1)?.agentId ?? '没有解冲突 agent'

  // When: S1 的执行体 agent-1 与解冲突 agent 依次收口
  for (const id of ['agent-1', resolver]) await $.classic.SubagentStop(subagentStop(id) as never)

  // Then: S1 的 base 参数不带 --evidence；S1 收口门禁参数含 --evidence ledger --base B1；解冲突收口门禁参数含 --evidence ledger --base R --measure-base B2
  const gateAt = (cwd: string) => log.runs.find(x => isGate(x) && x.cwd === cwd)?.argv.join(' ') ?? ''
  expect(log.runs.find(isBaseS1)?.argv.join(' ') ?? '--evidence 没有 base 调用').not.toContain('--evidence')
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
    replies.push(String((await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)).text))
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
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
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

// ---------------------------------------------------------------- flight-measure-followups（S5）

const SLICE1_A2 = `${MAIN}/.claude/worktrees/flight-demo-S1-a2`
const FIX_TREE = `${MAIN}/.claude/worktrees/flight-demo-fix`
const FIX_A2 = `${MAIN}/.claude/worktrees/flight-demo-fix-a2`
const OTHER = { ...B0, session: 'other-session-1234' }
const HIGH_FINDING = { severity: 'HIGH' as const, file: 'src/s1.py', line: 3, summary: '漏判空列表', fix: '补判空' }
const runOf = (log: { runs: { argv: string[] }[] }, text: string) => log.runs.some(x => x.argv.join(' ').includes(text))

test('fresh-dispatch-gets-new-worktree', async ($, on) => {
  // Given: 账本预置 attempt 1 的 takeoff（指纹 F）、S1 执行体 old-1 在 flight-demo-S1 的 dispatch、S1 的 blocked 与 halt；flight-demo-S1 仍在；
  //        人再次发 /opsx-apply demo（attempt 2）后，S1 的新执行体收口门禁绿
  const ledger = [
    ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }),
    ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'executor', agent: 'old-1', model: 'opus', worktree: SLICE1 }),
    ev.blocked(B0, { attempt: 1, slice: 'S1', kind: 'gate', reason: '门禁红' }),
    ev.halt(B0, { attempt: 1, reason: '切片 blocked' }),
  ]
  const log = useWorld(on, demoWorld({ ledger, paths: [SLICE1] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const s1 = log.spawns.find(s => s.cwd === SLICE1_A2)
  await $.classic.SubagentStop(subagentStop(s1?.agentId ?? '没有 S1 执行体') as never)

  // When: S1 的新执行体结束（turn.complete），drive 合回 S1
  await $.turn.complete(ended(s1?.agentId ?? '没有 S1 执行体') as never)

  // Then: 执行端收到 git worktree add -b flight/demo/S1-a2 <flight-demo-S1-a2>；attempt 2 的 S1 dispatch 记该 worktree 与分支；
  //       提示词含上一次的分支 `flight/demo/S1`；合回的 merge --no-ff 合并 flight/demo/S1-a2
  expect(runOf(log, `worktree add -b flight/demo/S1-a2 ${SLICE1_A2} worktree-demo`)).toBe(true)
  expect(log.events.find(x => x.ev === 'dispatch' && x.attempt === 2 && x.slice === 'S1')).toMatchObject({ worktree: SLICE1_A2, branch: 'flight/demo/S1-a2' })
  expect(s1?.prompt).toContain('`flight/demo/S1`')
  expect(runOf(log, `-C ${TREE} merge --no-ff flight/demo/S1-a2`)).toBe(true)
})

test('continuation-reuses-same-plan-worktree', async ($, on) => {
  // Given: 账本预置 attempt 1 的 takeoff（指纹 F）、S1 执行体 old-1 在 flight-demo-S1 的 dispatch（无 branch 字段）、S1 gate（ok false、base B）、halt；
  //        flight-demo-S1 仍在；attempt 2 以同一指纹 F 起飞
  const ledger = [
    ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }),
    ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'executor', agent: 'old-1', model: 'opus', worktree: SLICE1 }),
    ev.gate(B0, { attempt: 1, agent: 'old-1', slice: 'S1', ok: false, commit: 'c'.repeat(40), failed: ['G7 demo#s1'], base: BASE_B }),
    ev.halt(B0, { attempt: 1, reason: '会话中断' }),
  ]
  const log = useWorld(on, demoWorld({ ledger, paths: [SLICE1] }))

  // When: 人发出 /opsx-apply demo，控制面派发 S1 的执行体
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 没有建 S1 的 worktree；S1 的执行体在 flight-demo-S1 派发；attempt 2 的 S1 dispatch 的 branch 为 flight/demo/S1；提示词含「这是续接」
  expect(runOf(log, 'worktree add -b flight/demo/S1')).toBe(false)
  expect(log.spawns.filter(s => s.cwd === SLICE1).length).toBe(1)
  expect(log.events.find(x => x.ev === 'dispatch' && x.attempt === 2 && x.slice === 'S1')).toMatchObject({ worktree: SLICE1, branch: 'flight/demo/S1' })
  expect(log.spawns.find(s => s.cwd === SLICE1)?.prompt).toContain('这是续接')
})

test('fixer-gets-new-worktree', async ($, on) => {
  // Given: 账本预置 attempt 1：S1/S2/S3 都已合回并评审（S1 有一条 HIGH），派过修复体 old-fix（worktree flight-demo-fix）后 halt；flight-demo-fix 仍在；
  //        修复 worktree 里 final 为绿；人再次发 /opsx-apply demo（attempt 2）派出修复体，它收口门禁绿
  const merged = (slice: string) => ev.merge(B0, { attempt: 1, slice, ok: true, commit: 'c'.repeat(40), failed: [] })
  const reviewed = (slice: string, findings: (typeof HIGH_FINDING)[]) => ev.review(B0, { attempt: 1, slice, agent: `r-${slice}`, findings })
  const ledger = [
    ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }),
    merged('S1'), merged('S2'), merged('S3'),
    reviewed('S1', [HIGH_FINDING]), reviewed('S2', []), reviewed('S3', []),
    ev.dispatch(B0, { attempt: 1, slice: 'fix', role: 'fixer', agent: 'old-fix', model: 'opus', worktree: FIX_TREE }),
    ev.halt(B0, { attempt: 1, reason: '会话中断' }),
  ]
  const log = useWorld(on, demoWorld({ ledger, paths: [FIX_TREE], final: { ok: true, failed: [] } }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const fixer = log.spawns.find(s => s.cwd === FIX_A2)
  await $.classic.SubagentStop({ ...subagentStop(fixer?.agentId ?? '没有修复体'), agent_type: 'flight:fixer' } as never)

  // When: 修复体结束（turn.complete），drive 合回修复
  await $.turn.complete(ended(fixer?.agentId ?? '没有修复体') as never)

  // Then: 执行端收到 git worktree add -b flight/demo/fix-a2 <flight-demo-fix-a2>；attempt 2 的修复体 dispatch 的 branch 为 flight/demo/fix-a2；修复合回的 merge --no-ff 合并它
  expect(runOf(log, `worktree add -b flight/demo/fix-a2 ${FIX_A2} worktree-demo`)).toBe(true)
  expect(log.events.find(x => x.ev === 'dispatch' && x.attempt === 2 && x.role === 'fixer')).toMatchObject({ worktree: FIX_A2, branch: 'flight/demo/fix-a2' })
  expect(runOf(log, `-C ${TREE} merge --no-ff flight/demo/fix-a2`)).toBe(true)
})

test('cross-session-takeoff-refused', async ($, on) => {
  // Given: 账本只有 attempt 1 的 takeoff，by.session 为 other-session-1234，没有 land / halt；本会话 id 为 sess-1
  const ledger = [ev.takeoff(OTHER, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' })]
  const log = useWorld(on, demoWorld({ ledger }))
  const replies: string[] = []
  const counts: number[] = []

  // When: 本会话依次发出 /opsx-apply demo 与 /opsx-apply demo --takeover
  for (const args of ['demo', 'demo --takeover']) {
    replies.push(String((await $.command.run({ command: 'opsx-apply', args, ...HUMAN } as never)).text))
    counts.push(log.events.length)
  }

  // Then: 第一次回复含「另一个会话」「other-se」「--takeover」，账本仍只有 1 条；第二次回复含「✈ 起飞」，账本有 attempt 2 的 takeoff，其 takeover 为 other-session-1234
  expect(replies[0]).toContain('另一个会话')
  expect(replies[0]).toContain('other-se')
  expect(replies[0]).toContain('--takeover')
  expect(counts[0]).toBe(1)
  expect(replies[1]).toContain('✈ 起飞')
  expect(log.events.find(x => x.ev === 'takeoff' && x.attempt === 2)).toMatchObject({ takeover: 'other-session-1234' })
})

test('cross-session-takeoff-refused/old-session-stops-driving', async ($, on) => {
  // Given: 本会话（sess-1）起飞 demo（attempt 1）并派出执行体；之后另一个会话 other-session-1234 以 --takeover 接管，
  //   账本追加 attempt 2 的 takeoff（takeover 为 sess-1）
  const log = useWorld(on, demoWorld())
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const s1 = log.spawns[0]
  log.events.push({ ...ev.takeoff(OTHER, { attempt: 2, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }), takeover: 'sess-1' })
  const spawns = log.spawns.length
  await $.classic.SubagentStop(subagentStop(s1?.agentId ?? '没有执行体') as never)

  // When: 本会话 attempt 1 的执行体结束（turn.complete）
  await $.turn.complete(ended(s1?.agentId ?? '没有执行体') as never)

  // Then: 本会话不再驱动接管后的 attempt：账本里 attempt 2 只有那条 takeoff，也没有新的派发
  expect(log.events.filter(x => Number(x.attempt) === 2).map(x => x.ev)).toEqual(['takeoff'])
  expect(log.spawns.length).toBe(spawns)
})

test('halted-attempt-from-other-session-resumes', async ($, on) => {
  // Given: 账本有 attempt 1 的 takeoff 与 halt，都来自 other-session-1234；本会话 id 为 sess-1
  const ledger = [
    ev.takeoff(OTHER, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' }),
    ev.halt(OTHER, { attempt: 1, reason: '会话中断' }),
  ]
  const log = useWorld(on, demoWorld({ ledger }))

  // When: 本会话发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 回复含「✈ 起飞」；账本有 attempt 2 的 takeoff，且它没有 takeover 字段
  expect(r.text).toContain('✈ 起飞')
  expect('takeover' in (log.events.find(x => x.ev === 'takeoff' && x.attempt === 2) ?? { takeover: '没有 attempt 2 的 takeoff' })).toBe(false)
})

test('measure-unknown-owner-says-retry', async ($, on) => {
  // Given: demo 已起飞（在飞），agent-1 是 S1 的执行体；之后 ledger.py show 以 5 退出（账本读取失败）
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  w.ledgerFails = true
  const runsBefore = log.runs.length

  // When: agent-1 调用 mcp__flight__measure
  const r = (await $.tool.call(measureCall('agent-1'))) as { deny?: string }

  // Then: 被拒，理由含「暂时无法判定」与「稍后重试」、不含「只有本次飞行的执行体」；没有运行 slice-gate measure
  expect(r.deny).toContain('暂时无法判定')
  expect(r.deny).toContain('稍后重试')
  expect(r.deny).not.toContain('只有本次飞行的执行体')
  expect(log.runs.slice(runsBefore).filter(isMeasure)).toEqual([])
})

test('measure-hints-unguarded-pass', async ($, on) => {
  // Given: demo 已起飞，S1 的 start 打印 base B1，agent-1 是 S1 的执行体；两份测量应答都是
  //   tests/test_demo.py::test_a PASSED、tests/test_demo.py::test_b FAILED、source 为空，guards 依次为 [] 与 [test_a]
  const w = demoWorld({ bases: { [SLICE1]: B1 } })
  useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const outcomes: [string, string][] = [['tests/test_demo.py::test_a', 'PASSED'], ['tests/test_demo.py::test_b', 'FAILED']]
  const answers = [[], ['tests/test_demo.py::test_a']].map(guards => res(0, measureJson('S1', B1, outcomes, [], guards)))

  // When: agent-1 依次在两份应答下调用 mcp__flight__measure
  const results: string[] = []
  for (const a of answers) {
    w.measures = { S1: a }
    results.push(String(((await $.tool.call(measureCall('agent-1'))) as { result?: unknown }).result))
  }

  // Then: 第一次结果含 test_a、「在改生产代码之前就已通过」「护栏」「不要改坏生产代码造红」；第二次结果不含「在改生产代码之前就已通过」
  expect(results[0]).toContain('tests/test_demo.py::test_a')
  expect(results[0]).toContain('在改生产代码之前就已通过')
  expect(results[0]).toContain('护栏')
  expect(results[0]).toContain('不要改坏生产代码造红')
  expect(results[1]).not.toContain('在改生产代码之前就已通过')
})

// ---------------------------------------------------------------- flight-interaction（S4）

const START = { cwd: TREE, surface: 'terminal', isInteractive: true } as const
const PANE = { component: 'Pane', requestId: 'flight', props: {}, viewport: { columns: 120, rows: 30 } } as const

test('flight-status-prints-progress', async ($, on) => {
  // Given: 插件已加载、会话已启动；demo 已由 /opsx-apply 起飞（attempt 1，waves [[S1, S2], [S3]]）
  const log = useWorld(on, demoWorld())
  await $.session.start(START as never)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // When: 依次发出 /flight status demo 与不带 change 的 /flight status
  const replies: string[] = []
  for (const args of ['status demo', 'status']) replies.push(String((await $.command.run({ command: 'flight', args })).text))

  // Then: 会话开始时登记过 flight 命令；两次回复都含 demo、attempt 1、W1/2
  expect(log.registered).toContain('flight')
  for (const r of replies) {
    expect(r).toContain('demo')
    expect(r).toContain('attempt 1')
    expect(r).toContain('W1/2')
  }
})

test('flight-abort-stops-agents', async ($, on) => {
  // Given: demo 已起飞并派出 agent-1（S1）、agent-2（S2），agent.list 里两者都是 running
  const log = useWorld(on, demoWorld({ agents: [{ id: 'agent-1', status: 'running' }, { id: 'agent-2', status: 'running' }] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const before = log.events.length

  // When: 人在终端发出 /flight abort demo，随后 agent-1 以 aborted 结束
  await $.command.run({ command: 'flight', args: 'abort demo', ...HUMAN } as never)
  await $.turn.complete({ ...ended('agent-1'), reason: 'aborted', isAborted: true } as never)

  // Then: 账本有原因含「人工中止」的 halt；TaskStop 依次停 agent-1、agent-2，且都在 halt 写入之后；之后没有新的 dispatch 或 merge；状态行已清空（不再显示「运行」）
  const after = log.events.slice(before)
  expect(String(after.find(x => x.ev === 'halt')?.reason ?? '没有 halt')).toContain('人工中止')
  expect(log.stops).toEqual([{ id: 'agent-1', halted: true }, { id: 'agent-2', halted: true }])
  expect(after.filter(x => x.ev === 'dispatch' || x.ev === 'merge')).toEqual([])
  expect(log.statuses.at(-1)).toBe('')
})

test('abort-during-drive-stops-late-dispatch', async ($, on) => {
  // Given: /opsx-apply demo 起飞后，drive 派发 S1 的执行体时 agent.spawn 被挂起（drive 停在第一个动作中途，S2 尚未派发）；agent.list 里 agent-1 是 running
  let enter = () => {}
  let release = () => {}
  const entered = new Promise<void>(r => (enter = r))
  const released = new Promise<void>(r => (release = r))
  const w = demoWorld({
    agents: [{ id: 'agent-1', status: 'running' }],
    spawnHold: async n => {
      if (n !== 1) return
      enter()
      await released
    },
  })
  const log = useWorld(on, w)
  const takeoff = $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  await entered

  // When: 人在终端发出 /flight abort demo；账本写入 halt 之后才放行挂起的 spawn
  const abort = $.command.run({ command: 'flight', args: 'abort demo', ...HUMAN } as never)
  for (let i = 0; i < 200 && !log.events.some(x => x.ev === 'halt'); i++) await new Promise(r => setTimeout(r, 5))
  release()
  await Promise.all([takeoff, abort])

  // Then: halt 原因含「人工中止」；halt 之后 drive 只做完手上的 S1 派发，没有再派发 S2；挂起期间派出的 agent-1 也被 TaskStop 停下
  const halt = log.events.findIndex(x => x.ev === 'halt')
  expect(String(log.events[halt]?.reason ?? '没有 halt')).toContain('人工中止')
  expect(log.spawns.map(s => s.agentId)).toEqual(['agent-1'])
  expect(log.events.slice(halt).filter(x => x.ev === 'dispatch' || x.ev === 'merge').map(x => x.slice)).toEqual(['S1'])
  expect(log.stops).toEqual([{ id: 'agent-1', halted: true }])
})

test('flight-resume-only-unfinished', async ($, on) => {
  // Given: 三份账本依次为：没有 takeoff；attempt 1 的 takeoff 与 land（ready）；attempt 1 的 takeoff 与 halt（会话中断），都来自本会话 sess-1
  const takeoff1 = ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' })
  const ledgers = [[], [takeoff1, ev.land(B0, { attempt: 1, verdict: 'ready' })], [takeoff1, ev.halt(B0, { attempt: 1, reason: '会话中断' })]]
  const log = useWorld(on, demoWorld())

  // When: 每份账本下各由人在终端发出一次 /flight resume demo
  const replies: string[] = []
  const added: string[][] = []
  for (const ledger of ledgers) {
    log.events.splice(0, log.events.length, ...(ledger as Record<string, unknown>[]))
    replies.push(String((await $.command.run({ command: 'flight', args: 'resume demo', ...HUMAN } as never)).text))
    added.push(log.events.slice(ledger.length).map(x => `${x.ev}:${x.attempt ?? ''}`))
  }

  // Then: 第一份回复含 /opsx-apply、第二份含「已落地」，两者都没有新事件；第三份回复含「续飞」与「✈ 起飞」，新事件首条是 attempt 2 的 takeoff
  expect(replies[0]).toContain('/opsx-apply')
  expect(replies[1]).toContain('已落地')
  expect(added.slice(0, 2)).toEqual([[], []])
  expect(replies[2]).toContain('续飞')
  expect(replies[2]).toContain('✈ 起飞')
  expect(added[2]?.[0]).toBe('takeoff:2')
})

test('panel-opens-at-takeoff', async ($, on) => {
  // Given: demo 已批准、工作区干净，waves [[S1, S2], [S3]]
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo，再在 terminal 上请求绘制 Pane flight
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...PANE } as never)

  // Then: 插件以 id flight 调用过 ui.open；面板文本含 demo 与 W1/2
  expect(log.opens).toContain('flight')
  expect(await ui.find({ text: /demo/ })).toBeDefined()
  expect(await ui.find({ text: /W1\/2/ })).toBeDefined()
})

test('flight-command-human-only', async ($, on) => {
  // Given: 两份账本（都来自本会话 sess-1）：flying = attempt 1 的 takeoff 与 agent-1（S1）的 dispatch，agent.list 里 agent-1 running；halted = attempt 1 的 takeoff 与 halt（会话中断）
  const takeoff1 = ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' })
  const flying = [takeoff1, ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'executor', agent: 'agent-1', model: 'opus', worktree: SLICE1 })]
  const halted = [takeoff1, ev.halt(B0, { attempt: 1, reason: '会话中断' })]
  const trigger = { origin: { kind: 'scheduled-trigger' } }
  const sends = [
    { ledger: flying, args: 'abort demo', from: trigger },
    { ledger: flying, args: 'abort demo', from: {} },
    { ledger: halted, args: 'resume demo', from: trigger },
    { ledger: halted, args: 'resume demo', from: {} },
    { ledger: flying, args: 'status demo', from: trigger },
  ]
  const log = useWorld(on, demoWorld({ agents: [{ id: 'agent-1', status: 'running' }] }))

  // When: 每次换上对应账本后发出 /flight <子命令>：abort 与 resume 各以 scheduled-trigger 来源与不带来源发出一次，最后以 scheduled-trigger 来源发出 status
  const replies: string[] = []
  const added: number[] = []
  for (const s of sends) {
    log.events.splice(0, log.events.length, ...(s.ledger as Record<string, unknown>[]))
    replies.push(String((await $.command.run({ command: 'flight', args: s.args, ...s.from } as never)).text))
    added.push(log.events.length - s.ledger.length)
  }

  // Then: 四次 abort / resume 回复都含「只接受人或宿主程序发出」与所见来源（scheduled-trigger / 未标明）；五次都没有新事件；没有 TaskStop；status 回复含 demo 与 attempt 1
  for (const [i, r] of replies.slice(0, 4).entries()) {
    expect(r).toContain('只接受人或宿主程序发出')
    expect(r).toContain(i % 2 === 0 ? 'scheduled-trigger' : '未标明')
  }
  expect(added).toEqual([0, 0, 0, 0, 0])
  expect(log.stops).toEqual([])
  expect(replies[4]).toContain('demo')
  expect(replies[4]).toContain('attempt 1')
})

// ---------------------------------------------------------------- flight-entry-handoff（S1）
// 同一用例里建不了两个世界（世界 hook 挂在同一个 on 上），按切片包拆成同名前缀的两个用例：甲照常登记、乙拒绝 opsx-apply

test('opsx-apply-registered-or-intercepted-registers', async ($, on) => {
  // Given: 世界甲：demo 已批准、工作区干净，command.register 照常应答；会话已开始（插件在 session.start 里登记命令）
  const log = useWorld(on, demoWorld())
  await $.session.start(START as never)

  // When: 人在终端（composer）发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 登记的命令排序后恰为 flight、opsx-apply；回复含「✈ 起飞 demo」
  expect([...log.registered].sort()).toEqual(['flight', 'opsx-apply'])
  expect(String(r.text)).toContain('✈ 起飞 demo')
})

test('opsx-apply-registered-or-intercepted-refused', async ($, on) => {
  // Given: 世界乙：demo 已批准、工作区干净，command.register 对 opsx-apply 抛「refused: it is the user's /opsx-apply」；会话已开始，记下开始是否抛错
  const log = useWorld(on, demoWorld({ registerRefuses: ['opsx-apply'] }))
  const started = await $.session.start(START as never).then(
    () => 'ok',
    (err: unknown) => `抛错：${String(err)}`,
  )

  // When: 人在终端（composer）发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 会话开始不抛错；只登记了 flight；/opsx-apply 仍被拦截接管，回复含「✈ 起飞 demo」
  expect(started).toBe('ok')
  expect(log.registered).toEqual(['flight'])
  expect(String(r.text)).toContain('✈ 起飞 demo')
})

test('ledger-entries-accept-host-origins', async ($, on) => {
  // Given: demo 已批准、工作区干净；四次发送：scheduled-trigger 与不带来源的 /opsx-apply demo、sdk 的 /opsx-apply demo、sdk 的 /flight abort demo
  const log = useWorld(on, demoWorld())
  const sdk = { origin: { kind: 'sdk' } }
  const sends = [
    { command: 'opsx-apply', args: 'demo', origin: { kind: 'scheduled-trigger' } },
    { command: 'opsx-apply', args: 'demo' },
    { command: 'opsx-apply', args: 'demo', ...sdk },
    { command: 'flight', args: 'abort demo', ...sdk },
  ]

  // When: 依次发出这四条命令，记下每次的回复与发出前后账本事件数
  const replies: string[] = []
  const added: number[] = []
  for (const s of sends) {
    const before = log.events.length
    replies.push(String((await $.command.run(s as never)).text))
    added.push(log.events.length - before)
  }

  // Then: 前两次回复含「只接受人或宿主程序发出」与所见来源（scheduled-trigger / 未标明），且都没有新事件；第三次回复含「✈ 起飞 demo」；第四次之后账本有原因含「人工中止」的 halt
  for (const [i, r] of replies.slice(0, 2).entries()) {
    expect(r).toContain('只接受人或宿主程序发出')
    expect(r).toContain(i === 0 ? 'scheduled-trigger' : '未标明')
  }
  expect(added.slice(0, 2)).toEqual([0, 0])
  expect(replies[2]).toContain('✈ 起飞 demo')
  expect(String(log.events.find(x => x.ev === 'halt')?.reason ?? '没有 halt')).toContain('人工中止')
})

// ---------------------------------------------------------------- flight-ship-ledger（S5）

const TAKEOFF_1 = ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1', 'S2'], ['S3']], model: 'opus' })
const shipCall = (agentId?: string) => ({ tool: 'mcp__flight__ship', change: 'demo', pr: '7', ...(agentId ? { agentId } : {}) }) as never

test('ship-tool-main-session-only', async ($, on) => {
  // Given: demo 账本为本会话 attempt 1 的 takeoff、S1 执行体 agent-x 的 dispatch、land（ready）；origin 为 GitHub，PR 7 的头分支 worktree-demo、头 commit 与 change worktree 的 HEAD 相同；slice-gate ship 裁决 ready
  const ledger = [
    TAKEOFF_1,
    ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'executor', agent: 'agent-x', model: 'opus', worktree: SLICE1 }),
    ev.land(B0, { attempt: 1, verdict: 'ready' }),
  ]
  const log = useWorld(on, demoWorld({ ledger }))

  // When: 执行体 agent-x 与主会话（不带 agentId）依次以 {change: demo, pr: 7} 调用 mcp__flight__ship
  const answers: { deny?: string; result?: unknown }[] = []
  for (const id of ['agent-x', undefined]) answers.push((await $.tool.call(shipCall(id))) as { deny?: string; result?: unknown })

  // Then: agent-x 被拒、理由含「只接受主会话」；主会话的 result 含 ready；demo 账本末条为 ship 事件
  expect(answers[0]?.deny).toContain('只接受主会话')
  expect(String(answers[1]?.result)).toContain('ready')
  expect(log.events.at(-1)?.ev).toBe('ship')
})

test('fix-round-merges-by-slice', async ($, on) => {
  // Given: demo 账本为本会话 attempt 1：S1/S2/S3 已合回、切片评审无发现、final 绿、全量评审 whole 给 1 条 HIGH；
  //        fix-r1 修复体 fix-1 在 flight-demo-fix-r1（分支 flight/demo/fix-r1）派发，收口门禁绿
  const FIX_R1 = `${MAIN}/.claude/worktrees/flight-demo-fix-r1`
  const merged = (slice: string) => ev.merge(B0, { attempt: 1, slice, ok: true, commit: 'c'.repeat(40), failed: [] })
  const reviewed = (slice: string, findings: (typeof HIGH_FINDING)[]) => ev.review(B0, { attempt: 1, slice, agent: `r-${slice}`, findings })
  const ledger = [
    TAKEOFF_1,
    merged('S1'), merged('S2'), merged('S3'),
    reviewed('S1', []), reviewed('S2', []), reviewed('S3', []),
    ev.final(B0, { attempt: 1, ok: true, commit: 'c'.repeat(40), failed: [] }),
    ev.dispatch(B0, { attempt: 1, slice: 'whole', role: 'reviewer', agent: 'r-whole', model: 'opus', worktree: TREE, commit: 'c'.repeat(40) }),
    reviewed('whole', [HIGH_FINDING]),
    ev.ended(B0, { attempt: 1, agent: 'r-whole', reason: 'answer', model: 'claude-opus-5-5' }),
    ev.dispatch(B0, { attempt: 1, slice: 'fix-r1', role: 'fixer', agent: 'fix-1', model: 'opus', worktree: FIX_R1, branch: 'flight/demo/fix-r1' }),
    ev.gate(B0, { attempt: 1, agent: 'fix-1', slice: 'fix-r1', ok: true, commit: 'c'.repeat(40), failed: [] }),
  ]
  const log = useWorld(on, demoWorld({ ledger, paths: [FIX_R1] }))

  // When: 修复体 fix-1 结束（turn.complete），drive 执行合回
  await $.turn.complete(ended('fix-1') as never)

  // Then: change worktree 里运行了 merge --no-ff flight/demo/fix-r1 -m integrate: fix-r1；账本末条 merge 的 slice 为 fix-r1、ok 为 true
  expect(runOf(log, `-C ${TREE} merge --no-ff flight/demo/fix-r1 -m integrate: fix-r1`)).toBe(true)
  expect(log.events.filter(x => x.ev === 'merge').at(-1)).toMatchObject({ slice: 'fix-r1', ok: true })
})

test('per-task-guidance-when-plugin-registers', async ($, on) => {
  // Given: 一个世界先后扮演两种项目：甲的 command.register 照常应答（插件登记了 opsx-apply）；乙对 opsx-apply 抛 refused（项目已有命令文件）
  const w = demoWorld()
  const log = useWorld(on, w)
  const send = () => $.command.run({ command: 'opsx-apply', args: 'demo --gate=per-task', ...HUMAN } as never)
  const replies: string[] = []
  const reached: string[][] = []

  // When: 每种项目各开始一次会话，再由人在终端发出 /opsx-apply demo --gate=per-task
  for (const refuses of [[], ['opsx-apply']]) {
    w.registerRefuses = refuses
    await $.session.start(START as never)
    replies.push(String((await send()).text))
    reached.push([...log.commands])
  }

  // Then: 甲的回复含「本项目没有 /opsx-apply 命令文件」与 legacy skill 路径，命令没到达模型；乙的命令原样到达模型并由它作答；账本没有事件
  expect(replies[0]).toContain('本项目没有 /opsx-apply 命令文件')
  expect(replies[0]).toContain('.claude/skills/legacy/openspec-subagent-apply-change/SKILL.md')
  expect(reached[0]).toEqual([])
  expect(replies[1]).toBe('from-model')
  expect(reached[1]).toEqual(['opsx-apply demo --gate=per-task'])
  expect(log.events).toEqual([])
})

// ---------------------------------------------------------------- flight-ledger-guards（S7）

const isSliceGate = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/slice-gate.py')

test('dispatch-takes-base-without-start', async ($, on) => {
  // Given: 两个世界都只有 wave 1 = [S1]：世界一 slice-gate base 在 S1 worktree 打印 base b1；
  //        世界二 slice-gate base 以 1 退出，stdout 为含「G0 base: HEAD 不在 worktree-demo 上」的基点校验 JSON
  const g0 = JSON.stringify({ slice: 'S1', ok: false, commit: '', failed: ['G0 base: HEAD 不在 worktree-demo 上'], warnings: [], summary: '基点校验未通过' })
  const worlds = [demoWorld({ waves: [['S1']], bases: { [SLICE1]: 'b1' } }), demoWorld({ waves: [['S1']], baseRun: res(1, g0) })]
  const w = worlds[0]
  const log = useWorld(on, w)
  const seen: { events: Record<string, unknown>[]; runs: typeof log.runs; spawns: number }[] = []

  // When: 每个世界各由人发一次 /opsx-apply demo，drive 派发 S1 执行体
  for (const x of worlds) {
    Object.assign(w, x)
    log.events.splice(0)
    const runs = log.runs.length
    const spawns = log.spawns.length
    await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
    // 停飞后派的诊断员不算（halt-dispatches-diagnostician 另有用例）
    seen.push({ events: [...log.events], runs: log.runs.slice(runs), spawns: log.spawns.slice(spawns).filter(x => x.subagent_type !== 'flight:diagnostician').length })
  }

  // Then: 世界一在 S1 worktree 运行了 slice-gate.py base S1 --change-dir <D> --expect-branch worktree-demo；世界一 S1 的 dispatch.base 为 b1；
  //       两个世界都没有 argv 含 start 的 slice-gate 调用；世界二没有诊断员以外的派发与 dispatch 事件，最后一条 blocked 是 S1 且原因含「G0 base」
  expect(seen[0].runs.filter(isBaseS1).map(x => [x.argv, x.cwd])).toEqual([[['python3', `${HOOKS}/slice-gate.py`, 'base', 'S1', '--change-dir', CD, '--expect-branch', 'worktree-demo'], SLICE1]])
  expect(seen[0].events.find(x => x.ev === 'dispatch' && x.slice === 'S1')?.base).toBe('b1')
  expect(seen.flatMap(s => s.runs).filter(x => isSliceGate(x) && x.argv.includes('start'))).toEqual([])
  expect([seen[1].spawns, seen[1].events.filter(x => x.ev === 'dispatch' && x.role !== 'diagnostician').length]).toEqual([0, 0])
  expect(seen[1].events.filter(x => x.ev === 'blocked').at(-1)).toMatchObject({ slice: 'S1', reason: expect.stringContaining('G0 base') })
})

test('takeoff-reads-engine-model', async ($, on) => {
  // Given: change demo 已批准、工作区干净；四次发送依次为：session.model 应答 claude-opus-5-5 / 应答 gpt-x / 以 deny「denied」拒绝（调用抛错）/ 应答 gpt-x 且命令带 --model=sonnet；每次发送前清空账本
  const sends: { model: string | Error; args: string }[] = [
    { model: 'claude-opus-5-5', args: 'demo' },
    { model: 'gpt-x', args: 'demo' },
    { model: new Error('denied'), args: 'demo' },
    { model: 'gpt-x', args: 'demo --model=sonnet' },
  ]
  const w = demoWorld()
  const log = useWorld(on, w)
  const replies: string[] = []
  const models: unknown[] = []

  // When: 依次由人发出这四次 /opsx-apply
  for (const s of sends) {
    w.model = s.model
    log.events.splice(0)
    replies.push(String((await $.command.run({ command: 'opsx-apply', args: s.args, ...HUMAN } as never)).text))
    models.push(log.events.find(x => x.ev === 'takeoff')?.model ?? null)
  }

  // Then: 四次的 takeoff model 依次为 opus、无、无、sonnet；第二次回复含「判不出主模型」「gpt-x」「--model=」；第三次回复含「判不出主模型」「denied」；全程没有 argv 含 session-model.py 的调用
  expect(models).toEqual(['opus', null, null, 'sonnet'])
  expect([replies[1].includes('判不出主模型'), replies[1].includes('gpt-x'), replies[1].includes('--model=')]).toEqual([true, true, true])
  expect([replies[2].includes('判不出主模型'), replies[2].includes('denied')]).toEqual([true, true])
  expect(log.runs.filter(x => x.argv.some(a => String(a).includes('session-model.py')))).toEqual([])
})

test('takeoff-writes-no-timeline', async ($, on) => {
  // Given: change demo 已批准（takeoff-gate 退出 0）、账本为空（从未起飞）、工作区干净
  const log = useWorld(on, demoWorld())

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 回复以「✈ 起飞 demo」开头；账本首条为 attempt 1 的 takeoff；没有任何 timeline.py 调用；没有提交信息为 chore(flight): approve 的 git commit
  expect(String(r.text)).toMatch(/^✈ 起飞 demo/)
  expect(log.events[0]).toMatchObject({ ev: 'takeoff', attempt: 1 })
  expect(log.runs.filter(x => String(x.argv[1]).endsWith('timeline.py'))).toEqual([])
  expect(log.commits.filter(c => c.message === 'chore(flight): approve')).toEqual([])
})

// ---------------------------------------------------------------- flight-ledger-guards（S8）

const isIntentCheck = (x: { argv: string[] }) => String(x.argv[1]).endsWith('/intent-gate.py') && x.argv[2] === 'check'

test('main-session-writes-checked', async ($, on) => {
  // Given: 世界一：会话 cwd 为 /repo，git common dir 为 /repo/.git（判定器在 /repo/template/.claude/hooks），intent-gate.py check 拒 /repo/src/x.py 与 /repo/src/y.py；
  //        demo 已起飞，S1 执行体 agent-1 已派发（owns src/s1.py）；世界二：会话 sess-2，git common dir 为 /elsewhere/.git（其下找不到判定器）
  const w = demoWorld({ cwd: MAIN, intentDenies: [`${MAIN}/src/x.py`, `${MAIN}/src/y.py`] })
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const writeX = { tool: 'Write', file_path: `${MAIN}/src/x.py`, content: 'x\n' }
  const sends = [
    { call: writeX },
    { call: { tool: 'Bash', command: 'echo y > src/y.py' } },
    { call: { tool: 'Bash', command: 'ls' } },
    { call: { ...writeX, agentId: 'other-1' } },
    { call: { tool: 'Write', file_path: `${SLICE1}/src/s1.py`, content: 'x\n', agentId: 'agent-1' } },
    { call: writeX, world: { session: 'sess-2', commonDir: '/elsewhere/.git' } },
  ]

  // When: 依次发出：主会话 Write /repo/src/x.py、主会话 Bash echo y > src/y.py、主会话 Bash ls、非飞行 agent other-1 Write /repo/src/x.py、
  //       agent-1 Write <S1 worktree>/src/s1.py、换到世界二后主会话 Write /repo/src/x.py；记下每次是否被拒与新增的 check 次数
  const denied: boolean[] = []
  const checks: number[] = []
  for (const s of sends) {
    if (s.world) Object.assign(w, s.world)
    const before = log.runs.filter(isIntentCheck).length
    const r = (await $.tool.call(s.call as never)) as { deny?: string }
    denied.push(typeof r?.deny === 'string' && r.deny.includes('意图门禁'))
    checks.push(log.runs.filter(isIntentCheck).length - before)
  }

  // Then: 前两次与非飞行 agent 的写入因意图门禁被拒；ls、执行体 owns 内写入、世界二的写入放行；只有被拒的三次各跑了一次 check
  expect(denied).toEqual([true, true, false, true, false, false])
  expect(log.reached).toEqual(['Bash ls', `Write ${SLICE1}/src/s1.py`, `Write ${MAIN}/src/x.py`])
  expect(checks).toEqual([1, 1, 0, 1, 0, 0])
})

test('perform-skips-after-halt', async ($, on) => {
  // Given: 世界一：waves [[S1]]，slice-gate base S1 运行时账本被别处记入 attempt 1 的 halt「人工中止」；
  //        世界二：账本清空后重新起飞，S1 执行体收口门禁绿，之后 plan_fp.py 运行时（合回动作算出之前）账本被别处记入 halt
  const w = demoWorld({ waves: [['S1']] })
  const log = useWorld(on, w)
  const haltOnce = (hit: (argv: string[]) => boolean) => {
    let done = false
    return (argv: string[]) => {
      if (done || !hit(argv)) return
      done = true
      log.events.push(ev.halt(B0, { attempt: 1, reason: '人工中止' }))
    }
  }
  const afterHalt = () => log.events.slice(log.events.findIndex(x => x.ev === 'halt')).filter(x => x.ev === 'dispatch' || x.ev === 'merge')
  const seen: { spawns: number; late: unknown[]; merges: number }[] = []

  // When: 世界一由人发 /opsx-apply demo；世界二由人发 /opsx-apply demo、S1 执行体 SubagentStop 后处理它的结束
  w.onRun = haltOnce(argv => String(argv[1]).endsWith('/slice-gate.py') && argv[2] === 'base')
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  seen.push({ spawns: log.spawns.length, late: afterHalt(), merges: 0 })
  log.events.splice(0)
  w.onRun = undefined
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  const exec = log.spawns.at(-1)?.agentId ?? ''
  await $.classic.SubagentStop(subagentStop(exec) as never)
  w.onRun = haltOnce(argv => String(argv[1]).endsWith('/plan_fp.py'))
  await $.turn.complete(ended(exec) as never)
  seen.push({ spawns: 0, late: afterHalt(), merges: log.runs.filter(x => x.argv.includes('merge') && x.argv.includes('--no-ff')).length })

  // Then: 世界一没有派发 S1 执行体、halt 之后没有 dispatch / merge；世界二没有运行 git merge --no-ff、halt 之后没有 dispatch / merge
  expect(seen).toEqual([
    { spawns: 0, late: [], merges: 0 },
    { spawns: 0, late: [], merges: 0 },
  ])
})

test('subagent-stop-error-leaves-diag', async ($, on) => {
  // Given: demo 已起飞，S1 执行体 agent-1 在飞；之后收口门禁（slice-gate.py gate）运行时抛出 Error「$.process.run(python3) aborted」
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  w.gateThrows = '$.process.run(python3) aborted'

  // When: 引擎发出 agent-1 的 SubagentStop
  await $.classic.SubagentStop(subagentStop('agent-1') as never).catch(() => undefined)

  // Then: 账本末条为 diag（where SubagentStop、agent agent-1、kind throw、error 含 aborted、budget 为数字）；账本没有 agent-1 的 gate
  expect(log.events.at(-1)).toMatchObject({ ev: 'diag', where: 'SubagentStop', agent: 'agent-1', kind: 'throw', error: expect.stringContaining('aborted'), budget: expect.any(Number) })
  expect(log.events.filter(x => x.ev === 'gate' && x.agent === 'agent-1')).toEqual([])
})

test('panel-refreshes-on-terminal', async ($, on) => {
  // Given: demo 账本为本会话 attempt 1：waves [[S1]]，S1 已合回，S1 评审员 r-S1 已派发且评审无发现；slice-gate final 红（G2 lint）且 commit 为空（没有可交给整合修复的提交，final 红直接停飞）
  const ledger = [
    ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1']], model: 'opus' }),
    ev.merge(B0, { attempt: 1, slice: 'S1', ok: true, commit: 'c'.repeat(40), failed: [] }),
    ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'reviewer', agent: 'r-S1', model: 'opus', worktree: TREE }),
    ev.review(B0, { attempt: 1, slice: 'S1', agent: 'r-S1', findings: [] }),
  ]
  const log = useWorld(on, demoWorld({ ledger, final: { ok: false, failed: ['G2 lint'], commit: '' } }))

  // When: 评审员 r-S1 结束（turn.complete），drive 跑 final 后停飞
  await $.turn.complete(ended('r-S1') as never)

  // Then: 最后一条 halt 之后只有诊断员的事件；在 terminal 上绘制 Pane flight，首行含「已停飞（final 未通过：G2 lint）」
  expect(haltAtEnd(log.events)?.ev).toBe('halt')
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...PANE } as never)
  expect(await ui.find({ text: /已停飞（final 未通过：G2 lint）/ })).toBeDefined()
})

// ---------------------------------------------------------------- flight-unattended S5a

/** 让插件 hook 里的异步工作（进程调用、账本读写）跑完 */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 1))
}

/** 在测试一侧发出一次模型请求（turn.step）并读完；世界里 stalls 的 agent 永不结束 */
async function step($: unknown, agentId: string): Promise<void> {
  const gen = ($ as { turn: { step(e: unknown): AsyncIterable<unknown> } }).turn.step({ agentId, model: 'claude-opus-5-5' })
  for await (const _ of gen) {
    // 丢弃中间产出
  }
}

/** 推进 mock 时钟并等计时器回调跑完 */
async function advance(log: { clock: { advance(ms: number): unknown; settle(): unknown } }, ms: number): Promise<void> {
  await log.clock.advance(ms)
  await log.clock.settle()
  await flush()
}

test('final-red-heals-integ', async ($, on) => {
  // Given: demo 账本为本会话 attempt 1：waves [[S1]]，S1 已合回，S1 评审员 r-S1 评审无发现；slice-gate final 红（G2 lint），commit 为 c×40
  const ledger = [
    ev.takeoff(B0, { attempt: 1, fp: F, branch: 'worktree-demo', waves: [['S1']], model: 'opus' }),
    ev.merge(B0, { attempt: 1, slice: 'S1', ok: true, commit: 'c'.repeat(40), failed: [] }),
    ev.dispatch(B0, { attempt: 1, slice: 'S1', role: 'reviewer', agent: 'r-S1', model: 'opus', worktree: TREE }),
    ev.review(B0, { attempt: 1, slice: 'S1', agent: 'r-S1', findings: [] }),
  ]
  const log = useWorld(on, demoWorld({ ledger, final: { ok: false, failed: ['G2 lint'] } }))

  // When: 评审员 r-S1 结束（turn.complete），drive 跑 final
  await $.turn.complete(ended('r-S1') as never)

  // Then: 账本恰有一条 heal（kind integ、slice integ）；有 slice integ 的 fixer 派发；没有 halt
  expect(log.events.filter(x => x.ev === 'heal').map(x => [x.kind, x.slice])).toEqual([['integ', 'integ']])
  expect(log.events.some(x => x.ev === 'dispatch' && x.role === 'fixer' && x.slice === 'integ')).toBe(true)
  expect(log.events.some(x => x.ev === 'halt')).toBe(false)
})

test('heal-recorded-then-retried', async ($, on) => {
  // Given: demo 已批准、waves [[S1]]；在 change worktree 的第 1 次 merge --no-ff 以非冲突原因失败（exit 128），第 2 次成功；S1 门禁一律绿；已起飞，agent-1 收口并结束，第二个执行体 agent-2 已收口
  const log = useWorld(on, demoWorld({ waves: [['S1']], mergeFails: [1] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  await $.classic.SubagentStop(subagentStop('agent-1') as never)
  await $.turn.complete(ended('agent-1') as never)
  await $.classic.SubagentStop(subagentStop('agent-2') as never)

  // When: 第二个执行体 agent-2 结束（turn.complete）
  await $.turn.complete(ended('agent-2') as never)

  // Then: 账本依次有失败的 S1 merge、heal merge-retry S1、S1 执行体 agent-2 的派发、成功的 S1 merge；两个执行体的 worktree 不同
  const seq = log.events
    .filter(x => (x.ev === 'merge' && x.slice === 'S1') || x.ev === 'heal' || (x.ev === 'dispatch' && x.role === 'executor' && x.agent === 'agent-2'))
    .map(x => [x.ev, x.ok ?? x.kind ?? x.agent, x.slice])
  expect(seq).toEqual([['merge', false, 'S1'], ['heal', 'merge-retry', 'S1'], ['dispatch', 'agent-2', 'S1'], ['merge', true, 'S1']])
  expect(log.spawns[1]?.cwd).not.toBe(log.spawns[0]?.cwd)
})

test('watchdog-stops-stalled-agent', async ($, on) => {
  // Given: demo 已起飞（waves [[S1, S2]]，agent-1 = S1、agent-2 = S2，都在跑）；agent-1 的请求在 T0 开始、agent-2 的在 T0+181s 开始，两者都不结束；TaskStop 应答 isError「Task agent-1 is not running」
  const log = useWorld(on, demoWorld({ waves: [['S1', 'S2']], stalls: ['agent-1', 'agent-2'], stopError: '<tool_use_error>Task agent-1 is not running (status: completed)</tool_use_error>', agents: [{ id: 'agent-1', status: 'running' }, { id: 'agent-2', status: 'running' }] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  void step($, 'agent-1')
  await flush()
  await advance(log, 181000)
  void step($, 'agent-2')
  await flush()

  // When: 时钟再推进 540s（到 T0+721s：agent-1 请求已等 12 分钟、agent-2 等 9 分钟），看门狗在 agent-1 超时后 tick 两次
  await advance(log, 540000)

  // Then: 恰一条 heal（kind watchdog、slice S1、agent agent-1），写在 TaskStop agent-1 之前；只停 agent-1 一次；有 where watchdog、agent agent-1 的 diag
  const heals = log.events.filter(x => x.ev === 'heal')
  expect(heals).toEqual([expect.objectContaining({ kind: 'watchdog', slice: 'S1', agent: 'agent-1' })])
  expect(log.events.indexOf(heals[0] ?? {})).toBeLessThan(log.stopsAt[0] ?? -1)
  expect(log.stops.map(x => x.id)).toEqual(['agent-1'])
  expect(log.events.some(x => x.ev === 'diag' && x.where === 'watchdog' && x.agent === 'agent-1')).toBe(true)
})

test('watchdog-exhausted-halts', async ($, on) => {
  // Given: 账本预置 attempt 1 的 3 条 heal（merge-retry S8、integ integ、watchdog S9）；demo 起飞（waves [[S1, S2]]），agent-1、agent-2 都在跑；agent-1 的请求在 T0 开始且不结束
  const ledger = [
    ev.heal(B0, { attempt: 1, kind: 'merge-retry', slice: 'S8', reason: '合回失败' }),
    ev.heal(B0, { attempt: 1, kind: 'integ', slice: 'integ', reason: 'final 红' }),
    ev.heal(B0, { attempt: 1, kind: 'watchdog', slice: 'S9', reason: '等待 11 分钟', agent: 'x9' }),
  ]
  const log = useWorld(on, demoWorld({ ledger, waves: [['S1', 'S2']], stalls: ['agent-1'], agents: [{ id: 'agent-1', status: 'running' }, { id: 'agent-2', status: 'running' }] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  void step($, 'agent-1')
  await flush()

  // When: 时钟推进 661s，看门狗 tick
  await advance(log, 661000)

  // Then: 追加 halt（kind watchdog，原因含 agent-1 与「自愈预算已用尽」）；agent-1、agent-2 都被停；heal 仍为 3 条
  const halt = log.events.find(x => x.ev === 'halt')
  expect(halt).toMatchObject({ kind: 'watchdog', reason: expect.stringContaining('自愈预算已用尽') })
  expect(String(halt?.reason)).toContain('agent-1')
  expect(log.stops.map(x => x.id)).toEqual(['agent-1', 'agent-2'])
  expect(log.events.filter(x => x.ev === 'heal').length).toBe(3)
})

// ---------------------------------------------------------------- flight-unattended S5b

test('halt-dispatches-diagnostician', async ($, on) => {
  // Given: demo 已起飞（waves [[S1]]），S1 门禁一律红 [G7 demo#s1]；执行体逐个收口、结束直到停飞；诊断员的最终回答为「S1 的 owns 漏了 tests/test_x.py\n改 slices.json 后续飞」
  const answer = 'S1 的 owns 漏了 tests/test_x.py\n改 slices.json 后续飞'
  const w = demoWorld({ waves: [['S1']], gates: { S1: [{ ok: false, failed: ['G7 demo#s1'] }] } })
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  for (let i = 1; i <= 4 && !log.events.some(x => x.ev === 'halt'); i++) {
    await $.classic.SubagentStop(subagentStop(`agent-${i}`) as never)
    await $.turn.complete(ended(`agent-${i}`) as never)
  }
  const diag = log.spawns.find(x => x.subagent_type === 'flight:diagnostician')
  const id = diag?.agentId ?? '没有诊断员'
  w.answers = { [id]: answer }

  // When: 诊断员结束（turn.complete），回答为 answer
  await $.turn.complete(ended(id) as never)

  // Then: halt 之后有 role diagnostician、slice triage 的派发；诊断员为 flight:diagnostician、model opus、cwd 为 change worktree；有该诊断员的 triage，text 首行为回答首行；ui.notify 收到含首行的通知；面板含「诊断：S1 的 owns 漏了 tests/test_x.py」
  const halt = log.events.findIndex(x => x.ev === 'halt')
  const d = log.events.findIndex(x => x.ev === 'dispatch' && x.role === 'diagnostician' && x.slice === 'triage')
  expect(halt >= 0 && d > halt).toBe(true)
  expect([diag?.subagent_type, diag?.model, diag?.cwd]).toEqual(['flight:diagnostician', 'opus', TREE])
  expect(String(log.events.find(x => x.ev === 'triage' && x.agent === id)?.text ?? '').split('\n')[0]).toBe('S1 的 owns 漏了 tests/test_x.py')
  expect(log.notifies.some(n => JSON.stringify(n).includes('S1 的 owns 漏了 tests/test_x.py'))).toBe(true)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...PANE } as never)
  expect(await ui.find({ text: /诊断：S1 的 owns 漏了 tests\/test_x.py/ })).toBeDefined()
})

test('halt-dispatches-diagnostician/abort-skips', async ($, on) => {
  // Given: demo 已起飞并派出 agent-1（S1）、agent-2（S2），两者都在跑
  const log = useWorld(on, demoWorld({ agents: [{ id: 'agent-1', status: 'running' }, { id: 'agent-2', status: 'running' }] }))
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // When: 人在终端发出 /flight abort demo
  await $.command.run({ command: 'flight', args: 'abort demo', ...HUMAN } as never)

  // Then: 账本有原因含「人工中止」的 halt；没有派发诊断员
  expect(String(log.events.find(x => x.ev === 'halt')?.reason ?? '没有 halt')).toContain('人工中止')
  expect(log.spawns.filter(x => x.subagent_type === 'flight:diagnostician')).toEqual([])
})

test('notify-uses-terminal-channel', async ($, on) => {
  // Given: demo 已起飞（agent-1 = S1）；之后 plan_fp.py 以 1 退出、stderr「plan_fp 超时」；ui.notify 应答 isSent true、channel iterm2
  const w = demoWorld()
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  w.fpRun = res(1, '', 'plan_fp 超时')

  // When: agent-1 结束（turn.complete），drive 停飞
  await $.turn.complete(ended('agent-1') as never)

  // Then: ui.notify 收到 title flight、含停飞原因「计算计划指纹失败」的通知；最后一条 halt 之后只有诊断员的事件
  expect(log.notifies.some(n => JSON.stringify(n).includes('"title":"flight"') && JSON.stringify(n).includes('计算计划指纹失败'))).toBe(true)
  expect(haltAtEnd(log.events)?.ev).toBe('halt')
})

test('notify-uses-terminal-channel/not-sent', async ($, on) => {
  // Given: demo 已起飞（agent-1 = S1）；之后 plan_fp.py 以 1 退出；ui.notify 应答 isSent false、reason no-channel
  const w = demoWorld({ notify: { isSent: false, reason: 'no-channel' } })
  const log = useWorld(on, w)
  await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)
  w.fpRun = res(1, '', 'plan_fp 超时')

  // When: agent-1 结束（turn.complete），drive 停飞
  await $.turn.complete(ended('agent-1') as never)

  // Then: ui.notify 收到 title flight 的通知；飞行记录（ui.log）有一行含 no-channel；最后一条 halt 之后只有诊断员的事件
  expect(log.notifies.some(n => JSON.stringify(n).includes('"title":"flight"'))).toBe(true)
  expect(log.logs.some(t => t.includes('no-channel'))).toBe(true)
  expect(haltAtEnd(log.events)?.ev).toBe('halt')
})

test('takeoff-requires-integ-guard/refused', async ($, on) => {
  // Given: demo 已批准、其余起飞检查都过；slice-gate.py features 只输出 evidence-ledger-only、g5-per-target、guards、ship-ledger、ledger-records（缺 integ-guard）
  const log = useWorld(on, demoWorld({ features: 'evidence-ledger-only\ng5-per-target\nguards\nship-ledger\nledger-records\n' }))

  // When: 人发出 /opsx-apply demo
  const r = await $.command.run({ command: 'opsx-apply', args: 'demo', ...HUMAN } as never)

  // Then: 回复含 integ-guard；账本没有 takeoff
  expect(r.text).toContain('integ-guard')
  expect(log.events.filter(x => x.ev === 'takeoff')).toEqual([])
})
