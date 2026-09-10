// opsx-apply · 飞行模式的确定性调度脚本（Claude Code 命名工作流）
// 由 /opsx-apply 命令以 args 启动：
//   { change, changeDir, hooksDir, waves, useAgentTypes }
//   change        change 名，如 "add-user-export"
//   changeDir     相对仓库根，如 "openspec/changes/add-user-export"
//   hooksDir      相对仓库根，如 ".claude/hooks"
//   waves         slice-gate.py waves 的输出，如 [["S1","S2"],["S3"],["S4","S5"]]
//   useAgentTypes false 时不传 agentType（agent 定义未注册的仓库回退为默认 workflow subagent）
// 结构：wave 内 parallel 派发切片 → 门禁红重试一次 → 多切片 wave 由 integrator 合回 →
//       评审只 push 不 await（离关键路径）→ Fix 阶段汇总 CRITICAL/HIGH 一次批量修复 → Finalize 全量门禁。
// 不用时间戳与随机数（运行时为可续跑而禁止它们），脚本本身不碰文件系统，全部由 agent 执行。
export const meta = {
  name: 'opsx-apply',
  description: '按 slices.json 逐 wave 并行实现切片；每切片机械门禁；评审离关键路径；一次批量修复；全量门禁',
  whenToUse: '由 /opsx-apply 命令在 slices.json lint 通过后启动；不要手工调用',
  phases: [
    { title: 'Implement', detail: '按 wave 并行派发 slice-executor，门禁红重试一次' },
    { title: 'Review', detail: '每切片一个 code-reviewer，并行、不阻塞下一个 wave' },
    { title: 'Fix', detail: '汇总 CRITICAL/HIGH，一个执行体一次修完' },
    { title: 'Finalize', detail: 'integrator 跑全量门禁与 scenario 状态' },
  ],
}

const { change, changeDir, hooksDir, waves, useAgentTypes } = args
const agentsDir = args.agentsDir || '.claude/agents'
const typed = (name) => (useAgentTypes === false ? {} : { agentType: name })
// agent 定义未注册（useAgentTypes=false）时，纪律仍以定义文件为准：让默认 subagent 先读它再干活
const rules = (name) => (useAgentTypes === false ? `先 Read ${agentsDir}/${name}.md，严格按它的纪律执行（它就是你的角色定义）。\n` : '')
const gateCmd = (s) => `python3 ${hooksDir}/slice-gate.py gate ${s} --change-dir ${changeDir}`
const startCmd = (s) => `python3 ${hooksDir}/slice-gate.py start ${s} --change-dir ${changeDir}`

const GATE = {
  type: 'object',
  required: ['slice', 'ok', 'commit', 'failed'],
  properties: {
    slice: { type: 'string' },
    ok: { type: 'boolean' },
    commit: { type: 'string' },
    failed: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}
const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'line', 'summary', 'fix'],
        properties: {
          severity: { enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const expectHead = args.expectHead || null
const executorPrompt = (s, retryOf) => [
  rules('slice-executor') + `你在仓库根（cwd）。为 OpenSpec change \`${change}\` 实现切片 ${s}。`,
  expectHead
    ? `第零步：运行 \`git rev-parse HEAD\`，若不是以 ${expectHead} 开头，说明你的 worktree 没有从 change 分支最新 commit 分叉——不要做任何改动，直接返回 {"slice":"${s}","ok":false,"commit":"<实际 HEAD>","failed":["G0 base: worktree HEAD 不是 ${expectHead}"]}。`
    : '',
  `切片包：${changeDir}/slices/${s}.md（scenario、owns、verify、接口摘要都在里面，先读它）。`,
  `第一步运行 \`${startCmd(s)}\`。`,
  retryOf
    ? `上一轮门禁未过：${JSON.stringify(retryOf.failed)}。只修这些门禁项，不扩大范围。`
    : '按切片包 TDD 实现，只写 owns 内文件，每切片一个 commit。',
  `收尾运行 \`${gateCmd(s)}\`，把它打印的 JSON 原样作为最终输出。`,
].join('\n')

const reviewPrompt = (s, gate) => [
  rules('code-reviewer') + `评审模式：full。审 OpenSpec change \`${change}\` 切片 ${s} 的实现 commit：\`git show ${gate.commit}\`。`,
  `切片包（scenario 与约束）：${changeDir}/slices/${s}.md。`,
  `门禁 JSON（已机械判定 verify / 配对 / GWT / 所有权 / scenario 状态，不要重报）：${JSON.stringify(gate)}。`,
  `evidence：${changeDir}/evidence.log（本切片的测试运行留痕，可 grep）。`,
  '不重跑测试套件、不轮询；至多 1 次定向抽查。',
  '输出结构化 findings（severity / file / line / summary / fix）。',
].join('\n')

const reviews = []
const results = []
const blocked = []

for (const [i, wave] of waves.entries()) {
  phase('Implement')
  log(`wave ${i + 1}/${waves.length}: ${wave.join(', ')}`)
  const iso = wave.length > 1 ? 'worktree' : undefined
  const done = await parallel(wave.map((s) => () =>
    agent(executorPrompt(s), { label: s, isolation: iso, schema: GATE, ...typed('slice-executor') })
      .then((r) => (r && !r.ok)
        ? agent(executorPrompt(s, r), { label: `${s}:retry`, isolation: iso, schema: GATE, ...typed('slice-executor') })
        : r)))
  for (const [k, r] of done.entries()) {
    const s = wave[k]
    if (!r) { blocked.push({ slice: s, reason: 'agent 未返回' }); continue }
    results.push(r)
    if (!r.ok) { blocked.push({ slice: s, reason: r.failed.join('; ') }); continue }
  }
  const merged = wave.filter((s, k) => done[k] && done[k].ok)
  if (iso && merged.length) {
    const shas = merged.map((s) => done[wave.indexOf(s)].commit)
    const integ = await agent(
      rules('integrator') + `把切片 ${merged.join(', ')} 的 commit 合回当前分支：${shas.join(' ')}（按 agent 定义第 1 项，冲突则 abort 并返回 ok:false）。` +
      `然后按第 2 项刷新 ${changeDir}/slices/_interfaces.md，并 \`python3 ${hooksDir}/timeline.py record integrate --change-dir ${changeDir} --note "wave ${i + 1}"\`。返回 JSON。`,
      { label: `integrate:w${i + 1}`, effort: 'low', schema: GATE, ...typed('integrator') })
    if (!integ || !integ.ok) blocked.push({ slice: `wave${i + 1}`, reason: integ ? integ.failed.join('; ') : 'integrator 未返回' })
  }
  for (const s of merged) {
    const gate = done[wave.indexOf(s)]
    reviews.push(agent(reviewPrompt(s, gate), { label: `review:${s}`, phase: 'Review', schema: FINDINGS, ...typed('code-reviewer') }))
  }
}

phase('Fix')
const findings = (await Promise.all(reviews)).filter(Boolean).flatMap((r) => r.findings || [])
const blocking = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
const deferred = findings.filter((f) => f.severity !== 'CRITICAL' && f.severity !== 'HIGH')
log(`评审 finding：阻断 ${blocking.length}，非阻断 ${deferred.length}`)
let fix = null
if (blocking.length) {
  fix = await agent([
    rules('slice-executor') + `你在仓库根。一次性修复 OpenSpec change \`${change}\` 评审挡下的 ${blocking.length} 条 CRITICAL/HIGH，逐条 commit（fix: 前缀），不 push。`,
    `先运行 \`python3 ${hooksDir}/slice-gate.py start fix --change-dir ${changeDir}\` 记录起点（fix 不受单切片所有权限制：slices.json 若无 fix 条目，start 会拒绝，此时跳过 start）。`,
    `finding 清单：${JSON.stringify(blocking)}`,
    `每条修复都要有先失败的测试；修完运行 \`python3 ${hooksDir}/slice-gate.py final --change-dir ${changeDir}\`，把 JSON 原样返回。`,
  ].join('\n'), { label: 'fix', schema: GATE, ...typed('slice-executor') })
}

phase('Finalize')
const final = await agent(
  rules('integrator') + `按 agent 定义第 3 项运行 \`python3 ${hooksDir}/slice-gate.py final --change-dir ${changeDir}\`，` +
  `再 \`python3 ${hooksDir}/timeline.py record apply-done --change-dir ${changeDir} --note "blocked=${blocked.length} blocking=${blocking.length}"\`。返回 final 的 JSON。`,
  { label: 'final-gate', effort: 'low', schema: GATE, ...typed('integrator') })

return { change, slices: results, blocked, blocking, deferred, fix, final }
