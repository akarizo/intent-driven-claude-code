// 合回、冲突交接与快进、findings 校验、落地收口的机械过程（spec flight-integration）。
// 只依赖 core.ts 的类型与 Io：不 import claude-code 的运行时值，不调用任何 $。git 一律 `git -C <worktree> ...`。
import type { Finding, Flight, GateJson, Io, RunResult, Severity } from './core'
import { globMatch } from './envelope'

export const RECORD_FILES = ['timeline.md', 'gate-report.md', 'evidence.log', 'slices/_interfaces.md'] // 相对 change 目录

const SEVERITIES: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const SIGNATURE = /^(def |class |export |func |pub )/
const INTERFACES = 'slices/_interfaces.md'

const git = (io: Io, tree: string, ...args: string[]) => io.run(['git', '-C', tree, ...args])
const judge = (io: Io, f: Flight, name: string, ...args: string[]) =>
  io.run(['python3', `${f.hooksDir}/${name}.py`, ...args], { cwd: f.changeTree })
const firstLine = (r: RunResult) => (r.stderr.trim() || r.stdout.trim()).split('\n')[0] ?? ''
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean)
const changePath = (f: Flight, rel: string) => `${f.changeTree}/${f.changeDir}/${rel}`
const resolvePath = (f: Flight, slice: string) => `${f.mainTree}/.claude/worktrees/flight-${f.change}-${slice}-resolve`
const resolveBranch = (f: Flight, slice: string) => `flight/${f.change}/${slice}-resolve`

/** change 目录下这些文件有未提交改动时只 add 它们并提交；返回错误信息，无错为 undefined。 */
export async function commitRecords(io: Io, f: Flight, message: string, extra: readonly string[] = []): Promise<string | undefined> {
  const rels = [...RECORD_FILES, ...extra].map(r => `${f.changeDir}/${r}`)
  const st = await git(io, f.changeTree, 'status', '--porcelain', '--untracked-files=all', '--', ...rels.map(r => `${f.changeTree}/${r}`))
  if (st.exitCode !== 0) return `git status 失败：${firstLine(st)}`
  // porcelain 的 XY 列可能以空格开头，不能先 trim
  const changed = new Set(st.stdout.split('\n').filter(l => l.length > 3).map(l => l.slice(3)))
  const paths = rels.filter(r => changed.has(r)).map(r => `${f.changeTree}/${r}`)
  if (!paths.length) return undefined
  const add = await git(io, f.changeTree, 'add', '--', ...paths)
  if (add.exitCode !== 0) return `git add 失败：${firstLine(add)}`
  const commit = await git(io, f.changeTree, 'commit', '-m', message, '--', ...paths)
  if (commit.exitCode !== 0) return `git commit 失败：${firstLine(commit)}`
  return undefined
}

/**
 * 未提交路径（相对 change worktree 根）的机械分类（design D2）：
 * records = 飞行记录；artifacts = change 目录下其余文件、同一 openspec 根下 adr/DRAFT-*.md、scenario 测试文件；others = 其余（含已编号 ADR、porcelain 改名行）。
 */
export function classifyDirty(paths: readonly string[], x: { changeDir: string; scenarioFiles: readonly string[] }): { records: string[]; artifacts: string[]; others: string[] } {
  const records = new Set(RECORD_FILES.map(r => `${x.changeDir}/${r}`))
  const adr = `${x.changeDir.replace(/\/changes\/[^/]+$/, '')}/adr/`
  const isDraft = (p: string) => p.startsWith(adr) && /^DRAFT-[^/]*\.md$/.test(p.slice(adr.length))
  const out = { records: [] as string[], artifacts: [] as string[], others: [] as string[] }
  for (const p of paths) {
    if (records.has(p)) out.records.push(p)
    else if (p.startsWith(`${x.changeDir}/`) || isDraft(p) || x.scenarioFiles.includes(p)) out.artifacts.push(p)
    else out.others.push(p)
  }
  return out
}

/** 只 add 并提交所列工件（相对 change worktree 根，pathspec 限定）；返回错误信息，无错为 undefined。 */
export async function commitArtifacts(io: Io, f: Flight, paths: readonly string[]): Promise<string | undefined> {
  const abs = paths.map(p => `${f.changeTree}/${p}`)
  const add = await git(io, f.changeTree, 'add', '--', ...abs)
  if (add.exitCode !== 0) return `git add 失败：${firstLine(add)}`
  const commit = await git(io, f.changeTree, 'commit', '-m', `docs(openspec): ${f.change} 工件（起飞时经「授权提交」提交）`, '--', ...abs)
  if (commit.exitCode !== 0) return `git commit 失败：${firstLine(commit)}`
  return undefined
}

async function unmerged(io: Io, tree: string): Promise<string[]> {
  return lines((await git(io, tree, 'diff', '--name-only', '--diff-filter=U')).stdout)
}

/** merge --no-ff；冲突时 merge --abort 并以 `conflict: <文件>` 报告。 */
async function mergeNoFf(io: Io, tree: string, branch: string, message: string): Promise<{ ok: true } | { ok: false; conflicts: string[]; failed: string[] }> {
  const r = await git(io, tree, 'merge', '--no-ff', branch, '-m', message)
  if (r.exitCode === 0) return { ok: true }
  const conflicts = await unmerged(io, tree)
  if (!conflicts.length) return { ok: false, conflicts: [], failed: [`git merge 失败：${firstLine(r)}`] }
  await git(io, tree, 'merge', '--abort')
  return { ok: false, conflicts, failed: conflicts.map(c => `conflict: ${c}`) }
}

async function head(io: Io, tree: string): Promise<string> {
  return (await git(io, tree, 'rev-parse', 'HEAD')).stdout.trim()
}

/** owns 中存在的、非测试、非 .md 文件的签名行，写进 _interfaces.md 的 `## <S>` 一节（已有则整节替换）。 */
async function refreshInterfaces(io: Io, f: Flight, slice: string, owns: readonly string[]): Promise<void> {
  const blocks: string[] = []
  for (const p of owns) {
    const base = p.split('/').pop() ?? p
    if (p.startsWith('tests/') || p.includes('/tests/') || base.includes('test') || p.endsWith('.md')) continue
    const abs = `${f.changeTree}/${p}`
    if (!(await io.exists(abs))) continue
    const sigs = ((await io.read(abs)) ?? '').split('\n').filter(l => SIGNATURE.test(l))
    if (sigs.length) blocks.push(`### ${p}\n\`\`\`\n${sigs.join('\n')}\n\`\`\``)
  }
  const section = [`## ${slice}`, ...blocks].join('\n\n') + '\n'
  const path = changePath(f, INTERFACES)
  const old = (await io.read(path)) ?? '# 公开接口摘要\n'
  const isOwn = (l: string) => l === `## ${slice}` || l.startsWith(`## ${slice} `)
  const kept: string[] = []
  let at = -1
  let skipping = false
  for (const l of old.replace(/\n+$/, '').split('\n')) {
    if (l.startsWith('## ')) skipping = isOwn(l)
    if (skipping) {
      if (at < 0) at = kept.length
      continue
    }
    kept.push(l)
  }
  const parts = kept.join('\n').replace(/\n+$/, '')
  if (at < 0) return io.write(path, `${parts}\n\n${section}`)
  const before = kept.slice(0, at).join('\n').replace(/\n+$/, '')
  const after = kept.slice(at).join('\n').replace(/^\n+/, '')
  await io.write(path, `${before}\n\n${section}${after ? `\n${after}\n` : ''}`)
}

/** record 门禁 JSON、刷新接口摘要、取 HEAD。 */
async function afterMerge(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
  const rec = await judge(io, f, 'slice-gate', 'record', '--change-dir', f.changeDir, '--json', JSON.stringify(gate))
  if (rec.exitCode !== 0) return { ok: false, failed: [`slice-gate record 失败：${firstLine(rec)}`] }
  await refreshInterfaces(io, f, slice, owns)
  return { ok: true, commit: await head(io, f.changeTree) }
}

/** 越界检查：切片分叉点以来，change 分支第一父链上的非合并提交改动了本片 owns（飞行记录除外）→ 返回说明；切片改动只能经 integrate 合并进来。 */
async function directCommits(io: Io, f: Flight, branch: string, owns: readonly string[]): Promise<string | undefined> {
  const mb = await git(io, f.changeTree, 'merge-base', 'HEAD', branch)
  const base = mb.stdout.trim()
  if (mb.exitCode !== 0 || base === '') return `git merge-base 失败：${firstLine(mb)}`
  const log = await git(io, f.changeTree, 'log', '--first-parent', '--no-merges', '--name-only', '--format=@%h', `${base}..HEAD`)
  if (log.exitCode !== 0) return `git log 失败：${firstLine(log)}`
  const records = new Set(RECORD_FILES.map(r => `${f.changeDir}/${r}`))
  const hits: string[] = []
  let commit = ''
  for (const l of lines(log.stdout)) {
    if (l.startsWith('@')) commit = l.slice(1)
    else if (!records.has(l) && owns.some(o => globMatch(l, o))) hits.push(`${commit} ${l}`)
  }
  return hits.length ? `change 分支上有改动本片 owns 的直接提交（切片改动只能经 integrate 合并进来）：${hits.join('、')}` : undefined
}

/** 空合回检查：合并结果树与 HEAD 的树相同（合回 commit 对第一父 diff 为空）→ 返回说明；有冲突（merge-tree 退出 1）交给 merge 报。 */
async function emptyMerge(io: Io, f: Flight, branch: string): Promise<string | undefined> {
  const mt = await git(io, f.changeTree, 'merge-tree', '--write-tree', 'HEAD', branch)
  if (mt.exitCode === 1) return undefined
  const merged = mt.stdout.trim().split('\n')[0] ?? ''
  const headTree = (await git(io, f.changeTree, 'rev-parse', 'HEAD^{tree}')).stdout.trim()
  if (mt.exitCode !== 0 || merged === '' || headTree === '') return `git merge-tree 失败：${firstLine(mt)}`
  return merged === headTree ? `合回对第一父无变更：${branch} 的改动已不经 integrate 进了 change 分支，不能当作正常合回` : undefined
}

/**
 * 已经 integrate 过：切片分支尖端是 HEAD 第一父链上某个合并提交的非第一父。
 * 只看「尖端是 HEAD 的祖先」不够：零提交的切片分支尖端就是派发时的 change 分支尖端，同样是祖先（PR #41 复核 HIGH）。
 */
async function integrated(io: Io, f: Flight, branch: string): Promise<boolean> {
  const tip = await git(io, f.changeTree, 'rev-parse', branch)
  const sha = tip.stdout.trim()
  if (tip.exitCode !== 0 || sha === '') return false
  const merges = await git(io, f.changeTree, 'log', '--first-parent', '--merges', '--format=%P', `${sha}..HEAD`)
  return merges.exitCode === 0 && lines(merges.stdout).some(l => l.split(' ').slice(1).includes(sha))
}

/** 在 change worktree 里：提交飞行记录 →（已合回则只补记账）→ 越界与空合回检查 → merge --no-ff → record --json → 刷新接口摘要 */
export async function mergeSlice(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]):
  Promise<{ ok: true; commit: string } | { ok: false; conflicts: string[]; failed: string[] }> {
  const err = await commitRecords(io, f, 'chore(flight): 记录')
  if (err) return { ok: false, conflicts: [], failed: [err] }
  const branch = `flight/${f.change}/${slice}`
  // 续飞补跑门禁后：上一 attempt 已 integrate、账本缺 merge 事件 → 已合回，只补记账
  if (await integrated(io, f, branch)) {
    const r = await afterMerge(io, f, slice, gate, owns)
    return r.ok ? r : { ...r, conflicts: [] }
  }
  const refused = (await directCommits(io, f, branch, owns)) ?? (await emptyMerge(io, f, branch))
  if (refused) return { ok: false, conflicts: [], failed: [refused] }
  const m = await mergeNoFf(io, f.changeTree, `flight/${f.change}/${slice}`, `integrate: ${slice}`)
  if (!m.ok) return m
  const r = await afterMerge(io, f, slice, gate, owns)
  return r.ok ? r : { ...r, conflicts: [] }
}

/** 冲突时：merge --abort；建 <mainTree>/.claude/worktrees/flight-<change>-<S>-resolve（分支 flight/<change>/<S>-resolve，基于 f.branch）并在其中重做合并 */
export async function prepareResolve(io: Io, f: Flight, slice: string): Promise<{ path: string; conflicts: string[] } | { error: string }> {
  // mergeSlice 冲突时已 abort；这里再 abort 一次兜住中途中断留下的合并现场，没有进行中的合并时 git 报错，忽略
  await git(io, f.changeTree, 'merge', '--abort')
  const path = resolvePath(f, slice)
  // ceiling: 解冲突 worktree 已存在（上次中断留下）时直接报错 -> 需要续用时改为检测 worktree list 并复用现场
  const add = await git(io, f.changeTree, 'worktree', 'add', '-b', resolveBranch(f, slice), path, f.branch)
  if (add.exitCode !== 0) return { error: `建解冲突 worktree 失败：${firstLine(add)}` }
  const m = await git(io, path, 'merge', '--no-ff', `flight/${f.change}/${slice}`, '-m', `integrate: ${slice}`)
  if (m.exitCode === 0) return { error: '解冲突现场合并意外成功：无需解冲突' }
  const conflicts = await unmerged(io, path)
  if (!conflicts.length) return { error: `git merge 失败：${firstLine(m)}` }
  return { path, conflicts }
}

/** 解冲突完成：无未合并文件且 HEAD 有两个父 → change worktree 里 merge --ff-only flight/<change>/<S>-resolve；之后同 mergeSlice 的 record 与接口摘要 */
export async function finishResolve(io: Io, f: Flight, slice: string, gate: GateJson, owns: readonly string[]): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
  const path = resolvePath(f, slice)
  const left = await unmerged(io, path)
  if (left.length) return { ok: false, failed: [`解冲突未完成：仍有未合并文件 ${left.join(', ')}`] }
  const parents = (await git(io, path, 'rev-list', '--parents', '-n', '1', 'HEAD')).stdout.trim().split(/\s+/).filter(Boolean)
  if (parents.length !== 3) return { ok: false, failed: ['解冲突未完成：HEAD 不是合并提交'] }
  // ceiling: change 分支在解冲突期间前进（如同 wave 其他切片已合回）时 --ff-only 失败并记阻断 -> 需要时改为在解冲突 worktree 先 rebase/merge change 分支再快进
  const ff = await git(io, f.changeTree, 'merge', '--ff-only', resolveBranch(f, slice))
  if (ff.exitCode !== 0) return { ok: false, failed: [`git merge --ff-only 失败：${firstLine(ff)}`] }
  return afterMerge(io, f, slice, gate, owns)
}

/** 合回修复：提交飞行记录 → merge --no-ff flight/<change>/fix -m "integrate: fix" → timeline.py record fix */
export async function mergeFix(io: Io, f: Flight, note: string): Promise<{ ok: true; commit: string } | { ok: false; failed: string[] }> {
  const err = await commitRecords(io, f, 'chore(flight): 记录')
  if (err) return { ok: false, failed: [err] }
  const m = await mergeNoFf(io, f.changeTree, `flight/${f.change}/fix`, 'integrate: fix')
  if (!m.ok) return { ok: false, failed: m.failed }
  const t = await judge(io, f, 'timeline', 'record', 'fix', '--change-dir', f.changeDir, '--note', note)
  if (t.exitCode !== 0) return { ok: false, failed: [`timeline record 失败：${firstLine(t)}`] }
  return { ok: true, commit: await head(io, f.changeTree) }
}

export function validateFindings(input: unknown): { ok: true; findings: Finding[] } | { ok: false; error: string } {
  const list = (input as { findings?: unknown } | null)?.findings
  if (typeof input !== 'object' || input === null || !Array.isArray(list)) return { ok: false, error: '输入必须是 {findings: [...]}' }
  const findings: Finding[] = []
  for (const [i, raw] of list.entries()) {
    const n = `第 ${i + 1} 项`
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `${n}不是对象` }
    const x = raw as Record<string, unknown>
    if (!SEVERITIES.includes(x.severity as Severity)) return { ok: false, error: `${n}的 severity 须为 ${SEVERITIES.join(' / ')}，实际为 ${JSON.stringify(x.severity)}` }
    if (typeof x.file !== 'string' || !x.file) return { ok: false, error: `${n}的 file 须为非空字符串` }
    if (!Number.isInteger(x.line)) return { ok: false, error: `${n}的 line 须为整数，实际为 ${JSON.stringify(x.line)}` }
    if (typeof x.summary !== 'string') return { ok: false, error: `${n}的 summary 须为字符串` }
    if (typeof x.fix !== 'string') return { ok: false, error: `${n}的 fix 须为字符串` }
    findings.push({ severity: x.severity as Severity, file: x.file, line: x.line as number, summary: x.summary, fix: x.fix })
  }
  return { ok: true, findings }
}

/** 落地收口：review-findings.json → 勾选 tasks.md → timeline apply-done → 收口提交 → slice-gate.py ship */
export async function closeout(io: Io, f: Flight, lists: { blocked: { slice: string; kind: 'gate' | 'infra'; reason: string }[]; blocking: Finding[]; deferred: Finding[]; fix: { ok: boolean; commit: string } | null }, merged: readonly string[]):
  Promise<{ verdict: 'ready' | 'draft'; reasons: string }> {
  const { blocked, blocking, deferred, fix } = lists
  await io.write(changePath(f, 'review-findings.json'), JSON.stringify({ blocked, blocking, deferred, fix }, null, 2) + '\n')
  const tasksPath = changePath(f, 'tasks.md')
  const tasks = await io.read(tasksPath)
  if (tasks !== undefined) {
    const ticked = tasks
      .split('\n')
      .map(l => {
        const s = merged.find(m => l.startsWith(`- [ ] ${m} `))
        return s ? `- [x] ${s} ${l.slice(`- [ ] ${s} `.length)}` : l
      })
      .join('\n')
    await io.write(tasksPath, ticked)
  }
  const t = await judge(io, f, 'timeline', 'record', 'apply-done', '--change-dir', f.changeDir, '--note', `blocked=${blocked.length} blocking=${blocking.length}`)
  if (t.exitCode !== 0) return { verdict: 'draft', reasons: `timeline record apply-done 失败：${firstLine(t)}` }
  const err = await commitRecords(io, f, 'chore(flight): 收口', ['review-findings.json', 'tasks.md'])
  if (err) return { verdict: 'draft', reasons: `收口提交失败：${err}` }
  const ship = await judge(io, f, 'slice-gate', 'ship', '--change-dir', f.changeDir)
  return { verdict: ship.exitCode === 0 ? 'ready' : 'draft', reasons: ship.stdout || ship.stderr }
}
