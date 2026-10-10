import { expect, test } from 'claude-code/testing'

import { executorPrompt, fixerPrompt, resolverPrompt, reviewerPrompt } from '../hooks/prompts.ts'

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
