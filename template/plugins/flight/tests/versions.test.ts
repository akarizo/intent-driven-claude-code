// scenario 来源：spec flight-version-check。versions.ts 只经 Io 读文件与跑命令，这里用假 Io：文件表 + 按 argv 返回预设结果。
import { expect, test } from 'claude-code/testing'
import { REQUIRED_FEATURES, checkJudges, checkPluginCopy } from '../hooks/versions'
import type { Io, RunResult } from '../hooks/core'

const CFG = '/home/u/.claude'
const CACHE = `${CFG}/plugins/cache`
const MAIN = '/repo'
const ROOT_040 = `${CACHE}/idd/flight/0.4.0`
const ROOT_032 = `${CACHE}/idd/flight/0.3.2`
const INSTALLED = `${CFG}/plugins/installed_plugins.json`
const HOOKS = '/repo/template/.claude/hooks'
/** slice-gate.py features 列出全部能力时的输出 */
const ALL_FEATURES = 'evidence-ledger-only\ng5-per-target\nguards\nship-ledger\nledger-records\n'

function fakeIo(files: Record<string, string>, respond: (argv: string[]) => Partial<RunResult> = () => ({})): Io {
  const fs = new Map(Object.entries(files))
  return {
    async run(argv) {
      return { exitCode: 0, stdout: '', stderr: '', ...respond([...argv]) }
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
}

const pluginJson = (root: string, version: string) => ({ [`${root}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'flight', version }) })
/** user 条目指向 0.3.0；project 条目（projectPath 带末尾 /）指向 projectInstall */
const installed = (projectInstall: string) =>
  JSON.stringify({
    version: 2,
    plugins: {
      'other@idd': [{ scope: 'project', projectPath: MAIN, installPath: `${CACHE}/idd/other/9.9.9`, version: '9.9.9' }],
      'flight@idd': [
        { scope: 'user', installPath: `${CACHE}/idd/flight/0.3.0`, version: '0.3.0' },
        { scope: 'project', projectPath: `${MAIN}/`, installPath: projectInstall, version: projectInstall.split('/').filter(Boolean).pop() },
      ],
    },
  })

test('loaded-matches-installed', async () => {
  // Given: 加载目录为 0.4.0 的缓存目录（plugin.json version=0.4.0）；flight 的 project 条目 projectPath=/repo/、installPath 为同一目录加末尾 /；另有 user 条目指向 0.3.0
  const io = fakeIo({ ...pluginJson(ROOT_040, '0.4.0'), [INSTALLED]: installed(`${ROOT_040}/`) })

  // When: 核对插件副本
  const r = await checkPluginCopy(io, { pluginRoot: ROOT_040, configDir: CFG, mainTree: MAIN })

  // Then: 通过，文本恰为「插件 0.4.0」（不含「未核对」）
  expect(r).toEqual({ ok: true, line: '插件 0.4.0' })
})

test('loaded-differs-from-installed', async () => {
  // Given: 加载目录为 0.3.2 的缓存目录（plugin.json version=0.3.2）；flight 的 project 条目指向 0.4.0 的缓存目录
  const io = fakeIo({ ...pluginJson(ROOT_032, '0.3.2'), [INSTALLED]: installed(ROOT_040) })

  // When: 核对插件副本
  const r = await checkPluginCopy(io, { pluginRoot: ROOT_032, configDir: CFG, mainTree: MAIN })

  // Then: 拒飞，理由列出已安装 0.4.0 及其路径、加载的 0.3.2 及其路径，并要求先 /reload-plugins
  expect(r).toEqual({
    ok: false,
    reason: `flight：已安装 flight 0.4.0（${ROOT_040}），本会话加载的是 0.3.2（${ROOT_032}）：先运行 /reload-plugins 再起飞`,
  })
})

test('installed-unverifiable-noted', async () => {
  // Given: 五种情形，加载目录均为 0.4.0：①无 installed_plugins.json ②JSON 损坏（"{oops"）③只有 other@idd 条目、没有 flight 条目
  //        ④加载目录为 /dev/flight（不在缓存下，且无 plugin.json → 版本未知）⑤project 条目 installPath=/opt/flight（不在缓存下）
  const onlyOther = JSON.stringify({ version: 2, plugins: { 'other@idd': [{ scope: 'user', installPath: `${CACHE}/idd/other/1.0.0`, version: '1.0.0' }] } })
  const cases: Array<{ files: Record<string, string>; root: string }> = [
    { files: pluginJson(ROOT_040, '0.4.0'), root: ROOT_040 },
    { files: { ...pluginJson(ROOT_040, '0.4.0'), [INSTALLED]: '{oops' }, root: ROOT_040 },
    { files: { ...pluginJson(ROOT_040, '0.4.0'), [INSTALLED]: onlyOther }, root: ROOT_040 },
    { files: { [INSTALLED]: installed(ROOT_040) }, root: '/dev/flight' },
    { files: { ...pluginJson(ROOT_040, '0.4.0'), [INSTALLED]: installed('/opt/flight') }, root: ROOT_040 },
  ]

  // When: 分别核对插件副本
  const rs = await Promise.all(cases.map(c => checkPluginCopy(fakeIo(c.files), { pluginRoot: c.root, configDir: CFG, mainTree: MAIN })))

  // Then: 都通过，文本依次为「插件 <版本>（已安装版本未核对：<各自原因>）」
  expect(rs).toEqual([
    { ok: true, line: '插件 0.4.0（已安装版本未核对：无 installed_plugins.json）' },
    { ok: true, line: '插件 0.4.0（已安装版本未核对：installed_plugins.json 无法解析）' },
    { ok: true, line: '插件 0.4.0（已安装版本未核对：没有 flight 的安装记录）' },
    { ok: true, line: '插件 未知（已安装版本未核对：本会话加载的不是安装副本（/dev/flight））' },
    { ok: true, line: '插件 0.4.0（已安装版本未核对：安装记录不在缓存下）' },
  ])
})

test('judges-must-know-events', async () => {
  // Given: 需要事件 approve、measure；ledger.py events 的三种应答：①输出 approve 与 measure ②只输出 approve ③退出码 2；slice-gate.py features 一律列全四项能力
  const required = ['approve', 'measure'] as const
  const answers: Array<Partial<RunResult>> = [{ stdout: 'approve\nmeasure\n' }, { stdout: 'approve\n' }, { exitCode: 2, stderr: 'invalid choice' }]
  const calls: string[][] = []
  const ioOf = (a: Partial<RunResult>) =>
    fakeIo({}, argv => {
      if (argv[2] === 'features') return { stdout: ALL_FEATURES }
      calls.push(argv)
      return a
    })

  // When: 分别核对判定器
  const rs = await Promise.all(answers.map(a => checkJudges(ioOf(a), { hooksDir: HOOKS, required })))

  // Then: 每次都运行 python3 <hooks>/ledger.py events；第一种通过；第二种拒飞且点名 measure 与主检出；第三种拒飞且说明判定器过旧
  expect(calls).toEqual(answers.map(() => ['python3', `${HOOKS}/ledger.py`, 'events']))
  expect(rs).toEqual([
    { ok: true, line: '' },
    { ok: false, reason: `flight：判定器（${HOOKS}）不认识事件 measure：先把主检出更新到与插件同一版本` },
    { ok: false, reason: `flight：判定器过旧（${HOOKS}/ledger.py 没有 events 子命令）：先把主检出更新到与插件同一版本` },
  ])
})

test('takeoff-refuses-stale-judges', async () => {
  // Given: 三个判定器目录 /j1、/j2、/j3，ledger.py events 都输出 approve 与 measure；slice-gate.py features 的应答：
  //        /j1 以 2 退出（invalid choice）/ /j2 只输出 evidence-ledger-only / /j3 输出全部能力
  const features: Record<string, Partial<RunResult>> = {
    '/j1': { exitCode: 2, stderr: 'invalid choice' },
    '/j2': { stdout: 'evidence-ledger-only\n' },
    '/j3': { stdout: ALL_FEATURES },
  }
  const io = fakeIo({}, argv => {
    const dir = argv[1].slice(0, argv[1].lastIndexOf('/'))
    return argv[2] === 'features' ? features[dir] : { stdout: 'approve\nmeasure\n' }
  })

  // When: 分别对三个目录运行 checkJudges（需要事件 approve、measure）
  const rs = await Promise.all(['/j1', '/j2', '/j3'].map(hooksDir => checkJudges(io, { hooksDir, required: ['approve', 'measure'] })))

  // Then: /j1 拒飞且原因说明判定器过旧并提示更新主检出；/j2 拒飞且原因列出 g5-per-target、guards、ship-ledger、ledger-records 并提示更新主检出；/j3 通过
  expect(rs).toEqual([
    { ok: false, reason: 'flight：判定器过旧（/j1/slice-gate.py 没有 features 子命令）：先把主检出更新到与插件同一版本' },
    { ok: false, reason: 'flight：判定器（/j2）缺少能力 g5-per-target，guards，ship-ledger，ledger-records：先把主检出更新到与插件同一版本' },
    { ok: true, line: '' },
  ])
})

test('judges-need-ship-ledger', async () => {
  // Given: 判定器目录 /j4：ledger.py events 输出所需的 approve 与 measure；slice-gate.py features 只输出 evidence-ledger-only、g5-per-target、guards
  const io = fakeIo({}, argv => (argv[2] === 'features' ? { stdout: 'evidence-ledger-only\ng5-per-target\nguards\n' } : { stdout: 'approve\nmeasure\n' }))

  // When: 对 /j4 运行 checkJudges（需要事件 approve、measure）
  const r = await checkJudges(io, { hooksDir: '/j4', required: ['approve', 'measure'] })

  // Then: 拒飞，原因含「缺少能力 ship-ledger」与「先把主检出更新到与插件同一版本」
  expect(r).toEqual({ ok: false, reason: 'flight：判定器（/j4）缺少能力 ship-ledger，ledger-records：先把主检出更新到与插件同一版本' })
})

test('judges-need-ledger-records', async () => {
  // Given: 判定器目录 /j5：ledger.py events 输出所需的 approve 与 measure；slice-gate.py features 输出除 ledger-records 外的全部能力（evidence-ledger-only、g5-per-target、guards、ship-ledger）
  const io = fakeIo({}, argv => (argv[2] === 'features' ? { stdout: 'evidence-ledger-only\ng5-per-target\nguards\nship-ledger\n' } : { stdout: 'approve\nmeasure\n' }))

  // When: 对 /j5 运行 checkJudges（需要事件 approve、measure）
  const r = await checkJudges(io, { hooksDir: '/j5', required: ['approve', 'measure'] })

  // Then: 拒飞，原因恰为「缺少能力 ledger-records」并提示更新主检出；导出的 REQUIRED_FEATURES 含 ledger-records
  expect(r).toEqual({ ok: false, reason: 'flight：判定器（/j5）缺少能力 ledger-records：先把主检出更新到与插件同一版本' })
  expect(REQUIRED_FEATURES).toContain('ledger-records')
})
