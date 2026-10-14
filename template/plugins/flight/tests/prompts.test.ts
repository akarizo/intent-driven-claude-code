import { expect, test } from 'claude-code/testing'

import {
  executorPrompt,
  fixerPrompt,
  followupReviewPrompt,
  integFixerPrompt,
  integReviewPrompt,
  premergeResolverPrompt,
  replanPrompt,
  resolverPrompt,
  reviewerPrompt,
  triagePrompt,
  wholeReviewPrompt,
} from '../hooks/prompts.ts'

const CHANGE_DIR = 'template/openspec/changes/demo'
const GATE_BY_CONTROL_PLANE = '门禁由控制面在你收口时运行'

test('prompts-executor-and-continuation', async () => {
  // Given: change demo、切片 S2、切片包 template/openspec/changes/demo/slices/S2.md；上一个执行体未经收口结束，最近门禁 failed 为 ["G7 demo#s2"]
  const base = { change: 'demo', changeDir: CHANGE_DIR, slice: 'S2' }
  const continuation = { reason: '上一个执行体未正常收口', failed: ['G7 demo#s2'] }

  // When: 分别生成首次与续接的执行体提示词
  const [first, resumed] = [executorPrompt(base), executorPrompt({ ...base, continuation })]

  // Then: 两者都含切片包路径与「门禁由控制面在你收口时运行」；只有续接的含「未正常收口」、G7 demo#s2 与 git status
  for (const p of [first, resumed]) {
    expect(p).toContain(`${CHANGE_DIR}/slices/S2.md`)
    expect(p).toContain(GATE_BY_CONTROL_PLANE)
  }
  expect(first).not.toContain('未正常收口')
  expect(first).not.toContain('G7 demo#s2')
  expect(resumed).toContain('未正常收口')
  expect(resumed).toContain('G7 demo#s2')
  expect(resumed).toContain('git status')
})

test('executor-prompt-states-measure-protocol', async () => {
  // Given: change demo、切片 S2、切片包 template/openspec/changes/demo/slices/S2.md，首次派发（无续接）
  const base = { change: 'demo', changeDir: CHANGE_DIR, slice: 'S2' }

  // When: 生成执行体提示词
  const prompt = executorPrompt(base)

  // Then: 提示词含 measure 工具名与「不算证据」
  expect(prompt).toContain('measure')
  expect(prompt).toContain('不算证据')
})

test('prompt-names-previous-branch', async () => {
  // Given: change demo、切片 S1；一份输入带 previous: { branch: 'flight/demo/S1', attempt: 1 }，另一份不带
  const base = { change: 'demo', changeDir: CHANGE_DIR, slice: 'S1' }
  const previous = { branch: 'flight/demo/S1', attempt: 1 }

  // When: 分别生成两份执行体提示词
  const [withPrev, plain] = [executorPrompt({ ...base, previous }), executorPrompt(base)]

  // Then: 带 previous 的含 flight/demo/S1、「git show」与「不得 cherry-pick」；不带的不含「上一次」
  expect(withPrev).toContain('flight/demo/S1')
  expect(withPrev).toContain('git show')
  expect(withPrev).toContain('不得 cherry-pick')
  expect(plain).not.toContain('上一次')
})

test('prompts-reviewer-resolver-fixer', async () => {
  // Given: S1 合回后的 commit c1、合回 S2 时的冲突文件 a.py、一条 HIGH finding（summary「空 body 未校验」）
  const finding = { severity: 'HIGH', file: 'src/api.py', line: 42, summary: '空 body 未校验', fix: '先判空' }

  // When: 分别生成评审员、解冲突与批量修复提示词
  const [review, resolve, fix] = [
    reviewerPrompt({ change: 'demo', changeDir: CHANGE_DIR, slice: 'S1', commit: 'c1' }),
    resolverPrompt({ change: 'demo', changeDir: CHANGE_DIR, slice: 'S2', conflicts: ['a.py'] }),
    fixerPrompt({ change: 'demo', changeDir: CHANGE_DIR, findings: [finding] }),
  ]

  // Then: 评审员含 c1、S1 切片包路径与 submit_findings；解冲突含 a.py 与 git commit --no-edit；修复含该 finding 的 summary
  expect(review).toContain('c1')
  expect(review).toContain(`${CHANGE_DIR}/slices/S1.md`)
  expect(review).toContain('submit_findings')
  expect(resolve).toContain('a.py')
  expect(resolve).toContain('git commit --no-edit')
  expect(fix).toContain('空 body 未校验')
})

test('prompts-premerge-resolver', async () => {
  // Given: change demo 收口预合并 origin/main 时 a.py 与 b.py 冲突
  const x = { change: 'demo', changeDir: CHANGE_DIR, ref: 'origin/main', conflicts: ['a.py', 'b.py'] }

  // When: 生成预合并解冲突提示词
  const prompt = premergeResolverPrompt(x)

  // Then: 全文恰为：目标分支合进 change 分支时冲突、两边意图都保留、只解列出的文件、git add 后 git commit --no-edit、不改其它文件、门禁由控制面跑 final
  expect(prompt).toBe([
    '任务四 · 解预合并冲突：OpenSpec change `demo` 收口前把目标分支 origin/main 合进 change 分支时冲突，当前 worktree 处于 git merge 冲突中。',
    `验收依据：${CHANGE_DIR} 下的 proposal.md、design.md、specs/。`,
    '冲突文件：',
    '- a.py',
    '- b.py',
    '两边意图都保留：目标分支上已合入的改动与本 change 的改动都不能丢；只解这些文件，不改其它文件。',
    '解完 `git add` 这些文件，再 `git commit --no-edit`。',
    '门禁由控制面在你收口时运行（全量 final）：不要自己运行 slice-gate。',
    '最后一行简述解了哪些文件。',
  ].join('\n'))
})

test('prompts-reviewer-diffs-against-first-parent', async () => {
  // Given: S1 合回后的 --no-ff 合并提交 c1
  const x = { change: 'demo', changeDir: CHANGE_DIR, slice: 'S1', commit: 'c1' }

  // When: 生成评审员提示词
  const review = reviewerPrompt(x)

  // Then: 含 git diff c1^1 c1；不含 git show；写明「取 diff 失败」；写明按 HIGH 提交
  expect(review).toContain('git diff c1^1 c1')
  expect(review).not.toContain('git show')
  expect(review).toContain('取 diff 失败')
  expect(review).toContain('HIGH')
})

test('prompt-forbids-fabricated-red', async () => {
  // Given: change demo、切片 S1、切片包 template/openspec/changes/demo/slices/S1.md，首次派发（无续接）
  const base = { change: 'demo', changeDir: CHANGE_DIR, slice: 'S1' }

  // When: 生成执行体提示词
  const prompt = executorPrompt(base)

  // Then: 提示词含「护栏」「不得改坏生产代码」「照实收口」
  expect(prompt).toContain('护栏')
  expect(prompt).toContain('不得改坏生产代码')
  expect(prompt).toContain('照实收口')
})

test('whole-and-followup-prompts', async () => {
  // Given: change demo、判定器目录 /repo/hooks；prior 一条 HIGH a.ts:3（summary「漏判空」）；全量评审范围 b0..c9，第 1 轮复核范围 c9..c10
  const prior = [{ severity: 'HIGH' as const, file: 'a.ts', line: 3, summary: '漏判空', fix: '补判空' }]

  // When: 分别生成全量评审与第 1 轮复核提示词
  const [whole, followup] = [
    wholeReviewPrompt({ change: 'demo', changeDir: CHANGE_DIR, hooksDir: '/repo/hooks', base: 'b0', commit: 'c9', prior }),
    followupReviewPrompt({ change: 'demo', changeDir: CHANGE_DIR, round: 1, base: 'c9', commit: 'c10', prior }),
  ]

  // Then: 全量含 git diff b0 c9、a.ts:3、submit_findings、取 diff 失败、/repo/hooks/timeline.py report；复核含 git diff c9 c10、第 1 轮、a.ts:3、submit_findings、照原级别
  for (const s of ['git diff b0 c9', 'a.ts:3', 'submit_findings', '取 diff 失败', '/repo/hooks/timeline.py report']) expect(whole).toContain(s)
  for (const s of ['git diff c9 c10', '第 1 轮', 'a.ts:3', 'submit_findings', '照原级别']) expect(followup).toContain(s)
})

test('integ-prompts-state-guards', async () => {
  // Given: change demo；final failed 含 "G7 tests/test_x.py::test_y"；整合修复起点 base c9、修复后 commit c10
  const failed = ['G7 tests/test_x.py::test_y']

  // When: 分别生成整合修复体与专审评审员提示词
  const [fix, review] = [
    integFixerPrompt({ change: 'demo', changeDir: CHANGE_DIR, failed, base: 'c9' }),
    integReviewPrompt({ change: 'demo', changeDir: CHANGE_DIR, base: 'c9', commit: 'c10' }),
  ]

  // Then: 修复体含 tests/test_x.py::test_y、scenario、xfail、owns、先有失败测试、起点 c9；评审员含 git diff c9 c10、改弱测试、submit_findings
  for (const s of ['tests/test_x.py::test_y', 'scenario', 'xfail', 'owns', '先有失败测试', 'c9']) expect(fix).toContain(s)
  for (const s of ['git diff c9 c10', '改弱测试', 'submit_findings']) expect(review).toContain(s)
})

// 护栏（flight-armed-takeoff：flight-integ-fix#integ-prompts-spec-given）：按 spec 原样的多行失败项
test('integ-prompts-state-guards/spec-given', async () => {
  // Given: change demo；failed 为 spec 原样的多行项「G2 test: exit 1（新增 1 条失败）\ntests/test_x.py::test_y」；整合修复起点 base c9
  const failed = ['G2 test: exit 1（新增 1 条失败）\ntests/test_x.py::test_y']

  // When: 生成整合修复体提示词
  const fix = integFixerPrompt({ change: 'demo', changeDir: CHANGE_DIR, failed, base: 'c9' })

  // Then: 多行项首行与第二行都在，并含 scenario、xfail、owns、先有失败测试
  for (const s of ['G2 test: exit 1（新增 1 条失败）', 'tests/test_x.py::test_y', 'scenario', 'xfail', 'owns', '先有失败测试']) expect(fix).toContain(s)
})

test('triage-prompt-and-agent', async () => {
  // Given: change demo、hooksDir /r/.claude/hooks、停飞原因「切片 blocked：S4（G1 verify: exit 1）」、kind blocked
  const x = { change: 'demo', changeDir: CHANGE_DIR, hooksDir: '/r/.claude/hooks', reason: '切片 blocked：S4（G1 verify: exit 1）', kind: 'blocked' }

  // When: 生成诊断员提示词
  const prompt = triagePrompt(x)

  // Then: 含停飞原因、blocked、只读、ledger.py show 与 timeline.py report 全路径、改计划 / 修插件 / 人工操作与「首行」
  for (const s of [
    x.reason,
    'blocked',
    '只读',
    `python3 /r/.claude/hooks/ledger.py show --change-dir ${CHANGE_DIR}`,
    `python3 /r/.claude/hooks/timeline.py report --change-dir ${CHANGE_DIR}`,
    '改计划',
    '修插件',
    '人工操作',
    '首行',
  ])
    expect(prompt).toContain(s)
})

test('replan-prompt-states-bounds', async () => {
  // Given: change demo、change 目录 template/openspec/changes/demo、判定器目录 /repo/template/.claude/hooks、attempt 2、
  //        triage 文本「S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py」
  const triage = 'S1 的 owns 漏了 tests/test_x.py\n改计划\nslices.json 的 S1 owns 加 tests/test_x.py'
  const x = { change: 'demo', changeDir: CHANGE_DIR, hooksDir: '/repo/template/.claude/hooks', attempt: 2, triage }

  // When: 生成修订请求
  const prompt = replanPrompt(x)

  // Then: 含 demo、attempt 2 与 triage 全文；含「只改本 change 的计划工件」「不改生产代码」；含 spec_html.py 与 slice-gate.py lint 的全路径命令；
  //       含「不要发 /opsx-apply」「/flight resume」「批准修订并续飞」与「不硬改」
  for (const s of [
    'demo',
    'attempt 2',
    triage,
    '只改本 change 的计划工件',
    '不改生产代码',
    `/repo/template/.claude/hooks/spec_html.py --change-dir ${CHANGE_DIR}`,
    `/repo/template/.claude/hooks/slice-gate.py lint --change-dir ${CHANGE_DIR}`,
    '不要发 /opsx-apply',
    '/flight resume',
    '批准修订并续飞',
    '不硬改',
  ])
    expect(prompt).toContain(s)
})
