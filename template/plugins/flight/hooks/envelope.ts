// 能力包络的纯策略（design D5、D6、D8、D9）。全部是纯函数：不碰 $，不 import claude-code 的运行时值；
// 运行环境没有 Node，路径规范化与 glob 匹配自己实现。接线在 register.tsx（S6）。
import type { Role } from './core'

/** owns：执行体为本片；fixer / resolver 为全部切片的并集 */
export type Who = { role: Role; worktree: string; owns: readonly string[] }
/** slicePrefix = `<主 worktree>/.claude/worktrees/flight-<change>-` */
export type ActiveTree = { change: string; changeTree: string; slicePrefix: string }
export type Deny = { deny: string }

const ROLE_NAME: Record<Role, string> = { executor: '执行体', fixer: '修复体', resolver: '解冲突 agent', reviewer: '评审员' }

/** D6 拒绝表：移动 ref、改写历史或改动共享状态的 git 子命令 */
const DENY_SUBS = new Set([
  'push', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'worktree', 'update-ref', 'symbolic-ref',
  'stash', 'tag', 'cherry-pick', 'revert', 'clean', 'filter-branch', 'replace', 'notes',
])
const REVIEWER_EXTRA = ['add', 'commit', 'rm', 'mv', 'apply', 'am']
const MAIN_EXTRA = [...REVIEWER_EXTRA, 'restore']
const READONLY_SUBS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame', 'grep'])
const GIT_OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path'])

/** 绝对 posix 路径去掉 `.`、`..`、重复的 `/`；`..` 不越过根 */
export function normalizePath(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/')
}

/** Python fnmatch.fnmatchcase 的翻译：`*` 可跨 `/`，`?` 恰一字符，`[seq]` / `[!seq]` 字符类 */
function fnmatchRegex(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') re += '.*'
    else if (c === '?') re += '.'
    else if (c === '[') {
      let j = i + 1
      if (pattern[j] === '!') j++
      if (pattern[j] === ']') j++
      while (j < pattern.length && pattern[j] !== ']') j++
      if (j >= pattern.length) re += '\\['
      else {
        let body = pattern.slice(i + 1, j).replace(/\\/g, '\\\\')
        if (body.startsWith('!')) body = '^' + body.slice(1)
        else if (body.startsWith('^')) body = '\\' + body
        re += `[${body}]`
        i = j
      }
    } else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  return new RegExp(`^(?:${re})$`, 's')
}

/** 与 slice-gate.py 的 glob_match 同语义：精确 / fnmatch / `dir/**` 前缀 */
export function globMatch(path: string, pattern: string): boolean {
  if (path === pattern || fnmatchRegex(pattern).test(path)) return true
  return pattern.endsWith('/**') && path.startsWith(pattern.slice(0, -3) + '/')
}

/** Write、Edit 取 file_path；NotebookEdit 取 notebook_path；其他工具返回 undefined */
export function writeTarget(tool: string, input: unknown): string | undefined {
  const key = tool === 'Write' || tool === 'Edit' ? 'file_path' : tool === 'NotebookEdit' ? 'notebook_path' : undefined
  if (!key || typeof input !== 'object' || input === null) return undefined
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

function within(root: string, p: string): boolean {
  return p === root || p.startsWith(root.endsWith('/') ? root : root + '/')
}

export function writeVerdict(who: Who, absPath: string): Deny | undefined {
  const name = ROLE_NAME[who.role]
  const p = normalizePath(absPath)
  if (who.role === 'reviewer') return { deny: `评审员不可写入任何文件（不在任何 owns 内）：${p}` }
  const wt = normalizePath(who.worktree)
  if (!within(wt, p)) return { deny: `${name}只能写自己 worktree（${wt}）内、匹配 owns 的路径；越界：${p}` }
  const rel = p.slice(wt.length).replace(/^\/+/, '')
  if (who.owns.some(o => globMatch(rel, o))) return undefined
  return { deny: `${name}只能写匹配 owns 的路径；越界：${rel}（owns：${who.owns.join('、')}）` }
}

type GitCall = { sub: string; args: string[]; globals: string[] }

/**
 * 按 `&&`、`||`、`;`、`|`、`&`、换行与 `(`、`)`、反引号切段（宁可多切：多出的段只会多拒，不会漏拒）。
 * ceiling: 不解析引号，引号内的分隔符也会切段 -> 误拒出现时再换成真正的 shell 词法分析。
 */
function denySegments(command: string): string[] {
  return command.replace(/\d*>&\d+/g, ' ').split(/&&|\|\||[;|&\n()`]/)
}

/** 段内跳过前导 `VAR=val` 与 git 全局选项，取出子命令；不是 git 调用返回 undefined */
function parseGit(segment: string): GitCall | undefined {
  const toks = segment.trim().replace(/^[{!]\s*/, '').split(/\s+/).filter(Boolean)
  let i = 0
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++
  const head = (toks[i] ?? '').replace(/^["']|["']$/g, '')
  if (head !== 'git' && !head.endsWith('/git')) return undefined
  i++
  const globals: string[] = []
  while (i < toks.length && toks[i].startsWith('-')) {
    const t = toks[i++]
    globals.push(t)
    if (GIT_OPTS_WITH_ARG.has(t) && i < toks.length) globals.push(toks[i++])
  }
  if (i >= toks.length) return undefined
  return { sub: toks[i], args: toks.slice(i + 1), globals }
}

/** 短选项簇（如 `-Df`）是否含某字母，或长选项（可缩写，至少到 minLen 个字符）命中 */
function hasOpt(args: readonly string[], shorts: string, longs: readonly string[], minLen = 4): boolean {
  return args.some(a => {
    if (/^-[A-Za-z]+$/.test(a)) return [...a.slice(1)].some(ch => shorts.includes(ch))
    const opt = a.split('=')[0]
    return opt.startsWith('--') && opt.length >= minLen && longs.some(l => l.startsWith(opt))
  })
}

/** 该 git 调用是否落入拒绝表（D6；extra 为角色或主会话追加的子命令），返回描述 */
function dangerOf(g: GitCall, extra: readonly string[]): string | undefined {
  if (DENY_SUBS.has(g.sub) || extra.includes(g.sub)) return `git ${g.sub}`
  if (g.sub === 'branch' && hasOpt(g.args, 'dDmMfcC', ['--delete', '--move', '--copy', '--force'])) return 'git branch 的删改选项'
  if (g.sub === 'commit' && hasOpt(g.args, 'n', ['--amend', '--no-verify'], 5)) return 'git commit --amend / --no-verify'
  return undefined
}

export function bashVerdict(role: Role, command: string): Deny | undefined {
  const name = ROLE_NAME[role]
  if (command.includes('refs/flight/')) return { deny: `${name}不得触及 refs/flight/（账本与门禁结论只由 flight 插件写入）` }
  const extra = role === 'reviewer' ? REVIEWER_EXTRA : []
  for (const seg of denySegments(command)) {
    const g = parseGit(seg)
    const d = g && dangerOf(g, extra)
    if (d) return { deny: `${name}不得执行 ${d}（移动 ref、改写历史或改动共享状态；评审员只读）` }
  }
  return undefined
}

/** commands = 门禁 test / lint / typecheck 与各片 verify 中非空的 */
export function bashUpgradable(role: Role, command: string, commands: readonly string[]): boolean {
  if (bashVerdict(role, command)) return false
  const c = command.replace(/2>&1/g, ' ')
  if (c.includes('$(') || /[`<>]/.test(c) || c.replace(/&&/g, '').includes('&')) return false
  const cmds = commands.map(x => x.trim()).filter(Boolean)
  const segs = c.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean)
  if (segs.length === 0) return false
  return segs.every(seg => {
    // 门禁 / verify 命令本身，或其后接空格的追加参数、`::` 的 pytest 节点选择
    if (cmds.some(x => seg === x || seg.startsWith(x + ' ') || seg.startsWith(x + '::'))) return true
    const g = parseGit(seg)
    if (!g) return false
    // ceiling: 只读子命令里能写文件 / 起进程的选项按黑名单挡（-c、--output、-O） -> 发现新的副作用选项时补进来
    if (g.globals.some(t => t === '-c' || t.startsWith('--config-env') || t.startsWith('--exec-path'))) return false
    if (g.args.some(a => a.startsWith('--output') || a.startsWith('-O') || a.startsWith('--open-files-in-pager'))) return false
    if (READONLY_SUBS.has(g.sub)) return true
    return (role === 'executor' || role === 'fixer') && (g.sub === 'add' || g.sub === 'commit')
  })
}

/** 主会话（无 agentId）对在飞树只读（D8，尽力而为） */
export function mainSessionVerdict(active: readonly ActiveTree[], tool: string, input: unknown): Deny | undefined {
  const target = writeTarget(tool, input)
  if (target !== undefined) {
    const p = normalizePath(target)
    const hit = active.find(a => within(normalizePath(a.changeTree), p) || p.startsWith(a.slicePrefix))
    return hit && { deny: `飞行中，主会话对 ${hit.change} 只读；等落地或停飞：${p}` }
  }
  if (tool !== 'Bash' || typeof input !== 'object' || input === null) return undefined
  const command = (input as Record<string, unknown>).command
  if (typeof command !== 'string') return undefined
  // ceiling: 路径按子串匹配，同前缀的兄弟目录也会被认作在飞树 -> 误拒出现时改为带边界的匹配
  const hit = active.find(a => command.includes(a.changeTree) || command.includes(a.slicePrefix))
  if (!hit) return undefined
  const redirect = command.replace(/\d*>\s*\/dev\/null|\d*>&\d+/g, ' ').includes('>')
  const mutating = denySegments(command).some(seg => {
    const g = parseGit(seg)
    return g !== undefined && dangerOf(g, MAIN_EXTRA) !== undefined
  })
  if (!redirect && !mutating) return undefined
  return { deny: `飞行中，主会话对 ${hit.change} 只读；等落地或停飞（命令含在飞树路径且${mutating ? '含改动类 git 子命令' : '含 > 重定向'}）` }
}

/** agent.spawn 守卫（D9） */
export function spawnVerdict(x: { subagentType: string; originPlugin: string | undefined; model: string | undefined; parentInFlight: boolean }): Deny | undefined {
  if (x.subagentType.startsWith('flight:')) {
    if (x.originPlugin !== 'flight') return { deny: 'flight:* 只能由 flight 控制面派发' }
    if (!x.model?.trim()) return { deny: '派发须显式指定 model（铁律 11）' }
  }
  // 插件自己的派发发生在飞行 agent 收口 / turn.complete 的帧里，父 agent 可能就是刚结束的那个：只拦非插件来源
  if (x.parentInFlight && x.originPlugin !== 'flight') return { deny: '飞行中的 agent 不得再派发子 agent' }
  return undefined
}
