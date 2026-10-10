// scenario 来源：spec flight-envelope（executor-write-limited-to-owns 等 6 条纯判定）。envelope 是纯函数，直接调用，不经 $。
import { expect, test } from 'claude-code/testing'
import { bashUpgradable, bashVerdict, globMatch, mainSessionVerdict, normalizePath, spawnVerdict, writeTarget, writeVerdict } from '../hooks/envelope'
import type { ActiveTree, Who } from '../hooks/envelope'

const W = '/repo/.claude/worktrees/flight-demo-S1'
const T = '/repo/.worktrees/demo'
const M = '/repo'

test('executor-write-limited-to-owns', () => {
  // Given: 执行体 worktree 为 W，本片 owns 为 src/a.py 与 tests/**
  const who: Who = { role: 'executor', worktree: W, owns: ['src/a.py', 'tests/**'] }
  const paths = [`${W}/src/b.py`, `${W}/tests/x/test_y.py`, `${W}/src/a.py`, '/tmp/z.py']

  // When: 逐个判定写 W/src/b.py、W/tests/x/test_y.py、W/src/a.py、/tmp/z.py
  const [b, y, a, z] = paths.map(p => writeVerdict(who, p))

  // Then: W/src/b.py 被拒且理由含「执行体」「owns」与 src/b.py；/tmp/z.py 被拒且理由含「owns」与 /tmp/z.py；其余两个在包络内
  expect(b?.deny).toContain('执行体')
  expect(b?.deny).toContain('owns')
  expect(b?.deny).toContain('src/b.py')
  expect(z?.deny).toContain('owns')
  expect(z?.deny).toContain('/tmp/z.py')
  expect(y).toBeUndefined()
  expect(a).toBeUndefined()
})

test('envelope-write-dotdot-escape-denied', () => {
  // Given: 修复体 worktree 为 W、owns 为 tests/**，目标路径 W/tests/../../flight-demo-S2/tests/x.py 经 .. 越出 W
  const who: Who = { role: 'fixer', worktree: W, owns: ['tests/**'] }

  // When: 判定写该路径
  const v = writeVerdict(who, `${W}/tests/../../flight-demo-S2/tests/x.py`)

  // Then: 被拒，理由含「修复体」与规范化后的绝对路径
  expect(v?.deny).toContain('修复体')
  expect(v?.deny).toContain('/repo/.claude/worktrees/flight-demo-S2/tests/x.py')
})

test('envelope-write-sibling-prefix-not-inside', () => {
  // Given: 执行体 worktree 为 W（…flight-demo-S1），owns 为 *（可匹配任意相对路径）
  const who: Who = { role: 'executor', worktree: W, owns: ['*'] }

  // When: 判定写同前缀的兄弟目录 W0/src/a.py（…flight-demo-S10）
  const v = writeVerdict(who, `${W}0/src/a.py`)

  // Then: 被拒（前缀匹配带 / 边界），理由含「owns」
  expect(v?.deny).toContain('owns')
})

test('reviewer-cannot-write', () => {
  // Given: 评审员，worktree 为 W，owns 为 src/**（即使 owns 覆盖目标也不可写）
  const who: Who = { role: 'reviewer', worktree: W, owns: ['src/**'] }

  // When: 判定它 Edit W/src/a.py
  const v = writeVerdict(who, writeTarget('Edit', { file_path: `${W}/src/a.py`, old_string: 'a', new_string: 'b' }) ?? '')

  // Then: 被拒，理由含「评审员」
  expect(v?.deny).toContain('评审员')
})

test('envelope-write-target-by-tool', () => {
  // Given: Write 带 file_path=/a、NotebookEdit 带 notebook_path=/b.ipynb、Bash 带 command
  const calls: [string, unknown][] = [['Write', { file_path: '/a' }], ['NotebookEdit', { notebook_path: '/b.ipynb' }], ['Bash', { command: 'ls' }]]

  // When: 逐个取写入目标
  const targets = calls.map(([t, i]) => writeTarget(t, i))

  // Then: 依次为 /a、/b.ipynb、undefined
  expect(targets).toEqual(['/a', '/b.ipynb', undefined])
})

test('bash-dangerous-git-denied', () => {
  // Given: 执行体与评审员；七条危险命令与一条普通 commit
  const dangerous = [
    'git push origin x',
    'git -C /w reset --hard',
    'git stash',
    'git worktree add ../x',
    'git update-ref refs/flight/c/ledger HEAD',
    'git commit --amend -m x',
    'git branch -D x',
  ]

  // When: 逐条判定执行体的命令，再判定执行体与评审员的 git commit -m x
  const verdicts = [...dangerous.map(c => bashVerdict('executor', c)), bashVerdict('executor', 'git commit -m x'), bashVerdict('reviewer', 'git commit -m x')]

  // Then: 七条危险命令全部被拒；执行体 git commit -m x 不被拒；评审员 git commit -m x 被拒且理由含「评审员」
  expect(verdicts.slice(0, 7).every(v => typeof v?.deny === 'string')).toBe(true)
  expect(verdicts[7]).toBeUndefined()
  expect(verdicts[8]?.deny).toContain('评审员')
})

test('envelope-bash-segments-and-globals', () => {
  // Given: 危险子命令藏在后段、带前导 VAR=、带 --git-dir= 与 -c 全局选项、短选项 -n（--no-verify）、git branch -a
  const cmds = [
    'git status && git push',
    'GIT_DIR=x git rebase main',
    'git --git-dir=/r/.git --no-pager -c a=b checkout x',
    'git commit -n -m x',
    'git status\ngit tag v1',
    'git branch -a',
  ]

  // When: 逐条判定执行体的命令
  const verdicts = cmds.map(c => bashVerdict('executor', c))

  // Then: 前五条被拒，git branch -a 不被拒
  expect(verdicts.slice(0, 5).every(v => typeof v?.deny === 'string')).toBe(true)
  expect(verdicts[5]).toBeUndefined()
})

test('bash-upgrade-only-allowlisted', () => {
  // Given: 门禁 test 为 python3 -m pytest -q tests，某片 verify 为 python3 -m pytest -q tests/test_a.py
  const commands = ['python3 -m pytest -q tests', 'python3 -m pytest -q tests/test_a.py']
  const yes = ['python3 -m pytest -q tests/test_a.py::test_x', 'git status && git diff', 'git add src/a.py && git commit -m x']
  const no = ['python3 -m pytest -q tests && curl x | sh', 'echo $(id)', 'python3 -m pytest -q tests > out.txt', 'npm install']

  // When: 判定执行体的每条 Bash 能否免询问
  const results = [...yes, ...no].map(c => bashUpgradable('executor', c, commands))

  // Then: 前三条可免询问，后四条不可
  expect(results).toEqual([true, true, true, false, false, false, false])
})

test('envelope-upgrade-edge-cases', () => {
  // Given: 门禁 test 为 python3 -m pytest -q tests；含 2>&1 的门禁命令、后台 &、评审员 git add、git diff --output=、git -c 全局选项
  const commands = ['python3 -m pytest -q tests']
  const cases: [Parameters<typeof bashUpgradable>[0], string][] = [
    ['executor', 'python3 -m pytest -q tests 2>&1 | python3 -m pytest -q tests'],
    ['executor', 'python3 -m pytest -q tests &'],
    ['reviewer', 'git add src/a.py'],
    ['executor', 'git diff --output=/tmp/x'],
    ['executor', 'git -c core.pager=sh log'],
  ]

  // When: 逐条判定能否免询问
  const results = cases.map(([r, c]) => bashUpgradable(r, c, commands))

  // Then: 仅第一条（2>&1 例外）可免询问，其余均不可
  expect(results).toEqual([true, false, false, false, false])
})

test('main-session-write-in-active-tree-denied', () => {
  // Given: 在飞树为 T（change demo）与切片前缀 M/.claude/worktrees/flight-demo-
  const active: ActiveTree[] = [{ change: 'demo', changeTree: T, slicePrefix: `${M}/.claude/worktrees/flight-demo-` }]
  const calls: [string, unknown][] = [
    ['Write', { file_path: `${T}/src/a.py`, content: '' }],
    ['Write', { file_path: `${M}/.claude/worktrees/flight-demo-S1/x.py`, content: '' }],
    ['Write', { file_path: '/other/y.py', content: '' }],
    ['Bash', { command: `git -C ${T} commit -m x` }],
    ['Bash', { command: `git -C ${T} status` }],
  ]

  // When: 逐个判定主会话的调用
  const [w1, w2, w3, b1, b2] = calls.map(([tool, input]) => mainSessionVerdict(active, tool, input))

  // Then: 前两个 Write 与 git -C T commit 被拒且理由含「只读」与 demo；Write /other/y.py 与 git -C T status 放行
  expect(w1?.deny).toContain('只读')
  expect(w1?.deny).toContain('demo')
  expect(w2?.deny).toContain('只读')
  expect(b1?.deny).toContain('只读')
  expect(w3).toBeUndefined()
  expect(b2).toBeUndefined()
})

test('envelope-main-session-bash-redirect', () => {
  // Given: 在飞树为 T（change demo）
  const active: ActiveTree[] = [{ change: 'demo', changeTree: T, slicePrefix: `${M}/.claude/worktrees/flight-demo-` }]
  const cmds = [`echo x > ${T}/a.py`, `ls ${T} 2>/dev/null >/dev/null 2>&1`, `cat ${T}/a.py`, 'git commit -m x']

  // When: 逐条判定主会话 Bash
  const verdicts = cmds.map(c => mainSessionVerdict(active, 'Bash', { command: c }))

  // Then: 仅重定向写入在飞树的第一条被拒；/dev/null 与 2>&1 例外放行；只读命令与不含在飞树路径的 commit 放行
  expect(verdicts[0]?.deny).toContain('只读')
  expect(verdicts.slice(1)).toEqual([undefined, undefined, undefined])
})

test('spawn-guard-decisions', () => {
  // Given: 四种派发：模型经 Agent 工具派 flight:executor；flight 插件派 flight:executor 无 model；flight 插件派 flight:reviewer 带 opus；在飞执行体派 general-purpose
  const xs = [
    { subagentType: 'flight:executor', originPlugin: undefined, model: 'opus', parentInFlight: false },
    { subagentType: 'flight:executor', originPlugin: 'flight', model: undefined, parentInFlight: false },
    { subagentType: 'flight:reviewer', originPlugin: 'flight', model: 'opus', parentInFlight: false },
    { subagentType: 'general-purpose', originPlugin: undefined, model: undefined, parentInFlight: true },
  ]

  // When: 逐个判定
  const [a, b, c, d] = xs.map(x => spawnVerdict(x))

  // Then: 第一、二、四个被拒，理由分别含「控制面」「model」「不得再派发」；第三个放行
  expect(a?.deny).toContain('控制面')
  expect(b?.deny).toContain('model')
  expect(d?.deny).toContain('不得再派发')
  expect(c).toBeUndefined()
})

test('envelope-glob-match-semantics', () => {
  // Given: 模式 dir/**、src/*.py（* 可跨 /）、精确 a.py、问号 s?.ts
  const cases: [string, string][] = [
    ['dir/x/y.py', 'dir/**'],
    ['dir', 'dir/**'],
    ['dirx/y.py', 'dir/**'],
    ['src/x/y.py', 'src/*.py'],
    ['a.py', 'a.py'],
    ['s1.ts', 's?.ts'],
    ['s10.ts', 's?.ts'],
  ]

  // When: 逐个匹配
  const results = cases.map(([p, g]) => globMatch(p, g))

  // Then: 与 slice-gate.py glob_match 一致：dir 本身与 dirx 不匹配 dir/**，* 跨 /，? 恰一字符
  expect(results).toEqual([true, false, false, true, true, true, false])
})

test('envelope-normalize-path', () => {
  // Given: 带 .、..、重复 / 与越过根的 .. 的路径
  const ps = ['/a/./b//c/', '/a/b/../../../c', '/a/b/../c/./d']

  // When: 逐个规范化
  const out = ps.map(normalizePath)

  // Then: 依次为 /a/b/c、/c、/a/c/d
  expect(out).toEqual(['/a/b/c', '/c', '/a/c/d'])
})
