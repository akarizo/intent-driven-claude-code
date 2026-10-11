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
  'stash', 'tag', 'cherry-pick', 'revert', 'clean', 'filter-branch', 'replace', 'notes', 'pull', 'fetch',
])
/** git remote 的只读用法（flight-envelope-gaps）：无参数，或第一个参数是其中之一；其余写共享 .git/config，拒绝 */
const REMOTE_READ = new Set(['-v', '--verbose', 'show', 'get-url'])
/**
 * 段首可剥掉的前缀命令及其已知选项（flight-envelope-gaps）：flags 不带参数；withArg 连同一个参数剥掉，长名也接受 `--opt=val`。
 * 不在表里的 `-` 选项一律判为无法判定。
 */
const PREFIX_OPTS: ReadonlyMap<string, { flags: readonly string[]; withArg: readonly string[] }> = new Map([
  ['builtin', { flags: [], withArg: [] }],
  ['command', { flags: ['-p', '-v', '-V'], withArg: [] }],
  ['exec', { flags: [], withArg: ['-a'] }],
  ['env', { flags: ['-i', '-0', '-v', '--ignore-environment', '--null', '--debug'], withArg: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string', '-P'] }],
])
/** 带 `-c` 时把其后文本当命令执行的 shell */
const SHELL_PROGS = new Set(['bash', 'sh', 'zsh'])
/** git config 的只读用法（flight-envelope-tightening D3）；其余用法一律拒绝 */
const CONFIG_READ = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l'])
/** 读标准输入会挂起的解释器（D3）：python、python3、python3.x、node、bash、sh、zsh、ruby、perl */
const STDIN_INTERPRETER = /^(python(3(\.\d+)?)?|node|bash|sh|zsh|ruby|perl)$/
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

/**
 * 段的词（按空白切）：去掉前导 `{`、`!`、`VAR=val`，以及 PREFIX_OPTS 里的前缀命令和其后的已知选项（带参数的连同参数）与 `VAR=val`。
 * hasEnv 标记剥掉过任何前缀（bashUpgradable 据此不免询问，故剥前缀只会更严）；envKeys 为剥掉的赋值键名；
 * chdir 为 `env -C` / `--chdir` 的参数（未去引号）；unknownOpt 为剥前缀时遇到的不认识选项（此时 toks 为空，调用方须拒绝）。
 * `env -S` / `--split-string` 的参数就是命令文本：去引号后接回词序列继续剥，而不是丢掉（丢掉会漏判其中的 git）。
 * ceiling: 选项按前缀命令查表，短选项簇（如 `env -iv`）与短选项粘参数（如 `-uFOO`）一律判为无法判定；`-S` 只去引号不做真正分词 -> 误拒或漏拒出现时补表或换 shell 词法分析。
 */
function words(segment: string): { toks: string[]; hasEnv: boolean; envKeys: string[]; chdir?: string; unknownOpt?: string } {
  let toks = segment.trim().replace(/^[{!]\s*/, '').split(/\s+/).filter(Boolean)
  const envKeys: string[] = []
  let chdir: string | undefined
  let prefix: { flags: readonly string[]; withArg: readonly string[] } | undefined
  let i = 0
  for (; i < toks.length; i++) {
    const t = toks[i]
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(t)
    if (m) {
      envKeys.push(m[1])
      continue
    }
    const p = PREFIX_OPTS.get(t)
    if (p) {
      prefix = p
      continue
    }
    if (!prefix || !t.startsWith('-')) break
    const eq = t.startsWith('--') ? t.indexOf('=') : -1
    const opt = eq < 0 ? t : t.slice(0, eq)
    const val = eq < 0 ? undefined : t.slice(eq + 1)
    if (val === undefined && prefix.flags.includes(opt)) continue
    if (!prefix.withArg.includes(opt)) return { toks: [], hasEnv: true, envKeys, unknownOpt: t }
    if (opt === '-S' || opt === '--split-string') {
      const rest = val === undefined ? toks.slice(i + 1) : [val, ...toks.slice(i + 1)]
      toks = [...toks.slice(0, i + 1), ...rest.map(x => x.replace(/^["']|["']$/g, ''))]
      continue
    }
    const arg = val ?? toks[++i] ?? ''
    if (opt === '-C' || opt === '--chdir') chdir = arg
  }
  return { toks: toks.slice(i), hasEnv: i > 0, envKeys, chdir }
}

/** 程序名（去引号后的 basename） */
function progName(toks: readonly string[]): string {
  return (toks[0] ?? '').replace(/^["']|["']$/g, '').split('/').pop() ?? ''
}

/**
 * `bash` / `sh` / `zsh` 带 `-c`（含 `-lc` 这类短选项簇）或 `eval` 段：返回其后的命令文本（去一层引号）；
 * 取不出（引号不配对，含被分段切开的情形）返回 null；不是这类段返回 undefined。
 * ceiling: 只认整段一层引号，不解析反斜杠转义与 `-c` 文本后的位置参数（多出的词让引号不配对而拒） -> 误拒或漏拒出现时换成 shell 词法分析。
 */
function innerCommand(toks: readonly string[]): string | null | undefined {
  const prog = progName(toks)
  let k = -1
  if (prog === 'eval') k = 0
  else if (SHELL_PROGS.has(prog)) k = toks.findIndex((t, i) => i > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(t))
  if (k < 0) return undefined
  const text = toks.slice(k + 1).join(' ')
  const q = text[0]
  if (q === "'" || q === '"') return text.length >= 2 && text.endsWith(q) ? unquote(text) : null
  return (text.split("'").length - 1) % 2 === 0 && (text.split('"').length - 1) % 2 === 0 ? text : null
}

/** 去掉一层单引号（`'\''` 还原为 `'`）或双引号 */
function unquote(s: string): string {
  const m = /^'(.*)'$/s.exec(s)
  return m ? m[1].replace(/'\\''/g, "'") : s.replace(/^"(.*)"$/s, '$1')
}

/**
 * 目录：string = 已知绝对路径；undefined = 未设定（视为自己的 worktree）；null = 无法判定。
 * 相对路径只在已有绝对基准时拼接，否则无法判定（D2）；`~`、`$`、`-`、`+` 开头一律无法判定（`+N` / `-N` 是目录栈旋转，不是路径）。
 */
function resolveDir(base: string | null | undefined, p: string): string | null {
  if (p.startsWith('/')) return normalizePath(p)
  if (p === '' || /^[~$+-]/.test(p) || typeof base !== 'string') return null
  return normalizePath(base + '/' + p)
}

/** `cd <路径>` 段返回其参数（未去引号）；不是 cd 段返回 undefined */
function cdArg(toks: readonly string[]): string | undefined {
  return toks[0] === 'cd' ? toks.slice(1).join(' ') : undefined
}

/**
 * cd / pushd 段的目录参数：至多一个参数（引号内的空格不算分隔）→ 该参数；多于一个 → null（无法判定）。
 * zsh 的 `cd old new` 是把 $PWD 里的 old 替换成 new，不是路径；带选项的写法（`cd -P x`）也按多参数宁可多拒。
 */
function dirArg(args: readonly string[]): string | null {
  const text = args.join(' ')
  return args.length <= 1 || /^'[^']*'$/.test(text) || /^"[^"]*"$/.test(text) ? text : null
}

/** D2：git 调用的全部作用目录（-C 逐级拼接后的目录，以及 --git-dir、--work-tree 指向的目录）；cwd 为前面 cd 设定的目录 */
function gitTargets(g: GitCall, cwd: string | null | undefined, worktree: string): (string | null)[] {
  let dir = cwd
  const extra: (string | null)[] = []
  for (let i = 0; i < g.globals.length; i++) {
    const t = g.globals[i]
    if (t === '-C') dir = resolveDir(dir, unquote(g.globals[++i] ?? ''))
    else if (t === '--git-dir' || t === '--work-tree') extra.push(resolveDir(dir, unquote(g.globals[++i] ?? '')))
    else if (t.startsWith('--git-dir=') || t.startsWith('--work-tree=')) extra.push(resolveDir(dir, unquote(t.slice(t.indexOf('=') + 1))))
  }
  return [dir === undefined ? normalizePath(worktree) : dir, ...extra]
}

/**
 * 程序名（basename）是读标准输入的解释器，且解释器自己的选项里有单独的 `-` 或 `-s`。
 * 只看脚本 / 模块之前的选项：`python3 -m pytest -s` 的 `-s` 属于 pytest，不拒。
 * ceiling: 不识别带参数的解释器选项（如 `python3 -W x -`）-> 出现漏拒时按解释器补选项表。
 */
function readsStdin(toks: readonly string[]): boolean {
  if (!STDIN_INTERPRETER.test(progName(toks))) return false
  for (const a of toks.slice(1)) {
    if (a === '-' || a === '-s') return true
    if (!a.startsWith('-') || ['-c', '-m', '-e', '-p', '--eval', '--print'].includes(a)) return false
  }
  return false
}

/** 全局 `-c` 与 `--config-env` 设置的配置键名（`=` 之前，小写） */
function configKeys(globals: readonly string[]): string[] {
  const keys: string[] = []
  for (let i = 0; i < globals.length; i++) {
    const t = globals[i]
    const v = t === '-c' || t === '--config-env' ? globals[++i] : t.startsWith('--config-env=') ? t.slice('--config-env='.length) : undefined
    if (v !== undefined) keys.push(unquote(v).split('=')[0].toLowerCase())
  }
  return keys
}

/** 段内跳过前导 `VAR=val` 与 git 全局选项，取出子命令；不是 git 调用返回 undefined */
function parseGit(segment: string): GitCall | undefined {
  const toks = words(segment).toks
  let i = 0
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

/** 短选项簇（如 `-Df`）是否含某字母，或长选项（可缩写，`--` 之后至少 1 个字符）命中 */
function hasOpt(args: readonly string[], shorts: string, longs: readonly string[]): boolean {
  return args.some(a => {
    if (/^-[A-Za-z]+$/.test(a)) return [...a.slice(1)].some(ch => shorts.includes(ch))
    const opt = a.split('=')[0]
    return opt.startsWith('--') && opt.length >= 3 && longs.some(l => l.startsWith(opt))
  })
}

/** 该 git 调用是否落入拒绝表（D6 + tightening D3；extra 为角色或主会话追加的子命令），返回描述 */
function dangerOf(g: GitCall, extra: readonly string[]): string | undefined {
  if (DENY_SUBS.has(g.sub) || extra.includes(g.sub)) return `git ${g.sub}`
  if (configKeys(g.globals).includes('core.hookspath')) return 'git -c / --config-env core.hooksPath'
  // ceiling: 只要带一个只读选项就放行（`--list --add` 之类的混用不细分） -> 出现混用绕过时改为逐项校验
  if (g.sub === 'config' && !g.args.some(a => CONFIG_READ.has(a))) return 'git config 的写入用法'
  if (g.sub === 'remote' && g.args.length > 0 && !REMOTE_READ.has(g.args[0])) return 'git remote 的写入用法'
  if (g.sub === 'branch' && hasOpt(g.args, 'dDmMfcCu', ['--delete', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream', '--edit-description'])) {
    return 'git branch 的删改 / 上游 / 描述选项'
  }
  if (g.sub === 'commit' && hasOpt(g.args, 'n', ['--amend', '--no-verify'])) return 'git commit --amend / --no-verify'
  return undefined
}

/** D1：把命令固定在 worktree 里运行；已有同一前缀时原样返回 */
export function inWorktree(command: string, worktree: string): string {
  const prefix = `cd '${worktree.replace(/'/g, "'\\''")}' && `
  return command.startsWith(prefix) ? command : prefix + command
}

/**
 * worktree 给出时按 D2 检查改动类 git 的作用目录；只读子命令不查作用目录（主仓库内放行，树外交给引擎询问），
 * 故 mainTree 在这里不参与判定，只为与 bashUpgradable 同签名。
 */
export function bashVerdict(role: Role, command: string, worktree?: string, _mainTree?: string): Deny | undefined {
  const name = ROLE_NAME[role]
  if (command.includes('refs/flight/')) return { deny: `${name}不得触及 refs/flight/（账本与门禁结论只由 flight 插件写入）` }
  if (command.includes('<<')) return { deny: `${name}不得使用 heredoc（<<，会绕过写入包络）：改用 Write 工具写文件` }
  if (command.includes('/dev/stdin')) return { deny: `${name}不得让程序读标准输入（/dev/stdin 会挂起）：写成脚本文件再运行` }
  return segmentsVerdict(role, command, worktree, { cwd: undefined })
}

/**
 * bashVerdict 的逐段判定；state.cwd 为当前目录，逐段更新。`eval` 在当前 shell 执行，内层共用 state（其 cd 回传外层）；
 * `bash -c` 等跑在子进程，内层拿 state 的副本（其 cd 不影响外层）。inheritedEnv 为外层段首带进内层的 GIT_* 键名，
 * 与内层各段自己的键名合并后判定。`env -C <p>` 只对本段生效（按 `cd <p>` 解析，不回传后续各段）。
 */
function segmentsVerdict(
  role: Role,
  command: string,
  worktree: string | undefined,
  state: { cwd: string | null | undefined },
  inheritedEnv: readonly string[] = [],
): Deny | undefined {
  const name = ROLE_NAME[role]
  const extra = role === 'reviewer' ? REVIEWER_EXTRA : []
  const gitEnvDeny = (keys: readonly string[]) => ({ deny: `${name}不得用 GIT_* 环境变量（${keys.join('、')}）改变改动类 git 的作用对象` })
  for (const seg of denySegments(command)) {
    const { toks, envKeys, chdir, unknownOpt } = words(seg)
    if (unknownOpt !== undefined) return { deny: `${name}的前缀选项 ${unknownOpt} 无法判定（不在 env / exec / command 的已知选项表里）：去掉该选项或写成脚本文件再运行` }
    const ownGitEnv = envKeys.filter(k => k.startsWith('GIT_'))
    const gitEnv = [...inheritedEnv, ...ownGitEnv]
    if (toks[0] === 'cd' || toks[0] === 'pushd') {
      const p = dirArg(toks.slice(1))
      state.cwd = p === null ? null : resolveDir(state.cwd, unquote(p))
      continue
    }
    if (toks[0] === 'popd') {
      state.cwd = null
      continue
    }
    if (toks.length === 0 && ownGitEnv.length > 0) return gitEnvDeny(ownGitEnv)
    const cwd = chdir === undefined ? state.cwd : resolveDir(state.cwd, unquote(chdir))
    // ceiling: 只认 export（不认 declare -x / typeset -x / set -a） -> 出现漏拒时补进来
    const exported = toks[0] === 'export' ? toks.slice(1).filter(t => t.startsWith('GIT_')).map(t => t.split('=')[0]) : []
    if (exported.length > 0) return gitEnvDeny(exported)
    if (readsStdin(toks)) return { deny: `${name}不得让解释器读标准输入（单独的 - 或 -s 会挂起）：写成脚本文件再运行` }
    const inner = innerCommand(toks)
    if (inner === null) return { deny: `${name}的 -c / eval 命令文本无法判定（引号不配对或被 ;、|、& 等切开）：写成脚本文件再运行` }
    if (inner !== undefined) {
      const sub = progName(toks) === 'eval' && chdir === undefined ? state : { cwd }
      const d = segmentsVerdict(role, inner, worktree, sub, gitEnv)
      if (d) return d
      continue
    }
    const g = parseGit(seg)
    if (!g) continue
    const d = dangerOf(g, extra)
    if (d) return { deny: `${name}不得执行 ${d}（移动 ref、改写历史或改动共享状态；评审员只读）` }
    if (READONLY_SUBS.has(g.sub)) continue
    if (gitEnv.length > 0) return gitEnvDeny(gitEnv)
    if (worktree === undefined) continue
    const wt = normalizePath(worktree)
    const out = gitTargets(g, cwd, worktree).find(t => t === null || !within(wt, t))
    if (out !== undefined) return { deny: `${name}的改动类 git 只能作用于自己的 worktree（${wt}）；作用目录：${out ?? '无法判定（相对路径且无绝对基准）'}` }
  }
  return undefined
}

/** commands = 门禁 test / lint / typecheck 与各片 verify 中非空的；worktree / mainTree 给出时按 D4 检查 git 作用目录 */
export function bashUpgradable(role: Role, command: string, commands: readonly string[], worktree?: string, mainTree?: string): boolean {
  if (bashVerdict(role, command, worktree, mainTree)) return false
  const c = command.replace(/2>&1/g, ' ')
  if (c.includes('$(') || /[`<>]/.test(c) || c.replace(/&&/g, '').includes('&')) return false
  const cmds = commands.map(x => x.trim()).filter(Boolean)
  const segs = c.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean)
  if (segs.length === 0) return false
  let cwd: string | undefined
  return segs.every((seg, idx) => {
    const { toks, hasEnv } = words(seg)
    if (hasEnv) return false
    // D1 改写出的开头一段：cd 到的正是自己的 worktree
    const cd = cdArg(toks)
    if (idx === 0 && worktree !== undefined && cd !== undefined && resolveDir(undefined, unquote(cd)) === normalizePath(worktree)) {
      cwd = normalizePath(worktree)
      return true
    }
    // 门禁 / verify 命令本身，或其后接空格的追加参数、`::` 的 pytest 节点选择
    if (cmds.some(x => seg === x || seg.startsWith(x + ' ') || seg.startsWith(x + '::'))) return true
    const g = parseGit(seg)
    if (!g) return false
    // ceiling: 只读子命令里能写文件 / 起进程的选项按黑名单挡（-c、--output、-O） -> 发现新的副作用选项时补进来
    if (g.globals.some(t => t === '-c' || t.startsWith('--config-env') || t.startsWith('--exec-path'))) return false
    if (g.args.some(a => a.startsWith('--output') || a.startsWith('-O') || a.startsWith('--open-files-in-pager'))) return false
    const inside = (root: string | undefined) =>
      root === undefined || gitTargets(g, cwd, worktree ?? root).every(t => t !== null && within(normalizePath(root), t))
    if (READONLY_SUBS.has(g.sub)) return worktree === undefined || inside(mainTree)
    return (role === 'executor' || role === 'fixer') && (g.sub === 'add' || g.sub === 'commit') && inside(worktree)
  })
}

/** D5：Read 取 file_path，Grep / Glob 取 path（缺省为 worktree）；规范化后在 mainTree 内才免询问 */
export function readUpgradable(tool: string, input: unknown, worktree: string, mainTree: string): boolean {
  const key = tool === 'Read' ? 'file_path' : tool === 'Grep' || tool === 'Glob' ? 'path' : undefined
  if (!key || typeof input !== 'object' || input === null) return false
  const v = (input as Record<string, unknown>)[key]
  const target = typeof v === 'string' && v !== '' ? v : worktree
  if (target.startsWith('~')) return false
  const pattern = tool === 'Glob' ? (input as Record<string, unknown>).pattern : undefined
  if (typeof pattern === 'string' && (pattern.startsWith('/') || pattern.split('/').includes('..'))) return false
  return within(normalizePath(mainTree), normalizePath(target.startsWith('/') ? target : worktree + '/' + target))
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
