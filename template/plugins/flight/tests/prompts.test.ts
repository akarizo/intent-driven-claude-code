import { expect, test } from 'claude-code/testing'

import { executorPrompt, fixerPrompt, followupReviewPrompt, resolverPrompt, reviewerPrompt, wholeReviewPrompt } from '../hooks/prompts.ts'

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
