import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EVENT_TYPES } from '../hooks/io'
import { REQUIRED_FEATURES } from '../hooks/versions'

// 测试用的「世界」：git / python3 / 文件系统 / 会话 都由测试的 hook 在插件之下作答。
type World = {
  version?: string
  /** 读会话版本的调用失败（旧引擎没有该 API） */
  versionFails?: boolean
  /** `git worktree list --porcelain` 的输出 */
  worktrees: string
  /** 目录 → 子目录名 */
  dirs: Record<string, string[]>
  /** 文件 → 内容（存在即在表中） */
  files: Record<string, string>
  /** 第 n 次（从 0 起）调用 plan_fp.py 时输出的指纹；第二个参数是它的 --change-dir */
  fp: (call: number, changeDir: string) => string
  /** spec.html 路径 → mtimeMs（缺省 1000） */
  mtimes?: Record<string, number>
  /** 前几次 update-ref 返回非 0（旧值不符） */
  updateRefFailures?: number
  /** `ledger.py show` 输出的事件（缺省为空账本）；showFails 时 show 以 exit 5 失败 */
  ledger?: object[]
  showFails?: boolean
  /** change 名 → 该 change 的账本事件（给出时 show 按 --change-dir 的末段取，优先于 ledger） */
  ledgers?: Record<string, object[]>
  /** change 名 → `ledger.py approved` 的输出（给出时优先于本次测试写入的 approve；写入 approve 时同步更新） */
  approved?: Record<string, string>
  /** `slice-gate.py baseline` 的退出码与 stdout（缺省 exit 0） */
  baseline?: { exitCode: number; stdout: string }
  /** `git status --porcelain --untracked-files=all` 的输出（缺省空 = 干净） */
  status?: string
  /** `agent.list` 的应答（缺省空） */
  agents?: { id: string; status: string }[]
  /** takeoff-gate.py 等它 resolve 之后才作答（让起飞「卡住」） */
  gateWait?: Promise<unknown>
  /** plan_fp.py 等它 resolve 之后才作答（让指纹核对「卡住」） */
  fpWait?: Promise<unknown>
  /** slice-gate.py baseline 等它 resolve 之后才作答（让基线「卡住」） */
  baselineWait?: Promise<unknown>
  /** takeoff-gate.py 以 exit 0 放行；随后的起飞检查（git --version、ledger.py events、slice-gate.py features）都过，slice-gate.py lint 以 exit 1 停下 */
  gatePasses?: boolean
  /** 接下来这么多次 `git worktree list`（批准带重绘的第一步读取）抛错，用完自动复原 */
  refreshThrows?: number
  /** `ledger.py events` 的输出（缺省为 EVENT_TYPES）：模拟不认识某些事件的旧判定器 */
  events?: string[]
}

type GitCall = { args: string[]; cwd: string | undefined; stdin: string | undefined }

const MAIN = '/repo'
const CHANGES = `${MAIN}/template/openspec/changes`
const DEMO = `${CHANGES}/demo`
const HOOKS = `${MAIN}/template/.claude/hooks`
const F = '3f9a1c07' + 'a'.repeat(56)
const G = '9b0e44d2' + 'b'.repeat(56)
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const
const START = { cwd: MAIN, surface: 'terminal', isInteractive: true } as const

function porcelain(trees: [path: string, branch: string][]): string {
  return trees.map(([path, branch]) => `worktree ${path}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/${branch}\n`).join('\n')
}

/**
 * 主 worktree 加上 names 各自的 worktree-<name> 分支：起飞按分支 worktree-<name> 找 change 所在 worktree。
 * 测试世界里这些分支都挂在 /repo 上（只为让起飞找得到 change，批准带按分支去重后仍是同一份）。
 */
function flyable(names: string[]): string {
  return porcelain([[MAIN, 'main'], ...names.map((n): [string, string] => [MAIN, `worktree-${n}`])])
}

/** 主 worktree 里有一个待批准的 change demo（tasks 未完成、账本无批准）。 */
function demoWorld(fp: World['fp'], extra: Partial<World> = {}): World {
  return {
    worktrees: flyable(['demo', 'zeta']),
    dirs: { [CHANGES]: ['demo', 'archive'] },
    files: {
      [`${DEMO}/spec.html`]: '<html></html>',
      [`${DEMO}/tasks.md`]: '- [ ] 1.1 写代码\n',
      [`${HOOKS}/plan_fp.py`]: '',
      [`${HOOKS}/ledger.py`]: '',
      [`${HOOKS}/slice-gate.py`]: '',
    },
    fp,
    ...extra,
  }
}

function ok(stdout: string) {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

function fail(stderr: string) {
  return { value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

function useWorld(on: On, w: World) {
  const log = {
    git: [] as GitCall[],
    fpDirs: [] as string[],
    toasts: [] as string[],
    fills: [] as string[],
    tools: [] as string[],
    commands: [] as string[],
    versionReads: 0,
    approved: '',
    /** ui.notify 收到的调用（整条事件 JSON） */
    notes: [] as string[],
    /** slice-gate.py baseline 的 --change-dir */
    baselines: [] as string[],
    /** 对哪些 change 调用过 takeoff-gate.py（--change-dir 的末段）：即插件以该 change 起飞 */
    gates: [] as string[],
    /** 按发生顺序：`stop <task_id>`（TaskStop）与 `gate <change>`（takeoff-gate.py） */
    order: [] as string[],
    /** ui.status 收到的文本 */
    statuses: [] as string[],
    /** `git -C <tree> add|commit …` 的参数（-C <tree> 之后的部分）：起飞时提交工件 */
    commits: [] as string[][],
    /** 每次 ledger.py 调用的脚本路径（argv[1]） */
    ledgerScripts: [] as string[],
    /** 每次 plan_fp.py 调用的脚本路径（argv[1]） */
    fpScripts: [] as string[],
    /** mock.clock 的句柄（advance / settle） */
    clock: undefined as unknown as { advance(ms: number): unknown; settle(): unknown },
  }
  let fpCalls = 0
  let updateRefCalls = 0
  let lastEvent = ''
  log.clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) }) as never
  mock.env(on, {})
  on('ui.notify', ($, e) => {
    log.notes.push(JSON.stringify(e))
    return { value: { isSent: true, channel: 'iterm2' } } as never
  })
  on('agent.list', () => ({ value: (w.agents ?? []) as never }))
  on('tool.call', { tool: 'TaskStop' }, ($, e) => {
    log.order.push(`stop ${String((e as unknown as { task_id: string }).task_id)}`)
    return { result: {}, text: '' } as never
  })
  on('session.version', () => {
    log.versionReads += 1
    if (w.versionFails) throw new Error('session.version 不可用')
    return { value: { version: w.version ?? '2.1.295' } }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: MAIN }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', ($, e) => {
    log.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    log.statuses.push(String(e.text ?? ''))
    return { value: undefined }
  })
  on('prompt.fill', ($, e) => {
    log.fills.push(e.text)
    return { isFilled: true }
  })
  on('tool.register', ($, e) => {
    log.tools.push(e.name)
    return { value: { tool: e.name } }
  })
  on('command.register', ($, e) => {
    log.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.render', BAND, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="engine">
        <Text>engine</Text>
      </Box>
    )
  })
  // dirs 里列出的子目录也算存在（起飞按 <worktree>/template/openspec/changes/<name> 找 change 目录）
  on('fs.exists', ($, e) => ({
    value: e.path in w.files || e.path in w.dirs || Object.entries(w.dirs).some(([d, names]) => names.some(n => `${d}/${n}` === e.path)),
  }))
  on('fs.list', ($, e) => ({
    value: (w.dirs[e.path] ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: w.mtimes?.[e.path] ?? 1000, isLink: false } }))
  // 与真实引擎一致：读不存在的文件抛错，原文 `$.fs.read(<path>) failed: ENOENT`
  on('fs.read', ($, e) => {
    if (!(e.path in w.files)) throw new Error(`$.fs.read(${e.path}) failed: ENOENT`)
    return { value: w.files[e.path] }
  })
  on('process.run', ($, e) => {
    const [cmd, ...args] = e.argv
    if (cmd === 'python3' && args[0]?.endsWith('/plan_fp.py')) {
      log.fpDirs.push(String(args[2]))
      log.fpScripts.push(String(args[0]))
      const answer = ok(w.fp(fpCalls++, String(args[2])) + '\n')
      return w.fpWait === undefined ? answer : w.fpWait.then(() => answer)
    }
    if (cmd === 'python3' && args[0]?.endsWith('/ledger.py')) {
      log.ledgerScripts.push(String(args[0]))
      if (args[1] === 'events') return ok((w.events ?? EVENT_TYPES).join('\n') + '\n')
      const name = String(args[3]).split('/').pop() ?? ''
      if (args[1] !== 'show') return ok((w.approved?.[name] ?? log.approved) + '\n')
      if (w.showFails) return { value: { ...fail('git 不可用').value, exitCode: 5 } }
      return ok((w.ledgers?.[name] ?? w.ledger ?? []).map(ev => JSON.stringify(ev) + '\n').join(''))
    }
    if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'baseline') {
      log.baselines.push(String(args[3]))
      const b = w.baseline ?? { exitCode: 0, stdout: '{"ok": true, "reasons": []}' }
      const answer = { value: { ...ok(b.stdout).value, exitCode: b.exitCode } }
      return w.baselineWait === undefined ? answer : w.baselineWait.then(() => answer)
    }
    if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'features') return ok(REQUIRED_FEATURES.join('\n') + '\n')
    if (cmd === 'python3' && args[0]?.endsWith('/slice-gate.py') && args[1] === 'lint') return fail('lint 红（测试世界）')
    // 起飞守卫缺省以 exit 3「未批准」作答：起飞在守卫处停下，用例只看起飞是否发生；gatePasses 时放行
    if (cmd === 'python3' && args[0]?.endsWith('/takeoff-gate.py')) {
      const name = String(args[2]).split('/').pop() ?? ''
      log.gates.push(name)
      log.order.push(`gate ${name}`)
      const answer = w.gatePasses ? ok('') : { value: { ...fail('takeoff-gate: 未批准：账本里没有这个 change 的批准记录。').value, exitCode: 3 } }
      return w.gateWait === undefined ? answer : w.gateWait.then(() => answer)
    }
    if (cmd === 'git' && args[0] === '--version') return ok('git version 2.43.0\n')
    if (cmd === 'git' && args[0] === '-C' && (args[2] === 'add' || args[2] === 'commit')) {
      log.commits.push(args.slice(2))
      return ok('')
    }
    if (cmd === 'git' && args.includes('worktree')) {
      if ((w.refreshThrows ?? 0) > 0) {
        w.refreshThrows = (w.refreshThrows ?? 0) - 1
        throw new Error('git worktree list 读取失败（测试世界）')
      }
      return ok(w.worktrees)
    }
    if (cmd === 'git' && args.includes('status')) return ok(w.status ?? '')
    if (cmd !== 'git') throw new Error(`unexpected argv: ${e.argv.join(' ')}`)
    log.git.push({ args, cwd: e.init?.cwd, stdin: e.init?.stdin })
    switch (args[0]) {
      case 'hash-object':
        lastEvent = e.init?.stdin ?? ''
        return ok('b'.repeat(40) + '\n')
      case 'mktree':
        return ok('e'.repeat(40) + '\n')
      case 'rev-parse':
        return updateRefCalls === 0 ? fail('') : ok('d'.repeat(40) + '\n')
      case 'commit-tree':
        return ok('c'.repeat(40) + '\n')
      case 'update-ref':
        updateRefCalls += 1
        if (updateRefCalls <= (w.updateRefFailures ?? 0)) return fail('cannot lock ref: is at dddd but expected 0000')
        // shelve 按 S1 判定器的语义：追加进该 change 的账本（show 读得到），approved 不再输出指纹
        if (JSON.parse(lastEvent).ev === 'shelve') {
          const shelved = JSON.parse(lastEvent)
          if (w.ledgers?.[shelved.change] !== undefined) w.ledgers[shelved.change]!.push(shelved)
          else w.ledger = [...(w.ledger ?? []), shelved]
          log.approved = ''
          if (w.approved) w.approved[shelved.change] = ''
          return ok('')
        }
        log.approved = JSON.parse(lastEvent).fp
        if (w.approved) w.approved[JSON.parse(lastEvent).change] = log.approved
        return ok('')
    }
    throw new Error(`unexpected git: ${args.join(' ')}`)
  })
  return log
}

/** 写账本的 git 子命令（rev-parse 只读，不算）。 */
function writes(log: { git: GitCall[] }): string[] {
  return log.git.map(c => String(c.args[0])).filter(op => op !== 'rev-parse')
}

/** 每次 `git commit` 提交的路径（`--` 之后的部分）。 */
function committed(log: { commits: string[][] }): string[][] {
  return log.commits.filter(c => c[0] === 'commit').map(c => c.slice(c.indexOf('--') + 1))
}

/** 轮询到 cond 为真（至多约 1 秒）：用于按键处理尚未返回时等世界里的调用发生 */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5))
}

/** 推进时钟并等定时回调跑完：按键已在处理之内起飞 / 续飞，这里只让剩下的定时回调（如基线进度刷新）跑完。 */
async function background(log: { clock: { advance(ms: number): unknown; settle(): unknown } }): Promise<void> {
  await log.clock.advance(0)
  await log.clock.settle()
}

test('band-shows-pending-plan', async ($, on) => {
  // Given: 主 worktree /repo 的 template/openspec/changes/demo 有 spec.html、tasks.md 含「- [ ]」，plan_fp 输出 3f9a1c07…，ledger approved 输出空
  useWorld(on, demoWorld(() => F))
  await $.session.start(START)

  // When: 在 terminal 上绘制输入框上方区域（AbovePrompt）
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: 带上出现 demo、3f9a1c07、/repo/template/openspec/changes/demo/spec.html，以及 key=approve:demo:<F>、label=批准起飞 的按钮
  expect(await ui.find({ text: 'demo' })).toBeDefined()
  expect(await ui.find({ text: '3f9a1c07' })).toBeDefined()
  expect(await ui.find({ text: `${DEMO}/spec.html` })).toBeDefined()
  expect((await ui.find({ key: `approve:demo:${F}` }))?.props.label).toBe('批准起飞')
})

test('band-ignores-finished-and-foreign-copies', async ($, on) => {
  // Given: 主 worktree /repo（main）只有 tasks 全勾的 old；/repo/.worktrees/demo（worktree-demo）与 /repo/.wt/x（wf_x）都有未完成的 demo
  const OWN = '/repo/.worktrees/demo'
  const FOREIGN = '/repo/.wt/x'
  const world: World = {
    worktrees: porcelain([[MAIN, 'main'], [OWN, 'worktree-demo'], [FOREIGN, 'wf_x']]),
    dirs: {
      [CHANGES]: ['old'],
      [`${OWN}/template/openspec/changes`]: ['demo'],
      [`${FOREIGN}/template/openspec/changes`]: ['demo'],
    },
    files: {
      [`${CHANGES}/old/spec.html`]: '<html></html>',
      [`${CHANGES}/old/tasks.md`]: '- [x] 1.1 已完成\n',
      [`${HOOKS}/plan_fp.py`]: '',
      [`${OWN}/template/openspec/changes/demo/spec.html`]: '<html></html>',
      [`${OWN}/template/openspec/changes/demo/tasks.md`]: '- [ ] 1.1 写代码\n',
      [`${OWN}/template/.claude/hooks/plan_fp.py`]: '',
      [`${FOREIGN}/template/openspec/changes/demo/spec.html`]: '<html></html>',
      [`${FOREIGN}/template/openspec/changes/demo/tasks.md`]: '- [ ] 1.1 写代码\n',
      [`${FOREIGN}/template/.claude/hooks/plan_fp.py`]: '',
    },
    fp: () => F,
  }
  const log = useWorld(on, world)

  // When: 会话启动（刷新待批准列表）
  await $.session.start(START)

  // Then: 只对 worktree-demo 里的 demo 算了指纹（old 与 wf_x 的副本未入列），带上的 spec.html 路径在 worktree-demo 内，且没有「另有」字样
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  expect(log.fpDirs).toEqual([`${OWN}/template/openspec/changes/demo`])
  expect(await ui.find({ text: `${OWN}/template/openspec/changes/demo/spec.html` })).toBeDefined()
  expect(await ui.findAll({ text: /另有/ })).toHaveLength(0)
})

test('approve-press-appends-ledger-event', async ($, on) => {
  // Given: 批准带显示 demo 与指纹 F，按下时 plan_fp 仍输出 F；账本链尾不存在
  const log = useWorld(on, demoWorld(() => F))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下「批准起飞」，推进时钟让后台起飞跑完
  await ui.press({ key: `approve:demo:${F}` })
  await background(log)

  // Then: 写命令依次为 hash-object、mktree、commit-tree、update-ref refs/flight/demo/ledger <新> 40 个 0；事件 ev=approve、fp=F、by.plugin=flight、by.surface=terminal、by.session=sess-1；插件以 demo 起飞（调用了 demo 的 takeoff-gate），输入框没有被预填
  expect(writes(log)).toEqual(['hash-object', 'mktree', 'commit-tree', 'update-ref'])
  expect(log.git.at(-1)?.args).toEqual(['update-ref', 'refs/flight/demo/ledger', 'c'.repeat(40), '0'.repeat(40)])
  expect(JSON.parse(String(log.git[0]?.stdin))).toMatchObject({
    v: 1,
    ev: 'approve',
    change: 'demo',
    fp: F,
    at: '2026-10-09T12:00:00.000Z',
    by: { plugin: 'flight', surface: 'terminal', session: 'sess-1' },
  })
  expect(log.gates).toEqual(['demo'])
  expect(log.fills).toEqual([])
})

test('approve-press-approves-the-drawn-item', async ($, on) => {
  // Given: 绘制批准带时只有 demo（指纹 F）待批准，记下它的批准按钮；随后刷新列表，zeta（指纹 G、spec.html 更新）成了最新一项并重绘
  const ZETA = `${CHANGES}/zeta`
  const world = demoWorld((_, dir) => (dir === ZETA ? G : F))
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  const demoButton = String((await ui.find({ type: 'Button' }))?.key)
  world.dirs[CHANGES] = ['demo', 'zeta', 'archive']
  world.files[`${ZETA}/spec.html`] = '<html></html>'
  world.files[`${ZETA}/tasks.md`] = '- [ ] 1.1 写代码\n'
  world.mtimes = { [`${ZETA}/spec.html`]: 2000 }
  await $.session.start(START)

  // When: 人按下的是当初显示 demo 的那个按钮；之后再按此刻显示 zeta 的按钮
  const stale = await ui.press({ key: demoButton }).then(
    () => 'landed',
    () => 'missed',
  )
  const writesAfterStale = writes(log)
  await ui.press({ key: String((await ui.find({ type: 'Button' }))?.key) })
  await background(log)

  // Then: 旧按钮的按压没有落到 zeta 上（未写账本）；按下 zeta 自己的按钮才写入 zeta 与 G，并只以 zeta 起飞；输入框没有被预填
  expect(stale).toBe('missed')
  expect(writesAfterStale).toEqual([])
  expect(JSON.parse(String(log.git.find(c => c.args[0] === 'hash-object')?.stdin))).toMatchObject({ change: 'zeta', fp: G })
  expect(log.gates).toEqual(['zeta'])
  expect(log.fills).toEqual([])
})

test('approve-press-refuses-changed-plan', async ($, on) => {
  // Given: 批准带显示指纹 F（第 1 次 plan_fp 输出 F），按下时重算输出 G
  const log = useWorld(on, demoWorld(call => (call === 0 ? F : G)))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: 没有任何写账本的 git 命令，输入框未被预填，出现含「计划已变化」的提示
  expect(writes(log)).toEqual([])
  expect(log.fills).toEqual([])
  expect(log.toasts.some(t => t.includes('计划已变化'))).toBe(true)
})

/** 账本事件（只带去重判定用得到的字段）。 */
function ledgerEvent(ev: string, fp: string) {
  return { v: 1, ev, change: 'demo', fp, at: '2026-10-09T11:00:00.000Z', by: { plugin: 'flight' } }
}

test('approve-press-dedupes-same-fingerprint', async ($, on) => {
  // Given: 批准带已显示 demo 与指纹 F；按下前账本 show 依次为 approve G、takeoff G、approve F（F 之后没有 takeoff）；按下时 plan_fp 仍输出 F
  const world = demoWorld(() => F)
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.ledger = [ledgerEvent('approve', G), ledgerEvent('takeoff', G), ledgerEvent('approve', F)]

  // When: 人再按一次 demo 的「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: 没有任何写账本的 git 命令（账本无新增事件），且出现含「已批准（指纹相同）」的提示
  expect(writes(log)).toEqual([])
  expect(log.toasts.some(t => t.includes('已批准（指纹相同）'))).toBe(true)
})

test('approve-dedupe-prefills-command', async ($, on) => {
  // Given: 批准带已显示 demo 与指纹 F；按下前账本 show 为 approve F（之后没有 takeoff）；按下时 plan_fp 仍输出 F；prompt.fill 应答 isFilled=true
  const world = demoWorld(() => F)
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.ledger = [ledgerEvent('approve', F)]

  // When: 人再按一次 demo 的「批准起飞」，推进时钟让后台起飞跑完
  await ui.press({ key: `approve:demo:${F}` })
  await background(log)

  // Then: 没有写账本的 git 命令；出现含「已批准」的提示；按「起飞」处理：以 demo 起飞一次；输入框没有被预填
  expect(writes(log)).toEqual([])
  expect(log.toasts.some(t => t.includes('已批准'))).toBe(true)
  expect(log.gates).toEqual(['demo'])
  expect(log.fills).toEqual([])
})

test('approve-press-appends-after-takeoff-with-same-fingerprint', async ($, on) => {
  // Given: 批准带已显示 demo 与指纹 F；按下前账本 show 依次为 approve F、takeoff F（takeoff 之后没有 approve）；按下时 plan_fp 仍输出 F
  const world = demoWorld(() => F)
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.ledger = [ledgerEvent('approve', F), ledgerEvent('takeoff', F)]

  // When: 人按下 demo 的「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: 照常追加：写命令依次为 hash-object、mktree、commit-tree、update-ref
  expect(writes(log)).toEqual(['hash-object', 'mktree', 'commit-tree', 'update-ref'])
})

test('approve-press-appends-when-ledger-unreadable', async ($, on) => {
  // Given: 批准带已显示 demo 与指纹 F；按下时 ledger.py show 以 exit 5 失败，plan_fp 仍输出 F
  const world = demoWorld(() => F)
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.showFails = true

  // When: 人按下 demo 的「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: 读失败按不去重处理，照常追加：写命令依次为 hash-object、mktree、commit-tree、update-ref
  expect(writes(log)).toEqual(['hash-object', 'mktree', 'commit-tree', 'update-ref'])
})

test('ledger-append-retries-on-conflict', async ($, on) => {
  // Given: 批准带显示 demo 与指纹 F；第 1 次 update-ref 旧值不符失败，第 2 次成功（此时 rev-parse 读到链尾 dddd…）
  const log = useWorld(on, demoWorld(() => F, { updateRefFailures: 1 }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下「批准起飞」，推进时钟让后台起飞跑完
  await ui.press({ key: `approve:demo:${F}` })
  await background(log)

  // Then: update-ref 共 2 次，第 2 次以重读到的链尾 dddd… 为旧值；以 demo 起飞，输入框没有被预填
  const updates = log.git.filter(c => c.args[0] === 'update-ref')
  expect(updates).toHaveLength(2)
  expect(updates[1]?.args[3]).toBe('d'.repeat(40))
  expect(log.gates).toEqual(['demo'])
  expect(log.fills).toEqual([])
})

test('ledger-append-gives-up-after-three-conflicts', async ($, on) => {
  // Given: 批准带显示 demo 与指纹 F；update-ref 每次都旧值不符失败
  const log = useWorld(on, demoWorld(() => F, { updateRefFailures: 99 }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: update-ref 恰好 3 次后停止，出现含「账本写入失败」的提示，输入框未被预填
  expect(log.git.filter(c => c.args[0] === 'update-ref')).toHaveLength(3)
  expect(log.toasts.some(t => t.includes('账本写入失败'))).toBe(true)
  expect(log.fills).toEqual([])
})

test('bash-guard-denies-ledger-writes', async ($, on) => {
  // Given: 插件已加载；测试在插件之下的 Bash 执行端记录到达的命令
  const reached: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    reached.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' } as never
  })

  // When: 模型发起 Bash 命令 `git update-ref refs/flight/demo/ledger abc`
  const result = await $.tool.call({ tool: 'Bash', command: 'git update-ref refs/flight/demo/ledger abc' })

  // Then: 调用被拒、理由含 ledger.py show，且命令没有到达执行端
  expect(JSON.stringify(result)).toContain('ledger.py show')
  expect(reached).toEqual([])
})

test('bash-guard-passes-other-commands', async ($, on) => {
  // Given: 插件已加载；测试在插件之下的 Bash 执行端记录到达的命令并回答 stdout=clean
  const reached: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    reached.push(e.command)
    return { result: { stdout: 'clean', stderr: '', interrupted: false }, text: 'clean' } as never
  })

  // When: 模型发起 Bash 命令 `git status`
  await $.tool.call({ tool: 'Bash', command: 'git status' })

  // Then: 命令原样到达执行端
  expect(reached).toEqual(['git status'])
})

test('file-write-guard-denies-ledger-ref', async ($, on) => {
  // Given: 插件已加载；测试在插件之下的 Write / Edit / NotebookEdit 执行端记录到达的目标路径
  const reached: string[] = []
  on('tool.call', { tool: 'Write' }, ($, e) => {
    reached.push(e.file_path)
    return { result: {}, text: '' } as never
  })
  on('tool.call', { tool: 'Edit' }, ($, e) => {
    reached.push(e.file_path)
    return { result: {}, text: '' } as never
  })
  on('tool.call', { tool: 'NotebookEdit' }, ($, e) => {
    reached.push(e.notebook_path)
    return { result: {}, text: '' } as never
  })

  // When: 模型 Write 账本 ref 文件、Edit packed-refs、NotebookEdit refs/flight 下的文件，再 Write 一个普通文件
  const ref = await $.tool.call({ tool: 'Write', file_path: '/repo/.git/refs/flight/demo/ledger', content: 'abc\n' })
  const packed = await $.tool.call({ tool: 'Edit', file_path: '/repo/.git/packed-refs', old_string: 'a', new_string: 'b' })
  const nb = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/.git/refs/flight/demo/x', new_source: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: '# r\n' })

  // Then: 前三次被拒、理由含 ledger.py show 且没有到达执行端；普通文件原样到达
  for (const r of [ref, packed, nb]) expect(JSON.stringify(r)).toContain('ledger.py show')
  expect(reached).toEqual(['/repo/README.md'])
})

test('monitor-guard-denies-ledger-writes', async ($, on) => {
  // Given: 插件已加载；测试在插件之下的 Monitor 执行端记录到达的命令
  const reached: string[] = []
  on('tool.call', { tool: 'Monitor' }, ($, e) => {
    reached.push(String(e.command))
    return { result: {}, text: '' } as never
  })

  // When: 模型用 Monitor 跑 `git update-ref refs/flight/demo/ledger abc`，再跑 `tail -f app.log`
  const denied = await $.tool.call({
    tool: 'Monitor',
    description: 'x',
    timeout_ms: 1000,
    command: 'git update-ref refs/flight/demo/ledger abc',
  })
  await $.tool.call({ tool: 'Monitor', description: 'y', timeout_ms: 1000, command: 'tail -f app.log' })

  // Then: 前者被拒、理由含 ledger.py show 且没有到达执行端；后者原样到达
  expect(JSON.stringify(denied)).toContain('ledger.py show')
  expect(reached).toEqual(['tail -f app.log'])
})

test('no-model-callable-approval-path', async ($, on) => {
  // Given: 插件已加载，仓库里有待批准的 demo；测试在插件之下记录 tool.register 与 command.register
  const log = useWorld(on, demoWorld(() => F))

  // When: 会话启动
  await $.session.start(START)

  // Then: 插件确实处理了启动（读过会话版本），注册的工具恰为 submit_findings、measure 与 ship，注册的命令恰为 flight 与 opsx-apply
  expect(log.versionReads).toBeGreaterThan(0)
  expect([...log.tools].sort()).toEqual(['measure', 'ship', 'submit_findings'])
  expect([...log.commands].sort()).toEqual(['flight', 'opsx-apply'])
})

test('only-findings-tool-registered', async ($, on) => {
  // Given: 插件已加载，仓库里有待批准的 demo，会话已启动；submit_findings、measure 与 ship 各三种输入：主会话（无 agentId）、非飞行 agent X 带 1 条 HIGH、X 伪造 ev=approve 与 fp=F；另有以 composer 来源发出的 /flight status demo、abort demo、resume demo
  const log = useWorld(on, demoWorld(() => F))
  await $.session.start(START)
  const inputs = [
    { findings: [] },
    { agentId: 'X', findings: [{ severity: 'HIGH', file: 'a.py', line: 1, summary: 's', fix: 'f' }] },
    { agentId: 'X', findings: 'approve', ev: 'approve', fp: F },
  ]
  const calls = ['mcp__flight__submit_findings', 'mcp__flight__measure', 'mcp__flight__ship'].flatMap(tool => inputs.map(x => ({ tool, ...x })))
  const flights = ['status demo', 'abort demo', 'resume demo'].map(args => ({ command: 'flight', args, origin: { kind: 'composer' } }))

  // When: 依次以这九种调用请求三个工具，再依次发出三条 /flight 命令
  for (const c of calls) await $.tool.call(c as never)
  for (const c of flights) await $.command.run(c as never)

  // Then: 工具恰为 submit_findings、measure 与 ship，命令恰为 flight 与 opsx-apply；全部调用都没有向账本写入任何事件（自然没有 approve）
  expect([...log.tools].sort()).toEqual(['measure', 'ship', 'submit_findings'])
  expect([...log.commands].sort()).toEqual(['flight', 'opsx-apply'])
  expect(log.git.filter(c => c.args[0] === 'hash-object')).toEqual([])
})

test('tools-and-commands-invariant', async ($, on) => {
  // Given: 插件已加载，仓库里有待批准的 demo（账本为空、未落地），会话已启动；三种输入：主会话（无 agentId）{change: demo, pr: 7}、非飞行 agent X 的 {change: demo, pr: 7}、X 伪造 ev=approve 与 fp=F
  const log = useWorld(on, demoWorld(() => F))
  await $.session.start(START)
  const inputs = [{ change: 'demo', pr: '7' }, { agentId: 'X', change: 'demo', pr: '7' }, { agentId: 'X', ev: 'approve', fp: F }]
  const calls = ['mcp__flight__measure', 'mcp__flight__ship', 'mcp__flight__submit_findings'].flatMap(tool => inputs.map(x => ({ tool, ...x })))

  // When: 依次以三种输入调用三个工具（共九次）
  for (const c of calls) await $.tool.call(c as never)

  // Then: 工具按名排序恰为 measure、ship、submit_findings；命令恰为 flight、opsx-apply；全部调用都没有向账本写入任何事件
  expect([...log.tools].sort()).toEqual(['measure', 'ship', 'submit_findings'])
  expect([...log.commands].sort()).toEqual(['flight', 'opsx-apply'])
  expect(log.git.filter(c => c.args[0] === 'hash-object')).toEqual([])
})

test('version-floor-disables-band', async ($, on) => {
  // Given: 会话版本 2.1.200，主 worktree 里有待批准的 demo
  const log = useWorld(on, demoWorld(() => F, { version: '2.1.200' }))
  await $.session.start(START)

  // When: 在 terminal 上绘制输入框上方区域
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: 没有「批准起飞」按钮、引擎自己的带照常绘制，且出现含 2.1.295 的版本提示
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(log.toasts.some(t => t.includes('2.1.295'))).toBe(true)
})

test('version-unreadable-disables-band', async ($, on) => {
  // Given: 读会话版本的调用失败（旧引擎没有该 API），主 worktree 里有待批准的 demo
  const log = useWorld(on, demoWorld(() => F, { versionFails: true }))
  await $.session.start(START)

  // When: 主会话一轮结束后绘制输入框上方区域
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: 插件读过版本；没有「批准起飞」按钮、引擎自己的带照常绘制，且没有为任何 change 算过指纹
  expect(log.versionReads).toBeGreaterThan(0)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(log.fpDirs).toEqual([])
})

test('band-prefers-approvable-item', async ($, on) => {
  // Given: 主 worktree /repo（main）的 demo 可批准、spec.html mtime 1000；/repo/.worktrees/zeta（worktree-zeta）的 zeta spec.html mtime 2000，该 worktree 下没有 plan_fp.py
  const ZT = '/repo/.worktrees/zeta'
  const ZETA = `${ZT}/template/openspec/changes/zeta`
  const world = demoWorld(() => F, {
    worktrees: porcelain([[MAIN, 'main'], [ZT, 'worktree-zeta']]),
    mtimes: { [`${DEMO}/spec.html`]: 1000, [`${ZETA}/spec.html`]: 2000 },
  })
  world.dirs[`${ZT}/template/openspec/changes`] = ['zeta']
  world.files[`${ZETA}/spec.html`] = '<html></html>'
  world.files[`${ZETA}/tasks.md`] = '- [ ] 1.1 写代码\n'
  useWorld(on, world)
  await $.session.start(START)

  // When: 在 terminal 上绘制输入框上方区域
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: 出现 key=approve:demo:<F> 的批准按钮，且有含「另有 1 个无法批准」的文字
  expect(await ui.find({ key: `approve:demo:${F}` })).toBeDefined()
  expect(await ui.find({ text: /另有 1 个无法批准/ })).toBeDefined()
})

test('version-unreadable-shows-notice', async ($, on) => {
  // Given: 读会话版本的调用抛错，主 worktree 里有待批准的 demo
  const log = useWorld(on, demoWorld(() => F, { versionFails: true }))
  await $.session.start(START)

  // When: 在 terminal 上绘制输入框上方区域
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: toasts 里有含「无法确认 Claude Code 版本」的一条，且没有任何按钮
  expect(log.toasts.some(t => t.includes('无法确认 Claude Code 版本'))).toBe(true)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
})

test('guard-normalizes-ledger-paths', async ($, on) => {
  // Given: 插件已加载；测试在插件之下的 Write 执行端记录到达的目标路径；三个目标为反斜杠、含 //、含 /./ 的账本 ref 路径
  const reached: string[] = []
  on('tool.call', { tool: 'Write' }, ($, e) => {
    reached.push(e.file_path)
    return { result: {}, text: '' } as never
  })
  const paths = [
    'C:\\repo\\.git\\refs\\flight\\demo\\ledger',
    '/repo/.git/refs//flight/demo/ledger',
    '/repo/.git/refs/./flight/demo/ledger',
  ]

  // When: 模型对这三个路径各发起一次 Write
  const results = await Promise.all(paths.map(file_path => $.tool.call({ tool: 'Write', file_path, content: 'abc\n' })))

  // Then: 三次结果都含 ledger.py show，且没有任何路径到达执行端
  for (const r of results) expect(JSON.stringify(r)).toContain('ledger.py show')
  expect(reached).toEqual([])
})

test('guard-denies-gate-record-writes', async ($, on) => {
  // Given: 插件已加载；测试在插件之下的 Bash 执行端记录到达的命令
  const reached: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    reached.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' } as never
  })
  const gate = 'python3 .claude/hooks/slice-gate.py gate S1 --change-dir openspec/changes/demo'

  // When: 模型先发起 Bash `git update-ref refs/flight/demo/gate-S1 abc`，再发起 slice-gate.py gate 命令
  const denied = await $.tool.call({ tool: 'Bash', command: 'git update-ref refs/flight/demo/gate-S1 abc' })
  await $.tool.call({ tool: 'Bash', command: gate })

  // Then: 前者被拒、理由含 ledger.py show 且未到达执行端；后者原样到达
  expect(JSON.stringify(denied)).toContain('ledger.py show')
  expect(reached).toEqual([gate])
})

const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

/** 已停飞的账本：approve F → attempt 1 的 takeoff → halt。 */
function haltedLedger(change: string) {
  const by = { plugin: 'flight', session: 'sess-0' }
  return [
    { v: 1, ev: 'approve', change, fp: F, at: '2026-10-09T10:00:00.000Z', by },
    { v: 1, ev: 'takeoff', change, attempt: 1, fp: F, at: '2026-10-09T10:01:00.000Z', by },
    { v: 1, ev: 'halt', change, attempt: 1, reason: 'S2 blocked', at: '2026-10-09T10:30:00.000Z', by },
  ]
}

/**
 * 主 worktree 里的若干 change：alpha 已停飞、计划改过（当前 G，最近批准 F）；beta 已停飞、计划未改（F / F）；
 * gamma 从未起飞、未批准（F / 空）。只放 names 里给出的。
 */
function haltWorld(names: string[]): World {
  const fps: Record<string, string> = { alpha: G, beta: F, gamma: F }
  const approved: Record<string, string> = { alpha: F, beta: F, gamma: '' }
  const ledgers: Record<string, object[]> = { alpha: haltedLedger('alpha'), beta: haltedLedger('beta'), gamma: [] }
  const world = demoWorld((_, dir) => fps[dir.split('/').pop() ?? ''] ?? F, { approved: {}, ledgers: {}, worktrees: flyable(names) })
  world.dirs[CHANGES] = names
  for (const name of names) {
    world.files[`${CHANGES}/${name}/spec.html`] = '<html></html>'
    world.files[`${CHANGES}/${name}/tasks.md`] = '- [ ] 1.1 写代码\n'
    world.approved![name] = approved[name] ?? ''
    world.ledgers![name] = ledgers[name] ?? []
  }
  return world
}

/** 让 name 成为 spec.html 最近修改的一项。 */
function newestIs(world: World, name: string): void {
  world.mtimes = { [`${CHANGES}/${name}/spec.html`]: 2000 }
}

test('band-offers-resume-for-halted', async ($, on) => {
  // Given: 主 worktree 有 alpha（最新 attempt 以 halt 结束、当前指纹 G ≠ 最近批准 F）、beta（halt、当前与批准都为 F）、gamma（账本为空、未批准、指纹 F）；terminal 与 desktop 各挂一个批准带
  const world = haltWorld(['alpha', 'beta', 'gamma'])
  useWorld(on, world)
  await $.session.start(START)
  const surfaces = [
    await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND }),
    await $.ui.mount({ plugin: 'flight', surface: 'desktop', ...BAND }),
  ]

  // When: 依次让 alpha、beta、gamma 成为最近修改的一项并刷新，每次在两个绘制面上读出按钮 key、label 与说明行是否含「提交本 change 的工件」「重跑基线」
  const seen: string[] = []
  for (const name of ['alpha', 'beta', 'gamma']) {
    newestIs(world, name)
    await $.turn.complete(TURN)
    for (const ui of surfaces) {
      const button = await ui.find({ type: 'Button' })
      const note = (await ui.find({ text: /提交本 change 的工件/ })) !== undefined && (await ui.find({ text: /重跑基线/ })) !== undefined
      seen.push(`${String(button?.key)}|${String(button?.props.label)}|${note}`)
    }
  }

  // Then: alpha 在两面都是 replan:alpha:<G>、「批准修订并续飞」且有说明行；beta 两面都是 resume:beta:<F>、「续飞」、无说明行；gamma 两面都是 approve:gamma:<F>、「批准起飞」、无说明行
  expect(seen.filter(s => s.includes(':alpha:'))).toEqual(Array(2).fill(`replan:alpha:${G}|批准修订并续飞|true`))
  expect(seen.filter(s => s.includes(':beta:'))).toEqual(Array(2).fill(`resume:beta:${F}|续飞|false`))
  expect(seen.filter(s => s.includes(':gamma:'))).toEqual(Array(2).fill(`approve:gamma:${F}|批准起飞|false`))
})

test('press-approves-then-resumes', async ($, on) => {
  // Given: alpha（已停飞、计划改过，指纹 G）为最新一项，beta（已停飞、计划未改，指纹 F）次之；slice-gate.py baseline 以 exit 0、{"ok": true, "reasons": []} 作答；prompt.fill 一律 isFilled true；测试世界记下 baseline 的 --change-dir、预填文本与 ui.notify 收到的正文
  const world = haltWorld(['alpha', 'beta'])
  world.baseline = { exitCode: 0, stdout: JSON.stringify({ ok: true, reasons: [] }) }
  newestIs(world, 'alpha')
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 人按下 alpha 的「批准修订并续飞」；beta 成为最新一项后再按下它的「续飞」；推进时钟让后台续飞跑完
  await ui.press({ key: `replan:alpha:${G}` })
  newestIs(world, 'beta')
  await $.turn.complete(TURN)
  await ui.press({ key: `resume:beta:${F}` })
  await background(log)

  // Then: 账本恰追加一条 approve（alpha、fp G），beta 没有；baseline 只为 alpha 跑过（alpha replan true、beta replan false）；alpha、beta 都起飞了（不依赖先后），输入框没有被预填；通知里有一条含起飞回复首行「起飞守卫未通过」
  const approves = log.git.filter(c => c.args[0] === 'hash-object').map(c => JSON.parse(String(c.stdin)))
  expect(approves.map(a => [a.change, a.fp])).toEqual([['alpha', G]])
  expect(log.baselines).toEqual([`${CHANGES}/alpha`])
  expect([...log.gates].sort()).toEqual(['alpha', 'beta'])
  expect(log.fills).toEqual([])
  expect(log.notes.some(n => n.includes('起飞守卫未通过'))).toBe(true)
})

// ---------------------------------------------------------------- flight-armed-takeoff S5：按下即起飞

/** 账本事件（带 attempt 与额外字段）。 */
function attemptEvent(change: string, ev: string, at: string, extra: object = {}) {
  return { v: 1, ev, change, attempt: 1, at: `2026-10-09T${at}.000Z`, by: { plugin: 'flight', session: 'sess-0' }, ...extra }
}

test('band-offers-takeoff-for-approved', async ($, on) => {
  // Given: demo 账本只有 approve F（之后从未起飞），ledger approved 输出 F，当前指纹 F；git status 列出 demo 的 proposal.md（已改）与 design.md（未跟踪）两个工件；起飞守卫放行，起飞检查走到提交工件之后在 lint 停下
  const world = demoWorld(() => F, {
    ledger: [ledgerEvent('approve', F)],
    approved: { demo: F },
    status: ' M template/openspec/changes/demo/proposal.md\n?? template/openspec/changes/demo/design.md\n',
    gatePasses: true,
  })
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 读出批准带上 demo 的按钮与说明行，按下该按钮并推进时钟让后台起飞跑完
  const button = await ui.find({ type: 'Button' })
  const note = await ui.find({ text: /提交本 change 的 2 个工件/ })
  await ui.press({ key: String(button?.key) })
  await background(log)

  // Then: 按钮为 takeoff:demo:<F>、「起飞」；说明行含「提交本 change 的 2 个工件」；没有写账本的 git 命令（没追加 approve）；以 demo 起飞；输入框没有被预填；起飞带了「授权提交」：恰对 proposal.md 与 design.md 做了一次 git commit
  expect(`${String(button?.key)}|${String(button?.props.label)}`).toBe(`takeoff:demo:${F}|起飞`)
  expect(note).toBeDefined()
  expect(writes(log)).toEqual([])
  expect(log.gates).toEqual(['demo'])
  expect(log.fills).toEqual([])
  expect(committed(log)).toEqual([[`${DEMO}/proposal.md`, `${DEMO}/design.md`]])
})

test('band-counts-declared-artifacts', async ($, on) => {
  // Given: demo 账本只有 approve F（之后从未起飞），ledger approved 输出 F，当前指纹 F；slices.json 的 artifact_files 为 tests/helpers.py；git status 列出 demo 的 proposal.md（已改）、design.md（未跟踪）与 tests/helpers.py（未跟踪）
  const world = demoWorld(() => F, {
    ledger: [ledgerEvent('approve', F)],
    approved: { demo: F },
    status: ' M template/openspec/changes/demo/proposal.md\n?? template/openspec/changes/demo/design.md\n?? tests/helpers.py\n',
  })
  world.files[`${DEMO}/slices.json`] = JSON.stringify({ artifact_files: ['tests/helpers.py'] })
  useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 读出批准带上 demo 的说明行
  const note = await ui.find({ text: /提交本 change 的 3 个工件/ })

  // Then: 说明行含「提交本 change 的 3 个工件」
  expect(note).toBeDefined()
})

test('band-ignores-landed-and-aborted', async ($, on) => {
  // Given: 计划都未改（当前与最近批准都为 F）的 alpha、beta、gamma：alpha 的 attempt 1 先 land、1 秒后又记 halt；beta 的 attempt 1 以 kind=abort 的 halt 结束；gamma 的 attempt 1 以 kind=blocked 的 halt 结束
  const world = haltWorld(['alpha', 'beta', 'gamma'])
  world.fp = () => F
  world.approved = { alpha: F, beta: F, gamma: F }
  const flown = (change: string) => [attemptEvent(change, 'approve', '10:00:00', { attempt: undefined, fp: F }), attemptEvent(change, 'takeoff', '10:01:00', { fp: F })]
  world.ledgers = {
    alpha: [...flown('alpha'), attemptEvent('alpha', 'land', '10:30:00', { verdict: 'ready' }), attemptEvent('alpha', 'halt', '10:30:01', { reason: '会话中断' })],
    beta: [...flown('beta'), attemptEvent('beta', 'halt', '10:30:00', { reason: '人工中止', kind: 'abort' })],
    gamma: [...flown('gamma'), attemptEvent('gamma', 'halt', '10:30:00', { reason: 'S2 blocked', kind: 'blocked' })],
  }
  useWorld(on, world)

  // When: 会话启动（刷新批准带）后绘制
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: 不以 shelve: 开头的按钮恰为 resume:gamma:<F>，另有 gamma 的「搁置」按钮 shelve:gamma:<F>（flight-shelve-followups 起每个可操作项都多画一个「搁置」，故按前缀筛掉再比）；没有「另有 N 个」字样（alpha、beta 都不在带上）
  const keys = (await ui.findAll({ type: 'Button' })).map(b => String(b.key))
  expect(keys.filter(k => !k.startsWith('shelve:'))).toEqual([`resume:gamma:${F}`])
  expect(keys).toContain(`shelve:gamma:${F}`)
  expect(await ui.findAll({ text: /另有/ })).toHaveLength(0)
})

test('band-approve-takes-off', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F；git status 列出 demo 的 proposal.md 一个未提交工件；起飞守卫放行，起飞检查走到提交工件之后在 lint 停下；批准带已显示 demo 的「批准起飞」
  const log = useWorld(on, demoWorld(() => F, { status: ' M template/openspec/changes/demo/proposal.md\n', gatePasses: true }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 approve:demo:<F>，推进时钟让后台起飞跑完
  await ui.press({ key: `approve:demo:${F}` })
  await background(log)

  // Then: 账本追加了 fp=F 的 approve；以 demo 起飞；toast 里有起飞回复首行（含「slice-gate lint 未通过」）；输入框没有被预填；起飞带了「授权提交」：恰对 proposal.md 做了一次 git commit
  expect(JSON.parse(String(log.git.find(c => c.args[0] === 'hash-object')?.stdin))).toMatchObject({ ev: 'approve', fp: F })
  expect(log.gates).toEqual(['demo'])
  expect(log.toasts.some(t => t.includes('slice-gate lint 未通过'))).toBe(true)
  expect(log.fills).toEqual([])
  expect(committed(log)).toEqual([[`${DEMO}/proposal.md`]])
})

test('band-resume-takes-off', async ($, on) => {
  // Given: alpha（已停飞、计划改过，指纹 G）为最新一项，beta（已停飞、计划未改，指纹 F）次之；slice-gate.py baseline 以 exit 0 作答
  const world = haltWorld(['alpha', 'beta'])
  world.baseline = { exitCode: 0, stdout: JSON.stringify({ ok: true, reasons: [] }) }
  newestIs(world, 'alpha')
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 alpha 的「批准修订并续飞」；beta 成为最新一项后按下它的「续飞」；推进时钟让后台续飞跑完
  await ui.press({ key: `replan:alpha:${G}` })
  newestIs(world, 'beta')
  await $.turn.complete(TURN)
  await ui.press({ key: `resume:beta:${F}` })
  await background(log)

  // Then: 只为 alpha 追加了 fp=G 的 approve；只为 alpha 跑过基线；alpha、beta 都起飞了（按名排序比较，不依赖先后）；输入框没有被预填
  const approves = log.git.filter(c => c.args[0] === 'hash-object').map(c => JSON.parse(String(c.stdin)))
  expect(approves.map(a => [a.change, a.fp])).toEqual([['alpha', G]])
  expect(log.baselines).toEqual([`${CHANGES}/alpha`])
  expect([...log.gates].sort()).toEqual(['alpha', 'beta'])
  expect(log.fills).toEqual([])
})

test('band-resume-stops-diagnostician', async ($, on) => {
  // Given: beta 已停飞、计划未改；账本 attempt 1 在 halt 之后有诊断员 d1 的 dispatch、没有 d1 的 ended；agent.list 里 d1 为 running
  const world = haltWorld(['beta'])
  world.ledgers!.beta = [...haltedLedger('beta'), attemptEvent('beta', 'dispatch', '10:31:00', { slice: 'S2', agent: 'd1', role: 'diagnostician' })]
  world.agents = [{ id: 'd1', status: 'running' }]
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 beta 的「续飞」，推进时钟让后台续飞跑完
  await ui.press({ key: `resume:beta:${F}` })
  await background(log)

  // Then: 按发生顺序恰为对 d1 的一次 TaskStop、随后对 beta 的起飞（takeoff-gate）
  expect(log.order).toEqual(['stop d1', 'gate beta'])
})

// ---------------------------------------------------------------- flight-armed-followups S5：进行中显示、基线进度、去重提示

test('band-shows-busy-while-taking-off', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F；takeoff-gate.py 要等 release() 之后才作答；批准带已显示 demo 的「批准起飞」
  let release: () => void = () => undefined
  const log = useWorld(on, demoWorld(() => F, { gateWait: new Promise<void>(r => (release = r)) }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 approve:demo:<F>（按键处理等守卫作答，先不 await），等到守卫已被调用后读出重绘后的批准带；随后放行守卫，等按键处理返回
  const pressed = ui.press({ key: `approve:demo:${F}` })
  await until(() => log.gates.length === 1)
  const busy = await ui.find({ text: /起飞中…/ })
  const buttons = await ui.findAll({ type: 'Button' })
  release()
  await pressed
  await background(log)

  // Then: 起飞返回前批准带有「起飞中…」且没有按钮；放行后批准带不再有「起飞中…」；以 demo 起飞了一次
  expect(busy).toBeDefined()
  expect(buttons).toHaveLength(0)
  expect(await ui.findAll({ text: /起飞中…/ })).toHaveLength(0)
  expect(log.gates).toEqual(['demo'])
})

test('band-shows-baseline-progress', async ($, on) => {
  // Given: alpha 已停飞、计划改过（当前 G、最近批准 F）；slice-gate.py baseline 要等 release() 之后才以 exit 0 作答；alpha 的 slices.json 里 gate.full_suite_sec 为 132；批准带显示 alpha 的「批准修订并续飞」
  let release: () => void = () => undefined
  const world = haltWorld(['alpha'])
  world.baselineWait = new Promise<void>(r => (release = r))
  world.files[`${CHANGES}/alpha/slices.json`] = JSON.stringify({ gate: { full_suite_sec: 132 } })
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  const progress = () => log.statuses.filter(s => s.includes('基线已跑'))

  // When: 按下 replan:alpha:<G>（按键处理等基线结束，先不 await），等到基线已启动后推进时钟 60 秒（基线未结束），读出状态行与批准带；放行基线、等按键处理返回，再推进 120 秒
  const pressed = ui.press({ key: `replan:alpha:${G}` })
  await until(() => log.baselines.length === 1)
  await log.clock.advance(60000)
  const line = progress().at(-1)
  const band = await ui.find({ text: /基线运行中/ })
  const buttons = await ui.findAll({ type: 'Button' })
  release()
  await pressed
  await background(log)
  const afterRelease = progress().length
  await log.clock.advance(120000)
  await log.clock.settle()

  // Then: 推进后的状态行含「续飞准备中 alpha」「基线已跑 1 分钟」「上次全量约 2 分钟」；批准带含「基线运行中」且没有按钮；基线只启动了一次；放行后再推进 120 秒，基线进度状态行条数不变
  expect(line).toContain('续飞准备中 alpha')
  expect(line).toContain('基线已跑 1 分钟')
  expect(line).toContain('上次全量约 2 分钟')
  expect(band).toBeDefined()
  expect(buttons).toHaveLength(0)
  expect(log.baselines).toEqual([`${CHANGES}/alpha`])
  expect(progress()).toHaveLength(afterRelease)
})

test('band-dedupe-toast-says-takeoff', async ($, on) => {
  // Given: 批准带已显示 demo 的「批准起飞」（指纹 F）；按下前账本 show 变为 approve F（另一次按键刚写入、之后没有 takeoff）；按下时 plan_fp 仍输出 F
  const world = demoWorld(() => F)
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.ledger = [ledgerEvent('approve', F)]

  // When: 按下 approve:demo:<F>，推进时钟让后台起飞跑完
  await ui.press({ key: `approve:demo:${F}` })
  await background(log)

  // Then: 有一条 toast 含「flight：demo 已批准（指纹相同），直接起飞」；没有含「无需重复按」的 toast；以 demo 起飞了一次
  expect(log.toasts.some(t => t.includes('flight：demo 已批准（指纹相同），直接起飞'))).toBe(true)
  expect(log.toasts.filter(t => t.includes('无需重复按'))).toEqual([])
  expect(log.gates).toEqual(['demo'])
})

// ---------------------------------------------------------------- flight-dispatch-origin S3：按键处理之内起飞与续飞

test('press-takes-off-before-returning', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F；起飞守卫以 exit 3「未批准」立即作答；批准带已显示 demo 的「批准起飞」
  const log = useWorld(on, demoWorld(() => F))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 approve:demo:<F> 并等这次按键处理返回（期间不推进时钟）
  await ui.press({ key: `approve:demo:${F}` })

  // Then: 账本已追加 fp=F 的 approve；起飞守卫恰以 demo 运行一次；toast 里已有起飞回复首行（含「起飞守卫未通过」）
  expect(JSON.parse(String(log.git.find(c => c.args[0] === 'hash-object')?.stdin))).toMatchObject({ ev: 'approve', fp: F })
  expect(log.gates).toEqual(['demo'])
  expect(log.toasts.some(t => t.includes('起飞守卫未通过'))).toBe(true)
})

test('resume-press-takes-off-before-returning', async ($, on) => {
  // Given: alpha 已停飞、计划改过（当前 G、最近批准 F），批准带显示「批准修订并续飞」；slice-gate.py baseline 立即以 exit 0、{"ok": true} 作答
  const world = haltWorld(['alpha'])
  world.baseline = { exitCode: 0, stdout: JSON.stringify({ ok: true, reasons: [] }) }
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 replan:alpha:<G> 并等这次按键处理返回（期间不推进时钟）
  await ui.press({ key: `replan:alpha:${G}` })

  // Then: 基线恰对 alpha 运行一次；起飞守卫恰以 alpha 运行一次
  expect(log.baselines).toEqual([`${CHANGES}/alpha`])
  expect(log.gates).toEqual(['alpha'])
})

test('second-press-while-busy-refused', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F；takeoff-gate.py 要等 release() 之后才作答；批准带已显示 demo 的「批准起飞」；
  //        按下之后的前两次批准带重绘读取抛错（批准带停在旧的「批准起飞」，模拟引擎在重绘前交付旧按钮的按键）；已按下 approve:demo:<F>（先不 await），并等到起飞守卫已被调用
  let release: () => void = () => undefined
  const world = demoWorld(() => F, { gateWait: new Promise<void>(r => (release = r)) })
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.refreshThrows = 2
  const first = ui.press({ key: `approve:demo:${F}` })
  await until(() => log.gates.length === 1)

  // When: 第一次按键尚未返回（守卫已被调用、未作答）时再按一次 approve:demo:<F>，至多等 1 秒看它是否返回；随后放行守卫、等第一次按键返回（期间都不推进时钟）
  const second = await Promise.race([
    ui.press({ key: `approve:demo:${F}` }).then(() => 'returned'),
    new Promise<string>(r => setTimeout(() => r('pending'), 1000)),
  ])
  release()
  await first

  // Then: 第二次按键在放行前已返回；有一条 toast 含「flight：demo 正在起飞」；起飞守卫总共只以 demo 运行一次；账本只追加了一条 approve
  expect(second).toBe('returned')
  expect(log.toasts.some(t => t.includes('flight：demo 正在起飞'))).toBe(true)
  expect(log.gates).toEqual(['demo'])
  expect(log.git.filter(c => c.args[0] === 'hash-object')).toHaveLength(1)
})

test('refresh-failure-clears-busy', async ($, on) => {
  // Given: demo 账本只有 approve F、ledger approved 输出 F、当前指纹 F（已批准、未起飞），批准带显示「起飞」；按下之后第一次批准带重绘读 git worktree list 时抛错一次；已按下 takeoff:demo:<F> 并等按键处理返回（期间不推进时钟）
  const world = demoWorld(() => F, { ledger: [ledgerEvent('approve', F)], approved: { demo: F } })
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.refreshThrows = 1
  const pressed = await ui.press({ key: `takeoff:demo:${F}` }).then(
    () => 'returned',
    () => 'threw',
  )

  // When: 按键处理返回后，主会话一轮结束让批准带重绘
  await $.turn.complete(TURN)

  // Then: 按键处理正常返回（没有抛错）；起飞守卫已以 demo 运行；重绘后的批准带不含「起飞中…」
  expect(pressed).toBe('returned')
  expect(log.gates).toEqual(['demo'])
  expect(await ui.findAll({ text: /起飞中…/ })).toHaveLength(0)
})

test('baseline-status-restored', async ($, on) => {
  // Given: alpha 已停飞、计划改过（当前 G、最近批准 F），批准带显示「批准修订并续飞」；slice-gate.py baseline 以 exit 1、reasons ["S2 verify 红"] 作答；没有别的待命，也没有在飞的 change
  const world = haltWorld(['alpha'])
  world.baseline = { exitCode: 1, stdout: JSON.stringify({ ok: false, reasons: ['S2 verify 红'] }) }
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 replan:alpha:<G> 并等这次按键处理返回
  await ui.press({ key: `replan:alpha:${G}` })

  // Then: 最后一次状态行不含「续飞准备中」
  expect(log.statuses.at(-1) ?? '').not.toContain('续飞准备中')
})

// flight-shelve-followups 护栏（规划时预写，base 上已成立）：搁置判定只在指纹相同时隐藏，改计划后须重新出现
test('replanned-shelved-change-reappears', async ($, on) => {
  // Given: demo 账本依次为 approve F、shelve F；ledger approved 输出空（最新决定是 shelve）；计划改动后 plan_fp 输出 G
  useWorld(on, demoWorld(() => G, { ledger: [ledgerEvent('approve', F), ledgerEvent('shelve', F)], approved: { demo: '' } }))

  // When: 会话启动（刷新批准带）后绘制
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: key=approve:demo:<G> 的按钮 label 为「批准起飞」
  expect((await ui.find({ key: `approve:demo:${G}` }))?.props.label).toBe('批准起飞')
})

// ---------------------------------------------------------------- flight-shelve-followups S3：搁置、读账本用主检出的判定器、逐行列出工件

/** 本次按键写入账本的事件（hash-object 的 stdin）；没有写入时为 undefined。 */
function writtenEvent(log: { git: GitCall[] }): Record<string, unknown> | undefined {
  const stdin = log.git.find(c => c.args[0] === 'hash-object')?.stdin
  return stdin === undefined ? undefined : JSON.parse(stdin)
}

test('shelve-press-writes-event-and-hides', async ($, on) => {
  // Given: demo 账本只有 approve F（之后从未起飞）、ledger approved 输出 F、当前指纹 F，批准带显示 demo 的「起飞」
  const log = useWorld(on, demoWorld(() => F, { ledger: [ledgerEvent('approve', F)], approved: { demo: F } }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 在 terminal 上按下 shelve:demo:<F>
  await ui.press({ key: `shelve:demo:${F}` })

  // Then: 账本追加的事件 ev=shelve、fp=F、by.surface=terminal；有一条 toast 含「已搁置」；刷新后批准带没有任何按钮；起飞守卫没有运行
  expect(writtenEvent(log)).toMatchObject({ ev: 'shelve', change: 'demo', fp: F, by: { plugin: 'flight', surface: 'terminal' } })
  expect(log.toasts.some(t => t.includes('已搁置'))).toBe(true)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(log.gates).toEqual([])
})

test('shelve-hides-halted-flight', async ($, on) => {
  // Given: gamma 计划未改（当前与最近批准都为 F），账本为 approve F、attempt 1 的 takeoff、kind=blocked 的 halt；批准带显示 gamma 的「续飞」
  const world = haltWorld(['gamma'])
  world.fp = () => F
  world.approved = { gamma: F }
  world.ledgers = {
    gamma: [
      attemptEvent('gamma', 'approve', '10:00:00', { attempt: undefined, fp: F }),
      attemptEvent('gamma', 'takeoff', '10:01:00', { fp: F }),
      attemptEvent('gamma', 'halt', '10:30:00', { reason: 'S2 blocked', kind: 'blocked' }),
    ],
  }
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 shelve:gamma:<F>
  await ui.press({ key: `shelve:gamma:${F}` })

  // Then: 账本追加 ev=shelve、fp=F 的事件；刷新后批准带上没有 gamma 的文字；没有跑基线；起飞守卫没有运行
  expect(writtenEvent(log)).toMatchObject({ ev: 'shelve', change: 'gamma', fp: F })
  expect(await ui.findAll({ text: /gamma/ })).toHaveLength(0)
  expect(log.baselines).toEqual([])
  expect(log.gates).toEqual([])
})

test('shelve-refused-when-judges-unaware', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F，批准带显示 approve:demo:<F> 与 shelve:demo:<F>；ledger.py events 输出 EVENT_TYPES 去掉 shelve
  const log = useWorld(on, demoWorld(() => F, { events: EVENT_TYPES.filter(t => t !== 'shelve') }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下 shelve:demo:<F>
  await ui.press({ key: `shelve:demo:${F}` })

  // Then: 有一条 toast 同时含「不认识 shelve」与「未搁置」；没有写账本的 git 调用；批准带仍有 approve:demo:<F>
  expect(log.toasts.some(t => t.includes('不认识 shelve') && t.includes('未搁置'))).toBe(true)
  expect(writes(log)).toEqual([])
  expect(await ui.find({ key: `approve:demo:${F}` })).toBeDefined()
})

test('band-reads-ledger-with-main-judges', async ($, on) => {
  // Given: 主 worktree /repo（main）的 /repo/template/.claude/hooks 有 plan_fp.py 与 ledger.py；/repo/.worktrees/demo（worktree-demo）有未完成的 demo，自带 template/.claude/hooks 的 plan_fp.py 与 ledger.py
  const OWN = '/repo/.worktrees/demo'
  const OWN_HOOKS = `${OWN}/template/.claude/hooks`
  const log = useWorld(on, {
    worktrees: porcelain([
      [MAIN, 'main'],
      [OWN, 'worktree-demo'],
    ]),
    dirs: { [`${OWN}/template/openspec/changes`]: ['demo'] },
    files: {
      [`${HOOKS}/plan_fp.py`]: '',
      [`${HOOKS}/ledger.py`]: '',
      [`${OWN}/template/openspec/changes/demo/spec.html`]: '<html></html>',
      [`${OWN}/template/openspec/changes/demo/tasks.md`]: '- [ ] 1.1 写代码\n',
      [`${OWN_HOOKS}/plan_fp.py`]: '',
      [`${OWN_HOOKS}/ledger.py`]: '',
    },
    fp: () => F,
  })

  // When: 会话启动（刷新批准带）
  await $.session.start(START)

  // Then: ledger.py 的脚本路径只有 /repo/template/.claude/hooks/ledger.py；plan_fp.py 的脚本路径只有 worktree 自带的 /repo/.worktrees/demo/template/.claude/hooks/plan_fp.py
  expect([...new Set(log.ledgerScripts)]).toEqual([`${HOOKS}/ledger.py`])
  expect([...new Set(log.fpScripts)]).toEqual([`${OWN_HOOKS}/plan_fp.py`])
})

test('band-lists-artifact-paths', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F；git status 列出 7 个未跟踪工件 template/openspec/changes/demo/f1.md … f7.md
  const status = [1, 2, 3, 4, 5, 6, 7].map(i => `?? template/openspec/changes/demo/f${i}.md\n`).join('')
  useWorld(on, demoWorld(() => F, { status }))

  // When: 会话启动（刷新批准带）后绘制
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // Then: 有含「提交本 change 的 7 个工件」的说明行；f1.md 至 f5.md 各恰有一行文字；有一行文字为「…另 2 个」；没有含 f6.md 或 f7.md 的文字
  expect(await ui.find({ text: /提交本 change 的 7 个工件/ })).toBeDefined()
  expect(await Promise.all([1, 2, 3, 4, 5].map(async i => (await ui.findAll({ type: 'Text', text: new RegExp(`f${i}\\.md`) })).length))).toEqual([1, 1, 1, 1, 1])
  expect(await ui.find({ text: /^…另 2 个$/ })).toBeDefined()
  expect(await ui.findAll({ text: /f6\.md|f7\.md/ })).toHaveLength(0)
})

// ---------------------------------------------------------------- flight-dispatch-followups S2：入口同步登记、去重续飞、基线进度行

test('rapid-second-press-refused', async ($, on) => {
  // Given: demo 未批准（账本为空），当前指纹 F；批准带已显示 demo 的「批准起飞」之后，plan_fp.py 要等 release() 之后才作答；
  //        已按下 approve:demo:<F>（先不 await），并等到 plan_fp.py 已因这次按键被调用（尚未作答）
  let release: () => void = () => undefined
  const world = demoWorld(() => F)
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.fpWait = new Promise<void>(r => (release = r))
  const base = log.fpDirs.length
  const first = ui.press({ key: `approve:demo:${F}` })
  await until(() => log.fpDirs.length === base + 1)

  // When: 第一次按键尚未返回时再按一次 approve:demo:<F>，至多等 1 秒看它是否返回，记下此时 plan_fp.py 的调用次数；随后放行、等两次按键都返回（期间都不推进时钟）
  const secondPress = ui.press({ key: `approve:demo:${F}` })
  const second = await Promise.race([secondPress.then(() => 'returned'), new Promise<string>(r => setTimeout(() => r('pending'), 1000))])
  const fpByPress = log.fpDirs.length - base
  release()
  await first
  await secondPress

  // Then: 第二次按键在放行前已返回；有一条 toast 含「flight：demo 正在起飞」；放行前 plan_fp.py 只因按键运行一次；账本只追加一条 approve；起飞守卫只以 demo 运行一次
  expect(second).toBe('returned')
  expect(log.toasts.some(t => t.includes('flight：demo 正在起飞'))).toBe(true)
  expect(fpByPress).toBe(1)
  expect(log.git.filter(c => c.args[0] === 'hash-object')).toHaveLength(1)
  expect(log.gates).toEqual(['demo'])
})

test('replan-duplicate-resumes', async ($, on) => {
  // Given: alpha 已停飞、计划改过（当前 G、最近批准 F），批准带显示 alpha 的「批准修订并续飞」；按下前账本在 halt 之后追加了一条指纹 G 的 approve（之后没有 takeoff）；slice-gate.py baseline 立即以 exit 0 作答
  const world = haltWorld(['alpha'])
  world.baseline = { exitCode: 0, stdout: JSON.stringify({ ok: true, reasons: [] }) }
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  world.ledgers!.alpha = [...haltedLedger('alpha'), attemptEvent('alpha', 'approve', '10:40:00', { attempt: undefined, fp: G })]

  // When: 按下 replan:alpha:<G> 并等这次按键处理返回
  await ui.press({ key: `replan:alpha:${G}` })

  // Then: 有一条 toast 含「flight：alpha 已批准（指纹相同），直接续飞」；基线恰对 alpha 运行一次；起飞守卫恰以 alpha 运行一次
  expect(log.toasts.some(t => t.includes('flight：alpha 已批准（指纹相同），直接续飞'))).toBe(true)
  expect(log.baselines).toEqual([`${CHANGES}/alpha`])
  expect(log.gates).toEqual(['alpha'])
})

test('other-baseline-line-kept', async ($, on) => {
  // Given: alpha、beta 都已停飞（最近批准都为 F）；beta 计划改过（当前 G），alpha 计划未改（当前 F）；slice-gate.py baseline 要等 release() 之后才作答；
  //        批准带显示 beta 的「批准修订并续飞」；已按下 replan:beta:<G>（先不 await），并等到 beta 的基线已启动（处于基线相位）；随后 alpha 成为最新一项、批准带重绘为 alpha 的「续飞」
  let release: () => void = () => undefined
  const world = haltWorld(['alpha', 'beta'])
  world.fp = (_, dir) => (dir.endsWith('/beta') ? G : F)
  world.baselineWait = new Promise<void>(r => (release = r))
  newestIs(world, 'beta')
  const log = useWorld(on, world)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })
  const beta = ui.press({ key: `replan:beta:${G}` })
  await until(() => log.baselines.length === 1)
  newestIs(world, 'alpha')
  await $.turn.complete(TURN)

  // When: 按下 resume:alpha:<F> 并等它返回，记下此时最后一次状态行；随后放行 beta 的基线、等 beta 的按键返回（收尾）
  await ui.press({ key: `resume:alpha:${F}` })
  const last = log.statuses.at(-1) ?? ''
  release()
  await beta

  // Then: alpha 续飞返回时最后一次状态行含「续飞准备中 beta」
  expect(last).toContain('续飞准备中 beta')
})
