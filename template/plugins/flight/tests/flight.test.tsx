import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

/** 主 worktree 里有一个待批准的 change demo（tasks 未完成、账本无批准）。 */
function demoWorld(fp: World['fp'], extra: Partial<World> = {}): World {
  return {
    worktrees: porcelain([[MAIN, 'main']]),
    dirs: { [CHANGES]: ['demo', 'archive'] },
    files: {
      [`${DEMO}/spec.html`]: '<html></html>',
      [`${DEMO}/tasks.md`]: '- [ ] 1.1 写代码\n',
      [`${HOOKS}/plan_fp.py`]: '',
      [`${HOOKS}/ledger.py`]: '',
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
  }
  let fpCalls = 0
  let updateRefCalls = 0
  let lastEvent = ''
  mock.clock(on, { now: Date.UTC(2026, 9, 9, 12, 0, 0) })
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
  on('fs.exists', ($, e) => ({ value: e.path in w.files || e.path in w.dirs }))
  on('fs.list', ($, e) => ({
    value: (w.dirs[e.path] ?? []).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file' as const, size: 1, mtimeMs: w.mtimes?.[e.path] ?? 1000, isLink: false } }))
  on('fs.read', ($, e) => ({ value: w.files[e.path] ?? '' }))
  on('process.run', ($, e) => {
    const [cmd, ...args] = e.argv
    if (cmd === 'python3' && args[0]?.endsWith('/plan_fp.py')) {
      log.fpDirs.push(String(args[2]))
      return ok(w.fp(fpCalls++, String(args[2])) + '\n')
    }
    if (cmd === 'python3' && args[0]?.endsWith('/ledger.py')) return ok(log.approved + '\n')
    if (cmd === 'git' && args.includes('worktree')) return ok(w.worktrees)
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
        log.approved = JSON.parse(lastEvent).fp
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

  // When: 按下「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: 写命令依次为 hash-object、mktree、commit-tree、update-ref refs/flight/demo/ledger <新> 40 个 0；事件 ev=approve、fp=F、by.plugin=flight、by.surface=terminal、by.session=sess-1；输入框预填 /opsx-apply demo
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
  expect(log.fills).toEqual(['/opsx-apply demo'])
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

  // Then: 旧按钮的按压没有落到 zeta 上（未写账本）；按下 zeta 自己的按钮才写入 zeta 与 G
  expect(stale).toBe('missed')
  expect(writesAfterStale).toEqual([])
  expect(JSON.parse(String(log.git.find(c => c.args[0] === 'hash-object')?.stdin))).toMatchObject({ change: 'zeta', fp: G })
  expect(log.fills).toEqual(['/opsx-apply zeta'])
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

test('ledger-append-retries-on-conflict', async ($, on) => {
  // Given: 批准带显示 demo 与指纹 F；第 1 次 update-ref 旧值不符失败，第 2 次成功（此时 rev-parse 读到链尾 dddd…）
  const log = useWorld(on, demoWorld(() => F, { updateRefFailures: 1 }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'flight', surface: 'terminal', ...BAND })

  // When: 按下「批准起飞」
  await ui.press({ key: `approve:demo:${F}` })

  // Then: update-ref 共 2 次，第 2 次以重读到的链尾 dddd… 为旧值；输入框预填 /opsx-apply demo
  const updates = log.git.filter(c => c.args[0] === 'update-ref')
  expect(updates).toHaveLength(2)
  expect(updates[1]?.args[3]).toBe('d'.repeat(40))
  expect(log.fills).toEqual(['/opsx-apply demo'])
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

  // Then: 插件确实处理了启动（读过会话版本），且没有注册任何工具、也没有注册任何命令
  expect(log.versionReads).toBeGreaterThan(0)
  expect(log.tools).toEqual([])
  expect(log.commands).toEqual([])
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
