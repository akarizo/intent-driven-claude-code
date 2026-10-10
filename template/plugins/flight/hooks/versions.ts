// 起飞前的版本核对（spec flight-version-check）：插件副本是否为已安装版本、判定器是否认识全部事件。
// 纯函数：只经 Io 读文件与跑命令，不碰 $，不 import claude-code 的运行时值。接线在起飞处（S7）。
import type { Io } from './core'
import { normalizePath } from './envelope'

export type VersionCheck = { ok: true; line: string } | { ok: false; reason: string }

type Entry = { scope?: unknown; projectPath?: unknown; installPath?: unknown; version?: unknown }

const UPDATE_MAIN = '先把主检出更新到与插件同一版本'

/** p 在 dir 之下（不含 dir 本身）；两者都已规范化 */
const under = (dir: string, p: string) => p.startsWith(dir + '/')

async function loadedVersion(io: Io, pluginRoot: string): Promise<string> {
  try {
    const v = JSON.parse((await io.read(`${pluginRoot}/.claude-plugin/plugin.json`)) ?? '').version
    return typeof v === 'string' && v !== '' ? v : '未知'
  } catch {
    return '未知'
  }
}

/** installed_plugins.json 的格式无文档，按本机实测（2.1.295）：plugins 的键为 `<name>@<marketplace>`，值为条目数组 */
function pickEntry(data: unknown, mainTree: string): Entry | undefined {
  const plugins = (data as { plugins?: unknown } | null)?.plugins
  if (typeof plugins !== 'object' || plugins === null) return undefined
  const entries: Entry[] = Object.entries(plugins)
    .filter(([k, v]) => k.startsWith('flight@') && Array.isArray(v))
    .flatMap(([, v]) => (v as unknown[]).filter((e): e is Entry => typeof e === 'object' && e !== null))
  const main = normalizePath(mainTree)
  return (
    entries.find(e => e.scope === 'project' && typeof e.projectPath === 'string' && normalizePath(e.projectPath) === main) ??
    entries.find(e => e.scope === 'user')
  )
}

export async function checkPluginCopy(io: Io, x: { pluginRoot: string; configDir: string; mainTree: string }): Promise<VersionCheck> {
  const loaded = await loadedVersion(io, x.pluginRoot)
  const unverified = (why: string): VersionCheck => ({ ok: true, line: `插件 ${loaded}（已安装版本未核对：${why}）` })

  const text = await io.read(`${x.configDir}/plugins/installed_plugins.json`)
  if (text === undefined) return unverified('无 installed_plugins.json')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return unverified('installed_plugins.json 无法解析')
  }
  const entry = pickEntry(data, x.mainTree)
  if (entry === undefined) return unverified('没有 flight 的安装记录')

  const cache = normalizePath(`${x.configDir}/plugins/cache`)
  const root = normalizePath(x.pluginRoot)
  if (!under(cache, root)) return unverified(`本会话加载的不是安装副本（${x.pluginRoot}）`)
  if (typeof entry.installPath !== 'string' || !under(cache, normalizePath(entry.installPath))) return unverified('安装记录不在缓存下')

  const install = normalizePath(entry.installPath)
  if (install === root) return { ok: true, line: `插件 ${loaded}` }
  const installed = typeof entry.version === 'string' && entry.version !== '' ? entry.version : '未知'
  return { ok: false, reason: `flight：已安装 flight ${installed}（${install}），本会话加载的是 ${loaded}（${root}）：先运行 /reload-plugins 再起飞` }
}

export async function checkJudges(io: Io, x: { hooksDir: string; required: readonly string[] }): Promise<VersionCheck> {
  const r = await io.run(['python3', `${x.hooksDir}/ledger.py`, 'events'])
  if (r.exitCode !== 0) return { ok: false, reason: `flight：判定器过旧（${x.hooksDir}/ledger.py 没有 events 子命令）：${UPDATE_MAIN}` }
  const known = new Set(r.stdout.split('\n').map(s => s.trim()).filter(Boolean))
  const missing = x.required.filter(e => !known.has(e))
  if (missing.length > 0) return { ok: false, reason: `flight：判定器（${x.hooksDir}）不认识事件 ${missing.join('，')}：${UPDATE_MAIN}` }
  return { ok: true, line: '' }
}
