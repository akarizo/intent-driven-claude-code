// 控制面派发给 flight:executor / reviewer / fixer 的提示词。纯函数：不 import 运行时、不跑命令。
// 切片包路径一律相对 worktree 根：`${changeDir}/slices/${slice}.md`。

type Finding = { severity: string; file: string; line: number; summary: string; fix: string }

const GATE_NOTE = '门禁由控制面在你收口时运行：不要自己运行 slice-gate；红了控制面会把失败项告诉你，接着修。'
const OWNS_NOTE = '只写切片包 owns 内的文件；写入被拒时不绕过，在最后一行写明该路径。'

/** 派发时前置在每份提示词之首：引擎不保证 agent 落在 spawn 的 cwd 里（flight-envelope 实测执行体落在 change worktree 并在其上直接提交）。 */
export function worktreeNote(worktree: string): string {
  return `你的 worktree：\`${worktree}\`。读写文件一律用该目录下的绝对路径，git 一律 \`git -C ${worktree}\`；不得在别的 worktree 写入或提交。`
}

function slicePack(changeDir: string, slice: string): string {
  return `${changeDir}/slices/${slice}.md`
}

export function executorPrompt(x: {
  change: string
  changeDir: string
  slice: string
  continuation?: { reason: string; failed: string[] }
  previous?: { branch: string; attempt: number }
}): string {
  const lines = [
    `为 OpenSpec change \`${x.change}\` 实现切片 ${x.slice}。`,
    `切片包：${slicePack(x.changeDir, x.slice)}（scenario、owns、verify、接口摘要都在里面，先读它）。`,
    `按切片包 TDD 实现；${OWNS_NOTE}每切片一个 commit。`,
    '写好测试后、改生产代码前，调用 `measure` 工具让控制面测一次并看它红；自己跑的测试不算证据。',
    '某个目标在改生产代码前测量就已通过（且不是护栏）时，不得改坏生产代码来造红：照实收口，写明是哪个 scenario。',
  ]
  if (x.previous) {
    lines.push(
      `上一次（attempt ${x.previous.attempt}）的分支 \`${x.previous.branch}\` 留作参考：可 \`git show\` / \`git diff\` 读取，不得 cherry-pick 或 merge；一切以当前切片包为准。`,
    )
  }
  lines.push(GATE_NOTE)
  if (x.continuation) {
    const failed = x.continuation.failed.length ? x.continuation.failed.map(f => `- ${f}`).join('\n') : '- （无）'
    lines.push(
      `这是续接：${x.continuation.reason || '上一轮执行体未正常收口'}。最近一次门禁的失败项：\n${failed}`,
      '先 `git status` / `git log` 看清已完成的部分，在其上继续，不重做。',
    )
  }
  lines.push('commit 后结束，最后一行简述做了什么。')
  return lines.join('\n')
}

export function reviewerPrompt(x: { change: string; changeDir: string; slice: string; commit: string }): string {
  return [
    `评审 OpenSpec change \`${x.change}\` 切片 ${x.slice} 合回后的 commit ${x.commit}（\`git diff ${x.commit}^1 ${x.commit}\` 取回改动：它是合并提交，必须对第一父取 diff）。`,
    '取不到 diff 或 diff 为空：提交一条 severity 为 HIGH 的 finding，summary 写「取 diff 失败」，不得提交空列表。',
    `切片包：${slicePack(x.changeDir, x.slice)}（scenario 与 owns 是验收依据）。`,
    '只读；不重跑测试套件，至多 1 次定向抽查。',
    '必须调用 submit_findings 提交（severity / file / line / summary / fix），没有问题也提交空列表；提交后一行结束。',
  ].join('\n')
}

const priorLines = (prior: Finding[], none: string) => (prior.length ? prior.map(f => `- [${f.severity}] ${f.file}:${f.line} — ${f.summary}`) : [`- （${none}）`])
const REVIEW_TAIL = [
  '取不到 diff 或 diff 为空：提交一条 severity 为 HIGH 的 finding，summary 写「取 diff 失败」，不得提交空列表。',
  '只读；不重跑测试套件，至多 1 次定向抽查。',
  '必须调用 submit_findings 提交（severity / file / line / summary / fix），没有问题也提交空列表；提交后一行结束。',
]

/** 全量评审：change 分支相对分叉点的全部改动（design D1）。 */
export function wholeReviewPrompt(x: { change: string; changeDir: string; hooksDir: string; base: string; commit: string; prior: Finding[] }): string {
  return [
    `全量评审 OpenSpec change \`${x.change}\`：审查范围为 \`git diff ${x.base} ${x.commit}\`（change 分支相对分叉点的全部改动）。`,
    `验收依据：${x.changeDir} 下的 proposal.md、design.md、specs/、slices.json。`,
    `门禁与测量统计以 \`python3 ${x.hooksDir}/timeline.py report --change-dir ${x.changeDir}\` 为准，在 worktree 里运行。`,
    '切片评审提过、修复体已修的 CRITICAL/HIGH 如下：逐条核对，没闭环或修得不对的照原级别再提交。',
    ...priorLines(x.prior, '切片评审没有 CRITICAL/HIGH'),
    ...REVIEW_TAIL,
  ].join('\n')
}

/** 复核：只审第 round 轮修复带来的改动（design D1）。 */
export function followupReviewPrompt(x: { change: string; changeDir: string; round: number; base: string; commit: string; prior: Finding[] }): string {
  return [
    `复核 OpenSpec change \`${x.change}\`（${x.changeDir}）第 ${x.round} 轮修复：审查范围为 \`git diff ${x.base} ${x.commit}\`，只审这一轮修复带来的改动。`,
    '上一轮的 CRITICAL/HIGH 如下：未闭环或修得不对的照原级别再提交。',
    ...priorLines(x.prior, '上一轮没有 CRITICAL/HIGH'),
    '修复补丁新引入的问题照常分级提交；与本次修复无关的代码不报。',
    ...REVIEW_TAIL,
  ].join('\n')
}

export function resolverPrompt(x: { change: string; changeDir: string; slice: string; conflicts: string[] }): string {
  return [
    `任务二 · 解合回冲突：OpenSpec change \`${x.change}\` 合回切片 ${x.slice} 时，当前 worktree 处于 git merge 冲突中。`,
    `切片包：${slicePack(x.changeDir, x.slice)}。`,
    '冲突文件：',
    ...x.conflicts.map(f => `- ${f}`),
    '只解这些文件，保持两边意图；解完 `git add` 这些文件，再 `git commit --no-edit`。',
    GATE_NOTE,
    '最后一行简述解了哪些文件。',
  ].join('\n')
}

export function fixerPrompt(x: { change: string; changeDir: string; findings: Finding[] }): string {
  return [
    `任务一 · 批量修复：OpenSpec change \`${x.change}\`（${x.changeDir}）评审给出以下 finding：`,
    ...x.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}:${f.line} — ${f.summary}\n   修法：${f.fix}`),
    '逐条修：每条先有失败测试，再最小修复；每条一个 commit，消息用 `fix:` 前缀。判断不成立的不改，在最后一行写明理由。',
    '门禁由控制面在你收口时运行（全量 final）：不要自己运行 slice-gate。',
    '最后一行简述修了哪几条。',
  ].join('\n')
}
