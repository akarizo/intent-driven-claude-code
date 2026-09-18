// opsx-apply · 飞行模式的确定性调度脚本（Claude Code 命名工作流）
// 由 /opsx-apply 命令以 args 启动：
//   { change, changeDir, hooksDir, agentsDir, waves, useAgentTypes, expectHead, models, efforts }
//   change        change 名，如 "add-user-export"
//   changeDir     相对仓库根，如 "openspec/changes/add-user-export"
//   hooksDir      相对仓库根，如 ".claude/hooks"
//   agentsDir     相对仓库根，如 ".claude/agents"（agent 定义未注册时让默认 subagent 先读定义）
//   waves         slice-gate.py waves 的输出，如 [["S1","S2"],["S3"],["S4","S5"]]
//   useAgentTypes false 时不传 agentType（agent 定义未注册的仓库回退为默认 workflow subagent）
//   expectHead    可选，change 分支最新 commit 前缀；执行体第零步校验自己的 worktree 基分支
//   deps          可选，{ S3: ["S1","S2"], ... }（来自 slices.json）；依赖已 blocked 的切片直接记 blocked，不白跑
//                 blocked 条目形如 { slice, kind: 'gate' | 'infra', reason }：gate = 切片门禁红；infra = agent 未返回 / 依赖跳过 / integrator 合回失败。
//                 blocked 只进 PR 正文作说明；draft / ready 由 slice-gate.py ship 按 gate-report.md 裁决，不看本列表。
//   models        必填：{ executor, reviewer, integrator }，按角色显式路由（铁律：不得留空让 env 默认兜底）
//                 executor / reviewer = 会话主模型别名（如 "opus" / "fable"）；integrator = 低档模型（"sonnet"）
//   efforts       可选：{ executor: "high", reviewer: "high", integrator: "low" }
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
const expectHead = args.expectHead || null
const deps = args.deps || {}   // 可选：{ S3: ["S1","S2"], ... }；依赖已 blocked 的切片不再派发，直接记 blocked

// ---- 模型路由（铁律：按角色显式声明，缺一即拒绝起飞）
const models = args.models || {}
for (const role of ['executor', 'reviewer', 'integrator']) {
  if (!models[role]) throw new Error(`args.models.${role} 缺失：模型必须按角色显式路由（executor/reviewer = 会话主模型，integrator = sonnet），不能留空让 CLAUDE_CODE_SUBAGENT_MODEL 默认兜底`)
}
const efforts = Object.assign({ executor: 'high', reviewer: 'high', integrator: 'low' }, args.efforts || {})
log(`模型路由：executor=${models.executor}/${efforts.executor} · reviewer=${models.reviewer}/${efforts.reviewer} · integrator=${models.integrator}/${efforts.integrator}`)

const typed = (name) => (useAgentTypes === false ? {} : { agentType: name })
// agent 定义未注册（useAgentTypes=false）时，纪律仍以定义文件为准：让默认 subagent 先读它再干活
const rules = (name) => (useAgentTypes === false ? `先 Read ${agentsDir}/${name}.md，严格按它的纪律执行（它就是你的角色定义）。\n` : '')
const gateCmd = (s) => `python3 ${hooksDir}/slice-gate.py gate ${s} --change-dir ${changeDir}`
// base：重派时传上一轮 gate JSON 的 base，让 start 在接续 commit 后仍以同一基准算区间（start 对同片幂等）
const startCmd = (s, base) => `python3 ${hooksDir}/slice-gate.py start ${s} --change-dir ${changeDir}` + (base ? ` --base ${base}` : '')

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
    // 本轮 start 记录的区间起点 sha；重派时原样回传给 start --base，重试才能接着上一轮的 commit 与基准继续
    base: { type: 'string' },
    // 合规天花板行 [[相对路径, 行号（整数）, 限制, 升级路径], ...]：门禁在临时 worktree 里算出，靠这个字段带回给 record 写进飞行记录
    // 内层元素无类型约束，执行体可能转写出非整数行号 → 消费侧 slice-gate.py 的 ceiling_rows_from_json 负责宽容化，不在这里 fail
    ceilings: { type: 'array', items: { type: 'array' } },
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

const executorPrompt = (s, retryOf) => [
  rules('slice-executor') + `你在仓库根（cwd）。为 OpenSpec change \`${change}\` 实现切片 ${s}。`,
  // 重派：接着上一轮的 commit 继续（临时 worktree 可能是新开的，HEAD 不是上一轮 commit 就 cherry-pick 它）；首轮：expectHead 基分支校验
  retryOf && retryOf.commit
    ? `第零步：运行 \`git rev-parse HEAD\`，若不等于上一轮的 commit ${retryOf.commit}，运行 \`git cherry-pick ${retryOf.commit}\` 把它接上；冲突则 \`git cherry-pick --abort\`，不做任何改动，直接返回 {"slice":"${s}","ok":false,"commit":"<实际 HEAD>","failed":["G0 base: cherry-pick ${retryOf.commit} 冲突"]}。`
    : expectHead
      ? `第零步：运行 \`git rev-parse HEAD\`，若不是以 ${expectHead} 开头，说明你的 worktree 没有从 change 分支最新 commit 分叉——不要做任何改动，直接返回 {"slice":"${s}","ok":false,"commit":"<实际 HEAD>","failed":["G0 base: worktree HEAD 不是 ${expectHead}"]}。`
      : '',
  `切片包：${changeDir}/slices/${s}.md（scenario、owns、verify、接口摘要都在里面，先读它）。`,
  retryOf && retryOf.base
    ? `第一步运行 \`${startCmd(s, retryOf.base)}\`（\`--base\` 是上一轮的区间起点，start 对同片幂等；不要不带 --base 重跑）。`
    : `第一步运行 \`${startCmd(s)}\`。`,
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

for (const [i, allWave] of waves.entries()) {
  phase('Implement')
  const blockedIds = new Set(blocked.map((b) => b.slice))
  const skipped = allWave.filter((s) => (deps[s] || []).some((d) => blockedIds.has(d)))
  for (const s of skipped) blocked.push({ slice: s, kind: 'infra', reason: `依赖已 blocked：${(deps[s] || []).filter((d) => blockedIds.has(d)).join(', ')}` })
  const wave = allWave.filter((s) => !skipped.includes(s))
  log(`wave ${i + 1}/${waves.length}: ${wave.join(', ') || '(全部因依赖 blocked 跳过)'}`)
  if (!wave.length) continue
  const iso = wave.length > 1 ? 'worktree' : undefined
  const done = await parallel(wave.map((s) => () =>
    agent(executorPrompt(s), { label: s, isolation: iso, schema: GATE, model: models.executor, effort: efforts.executor, ...typed('slice-executor') })
      .then((r) => (r && !r.ok)
        ? agent(executorPrompt(s, r), { label: `${s}:retry`, isolation: iso, schema: GATE, model: models.executor, effort: efforts.executor, ...typed('slice-executor') })
        : r)))
  for (const [k, r] of done.entries()) {
    const s = wave[k]
    if (!r) { blocked.push({ slice: s, kind: 'infra', reason: 'agent 未返回' }); continue }
    results.push(r)
    if (!r.ok) { blocked.push({ slice: s, kind: 'gate', reason: r.failed.join('; ') }); continue }
  }
  const merged = wave.filter((s, k) => done[k] && done[k].ok)
  if (iso && merged.length) {
    const shas = merged.map((s) => done[wave.indexOf(s)].commit)
    // 临时 worktree 里跑出的门禁结论（含天花板行）不会随 commit 进分支，由 integrator 用 record --json 幂等写回
    const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
    const recordCmds = merged.map((s) => {
      const g = done[wave.indexOf(s)]
      const payload = { slice: s, ok: !!g.ok, commit: g.commit, failed: g.failed || [], warnings: g.warnings || [], ceilings: g.ceilings || [] }
      return `python3 ${hooksDir}/slice-gate.py record --change-dir ${changeDir} --json ${shq(JSON.stringify(payload))}`
    })
    const integ = await agent(
      rules('integrator') + `按 agent 定义第 0 项先把 ${changeDir} 内未提交的飞行记录文件（timeline.md / gate-report.md / evidence.log）提交掉；` +
      `再按第 1 项把切片 ${merged.join(', ')} 的 commit 合回当前分支：${shas.join(' ')}（冲突则 abort 并返回 ok:false）。` +
      `合回后逐条运行（把临时 worktree 里的门禁结论写回分支）：\n${recordCmds.join('\n')}\n` +
      `然后按第 2 项刷新 ${changeDir}/slices/_interfaces.md，并 \`python3 ${hooksDir}/timeline.py record integrate --change-dir ${changeDir} --note "wave ${i + 1}"\`，最后再按第 0 项把飞行记录提交。返回 JSON。`,
      { label: `integrate:w${i + 1}`, schema: GATE, model: models.integrator, effort: efforts.integrator, ...typed('integrator') })
    if (!integ || !integ.ok) blocked.push({ slice: `wave${i + 1}`, kind: 'infra', reason: integ ? integ.failed.join('; ') : 'integrator 未返回' })
  }
  for (const s of merged) {
    const gate = done[wave.indexOf(s)]
    reviews.push(agent(reviewPrompt(s, gate), { label: `review:${s}`, phase: 'Review', schema: FINDINGS, model: models.reviewer, effort: efforts.reviewer, ...typed('code-reviewer') }))
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
    `每条修复都要有先失败的测试；修完 \`python3 ${hooksDir}/timeline.py record fix --change-dir ${changeDir} --note "blocking=${blocking.length}"\`，` +
    `再运行 \`python3 ${hooksDir}/slice-gate.py final --change-dir ${changeDir}\`，把 JSON 原样返回。`,
  ].join('\n'), { label: 'fix', schema: GATE, model: models.executor, effort: efforts.executor, ...typed('slice-executor') })
}

phase('Finalize')
const final = await agent(
  rules('integrator') + `按 agent 定义第 0 项先提交 ${changeDir} 内未提交的飞行记录文件；` +
  `\`python3 ${hooksDir}/timeline.py record review --change-dir ${changeDir} --note "findings=${findings.length} blocking=${blocking.length} deferred=${deferred.length}"\`；` +
  `再按第 3 项运行 \`python3 ${hooksDir}/slice-gate.py final --change-dir ${changeDir}\`，` +
  `再 \`python3 ${hooksDir}/timeline.py record apply-done --change-dir ${changeDir} --note "blocked=${blocked.length} blocking=${blocking.length}"\`，最后按第 0 项再提交一次飞行记录。返回 final 的 JSON。`,
  { label: 'final-gate', schema: GATE, model: models.integrator, effort: efforts.integrator, ...typed('integrator') })

return { change, models, efforts, slices: results, blocked, blocking, deferred, fix, final }
