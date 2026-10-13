// 插件侧意图门禁（design D6）：纯模块，只经 Io 做副作用，不碰 $，不 import claude-code 的运行时值。接线在 orchestrator.tsx（S8）。
import type { Io } from './core'
import { bashWriteTargets, normalizePath, writeTarget } from './envelope'

/** 工具调用的写入目标（绝对路径）：Write / Edit 取 file_path，NotebookEdit 取 notebook_path，Bash 取写入目标；其他工具为空 */
export function toolTargets(tool: string, e: Record<string, unknown>, cwd: string): string[] {
  if (tool === 'Bash') return typeof e.command === 'string' ? bashWriteTargets(e.command, cwd).targets : []
  const p = writeTarget(tool, e)
  if (!p) return []
  return [normalizePath(p.startsWith('/') ? p : `${cwd}/${p}`)]
}

type CheckResult = { allow: boolean; denied: { path: string; reason: string }[] }

/** check 的 stdout：恰为期望形状、且 allow 与 denied 是否为空一致时才认 */
function parseCheck(stdout: string): CheckResult | undefined {
  try {
    const v = JSON.parse(stdout.trim()) as CheckResult
    if (typeof v?.allow !== 'boolean' || !Array.isArray(v.denied)) return undefined
    if (!v.denied.every(d => typeof d?.path === 'string' && typeof d?.reason === 'string')) return undefined
    return v.allow === (v.denied.length === 0) ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * 跑一次 `intent-gate.py check`：目标为空不运行；放行返回 undefined；有拒绝逐条列出；
 * 退出非 0 或输出不是期望的 JSON 时一律拒绝（fail closed）。
 */
export async function intentVerdict(io: Io, hooksDir: string, cwd: string, targets: readonly string[]): Promise<{ deny: string } | undefined> {
  if (targets.length === 0) return undefined
  const r = await io.run(['python3', `${hooksDir}/intent-gate.py`, 'check', '--cwd', cwd, ...targets])
  const v = r.exitCode === 0 ? parseCheck(r.stdout) : undefined
  if (!v) {
    const first = (r.exitCode === 0 ? r.stdout : r.stderr || r.stdout).split('\n').map(l => l.trim()).find(Boolean) ?? `退出码 ${r.exitCode}`
    return { deny: `flight：意图门禁判定失败（${first}），写入一律拒绝` }
  }
  if (v.allow) return undefined
  return { deny: v.denied.map(d => `flight：意图门禁拒绝写入 ${d.path}：${d.reason}`).join('\n') }
}
