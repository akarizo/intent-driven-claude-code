// scenario 来源：spec flight-envelope（executor-write-limited-to-owns 等 6 条纯判定）。envelope 是纯函数，直接调用，不经 $。
import { expect, test } from 'claude-code/testing'
import { bashUpgradable, bashVerdict, globMatch, inWorktree, mainSessionVerdict, normalizePath, readUpgradable, spawnVerdict, writeTarget, writeVerdict } from '../hooks/envelope'
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

test('spawn-guard-exempts-plugin-own-dispatch', () => {
  // Given: 父 agent 属于在飞飞行（parentInFlight 为 true）：插件在它收口或 turn.complete 的帧里接着派发
  const parentInFlight = true

  // When: flight 插件带 model 派发 flight:reviewer、flight:executor；引擎来源（模型的 Agent 工具）派发 general-purpose
  const reviewer = spawnVerdict({ subagentType: 'flight:reviewer', originPlugin: 'flight', model: 'opus', parentInFlight })
  const executor = spawnVerdict({ subagentType: 'flight:executor', originPlugin: 'flight', model: 'opus', parentInFlight })
  const child = spawnVerdict({ subagentType: 'general-purpose', originPlugin: 'engine', model: 'opus', parentInFlight })

  // Then: 插件自己的两次派发放行；引擎来源的派发被拒，理由含「不得再派发」
  expect(reviewer).toBeUndefined()
  expect(executor).toBeUndefined()
  expect(child).toMatchObject({ deny: expect.stringContaining('不得再派发') })
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

// ---------------------------------------------------------------- spec flight-envelope-tightening（S1）

test('bash-wrap-pins-worktree', () => {
  // Given: 执行体 worktree 为 /r/.claude/worktrees/flight-demo-S1，门禁 test 为 python3 -m pytest -q tests；另一 worktree /r/it's 含单引号
  const wt = '/r/.claude/worktrees/flight-demo-S1'
  const commands = ['python3 -m pytest -q tests']
  const once = `cd '${wt}' && git commit -m x`

  // When: 改写 git commit -m x、改写已改写的结果、改写 /r/it's 下的 ls，并判定改写后的门禁命令能否免询问
  const [first, second, quoted] = [['git commit -m x', wt], [once, wt], ['ls', "/r/it's"]].map(([c, w]) => inWorktree(c, w))
  const upgradable = bashUpgradable('executor', inWorktree('python3 -m pytest -q tests', wt), commands, wt, '/r')

  // Then: 第一次结果为 cd '<worktree>' && git commit -m x；二次改写不变；单引号转义为 '\''；改写后的门禁命令可免询问
  expect(first).toBe(once)
  expect(second).toBe(once)
  expect(quoted).toBe("cd '/r/it'\\''s' && ls")
  expect(upgradable).toBe(true)
})

test('mutating-git-must-target-own-worktree', () => {
  // Given: 执行体 worktree 为 W，主仓库为 M，change worktree 为 T（M/.worktrees/demo）；六条 git 命令
  const cmds = [
    `git -C ${W} commit -m x`,
    'git commit -m x',
    `git -C ${T} commit -m x`,
    `cd ${T} && git add a.py`,
    'git -C sub commit -m x',
    `git -C ${T} log`,
  ]

  // When: 逐条判定执行体的命令（带 worktree 与 mainTree）
  const v = cmds.map(c => bashVerdict('executor', c, W, M))

  // Then: 第三、四、五个被拒且理由含「自己的 worktree」；第一、二、六个不被拒
  expect(v[2]?.deny).toContain('自己的 worktree')
  expect(v[3]?.deny).toContain('自己的 worktree')
  expect(v[4]?.deny).toContain('自己的 worktree')
  expect([v[0], v[1], v[5]]).toEqual([undefined, undefined, undefined])
})

test('deny-table-gaps-closed', () => {
  // Given: 执行体；七条应拒的命令与一条只读的 git config --get user.name
  const cmds = [
    'git pull',
    'git config core.hooksPath /x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c CORE.HOOKSPATH=/x commit -m x',
    'git --config-env=core.hooksPath=X commit -m x',
    'git commit --am -m x',
    'git branch --d x',
    'git config --get user.name',
  ]

  // When: 逐条判定执行体的命令（不带 worktree）
  const v = cmds.map(c => bashVerdict('executor', c))

  // Then: 前七个被拒；git config --get user.name 不被拒
  expect(v.slice(0, 7).every(x => typeof x?.deny === 'string')).toBe(true)
  expect(v[7]).toBeUndefined()
})

test('stdin-scripts-and-heredoc-denied', () => {
  // Given: 执行体；五条读标准输入或 heredoc 的命令与一条运行脚本文件的命令
  const cmds = ['python3 -', "python3 - <<'EOF'", 'bash -s', 'python3 /dev/stdin', 'cat > a.py <<EOF', 'python3 scripts/x.py']

  // When: 逐条判定执行体的命令
  const v = cmds.map(c => bashVerdict('executor', c))

  // Then: 前五个被拒且理由含「脚本文件」或「Write」；python3 scripts/x.py 不被拒
  expect(v.slice(0, 5).every(x => /脚本文件|Write/.test(x?.deny ?? ''))).toBe(true)
  expect(v[5]).toBeUndefined()
})

test('upgrade-refuses-env-prefix-and-outside-git', () => {
  // Given: 执行体 worktree 为 W，主仓库为 M；五条 git 命令，门禁命令为空
  const cmds = [
    'GIT_EXTERNAL_DIFF=/x git diff',
    `GIT_DIR=/o git -C ${W} commit -m x`,
    'git -C /tmp/other log',
    `git -C ${W} diff`,
    `git -C ${T} log`,
  ]

  // When: 逐条判定能否免询问
  const results = cmds.map(c => bashUpgradable('executor', c, [], W, M))

  // Then: 前三个不可免询问，后两个可免询问
  expect(results).toEqual([false, false, false, true, true])
})

test('read-upgrade-limited-to-repo', () => {
  // Given: 主仓库为 /r，执行体 worktree 为 /r/.claude/worktrees/flight-demo-S1；五个读取调用
  const wt = '/r/.claude/worktrees/flight-demo-S1'
  const calls: [string, unknown][] = [
    ['Read', { file_path: `${wt}/a.py` }],
    ['Read', { file_path: '/r/template/x.md' }],
    ['Read', { file_path: '/Users/u/.ssh/id_rsa' }],
    ['Grep', { pattern: 'x' }],
    ['Glob', { pattern: '*', path: '/etc' }],
  ]

  // When: 逐个判定能否免询问
  const results = calls.map(([tool, input]) => readUpgradable(tool, input, wt, '/r'))

  // Then: 前两个 Read 与 Grep 可免询问；~/.ssh 与 /etc 不可
  expect(results).toEqual([true, true, false, true, false])
})

// ---------------------------------------------------------------- spec flight-envelope-gaps（flight-measure S4）

test('interpreter-wrappers-checked', () => {
  // Given: 执行体 worktree 为 W；五条经 bash -c / sh -lc / eval 包住的危险命令与一条包住 pytest 的命令
  const cmds = [
    "bash -c 'git push origin HEAD:main'",
    'sh -lc "git reset --hard"',
    'eval git push',
    "cd /repo && bash -c 'git commit -m x'",
    "bash -c 'cd /repo; git commit -m x'",
    "bash -c 'python3 -m pytest -q'",
  ]

  // When: 逐条判定执行体的命令（带 worktree 与 mainTree）
  const v = cmds.map(c => bashVerdict('executor', c, W, M))

  // Then: 前三条理由依次含 git push、git reset、git push；第四条含「自己的 worktree」；第五条含「无法判定」与「-c / eval」；最后一条不被拒
  expect(v[0]?.deny).toContain('git push')
  expect(v[1]?.deny).toContain('git reset')
  expect(v[2]?.deny).toContain('git push')
  expect(v[3]?.deny).toContain('自己的 worktree')
  expect(v[4]?.deny).toContain('无法判定')
  expect(v[4]?.deny).toContain('-c / eval')
  expect(v[5]).toBeUndefined()
})

test('cd-variants-tracked', () => {
  // Given: 执行体 worktree 为 W，主仓库为 /repo；四条换目录到 W 以外（或 popd 后无法判定）再做改动类 git 的命令，与一条 builtin cd W 后 commit
  const cmds = [
    'pushd /repo && git commit -m x',
    'builtin cd /repo && git commit -m x',
    'command cd /repo && git add a',
    `pushd ${W}/sub && popd && git commit -m x`,
    `builtin cd ${W} && git commit -m x`,
  ]

  // When: 逐条判定执行体的命令（带 worktree 与 mainTree）
  const v = cmds.map(c => bashVerdict('executor', c, W, M))

  // Then: 前四条被拒且理由含「自己的 worktree」；最后一条不被拒
  expect(v.slice(0, 4).every(x => (x?.deny ?? '').includes('自己的 worktree'))).toBe(true)
  expect(v[4]).toBeUndefined()
})

test('git-env-overrides-denied', () => {
  // Given: 执行体 worktree 为 W；五条借 GIT_* 环境变量改变作用对象的改动类 git，与一条 GIT_PAGER=cat git log -1
  const cmds = [
    'GIT_DIR=/repo/.git git commit -m x',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'env GIT_WORK_TREE=/repo git add a',
    'export GIT_DIR=/repo/.git && git commit -m x',
    'GIT_INDEX_FILE=/tmp/i; git add a',
    'GIT_PAGER=cat git log -1',
  ]

  // When: 逐条判定执行体的命令（带 worktree 与 mainTree）
  const v = cmds.map(c => bashVerdict('executor', c, W, M))

  // Then: 前五条被拒且理由含「GIT_」；最后一条不被拒
  expect(v.slice(0, 5).every(x => (x?.deny ?? '').includes('GIT_'))).toBe(true)
  expect(v[5]).toBeUndefined()
})

test('shared-config-writers-denied', () => {
  // Given: 执行体 worktree 为 W；五条写共享 config 或移动 ref 的命令与三条只读命令
  const cmds = [
    'git fetch . HEAD:refs/heads/main',
    'git remote add x /tmp/x',
    'git remote set-url origin /tmp/x',
    'git branch -u origin/main',
    'git branch --set-upstream-to=origin/main',
    'git remote -v',
    'git remote get-url origin',
    'git branch --list',
  ]

  // When: 逐条判定执行体的命令（带 worktree 与 mainTree）
  const v = cmds.map(c => bashVerdict('executor', c, W, M))

  // Then: 前五条被拒，理由依次含 git fetch、git remote、git remote、git branch、git branch；后三条不被拒
  expect(v.slice(0, 5).map(x => x?.deny ?? '').map((d, i) => d.includes(['git fetch', 'git remote', 'git remote', 'git branch', 'git branch'][i]))).toEqual([true, true, true, true, true])
  expect(v.slice(5)).toEqual([undefined, undefined, undefined])
})

test('glob-pattern-cannot-escape', () => {
  // Given: 主仓库 /repo，执行体 worktree W 在其内；Glob 的绝对 pattern、含 .. 的 pattern 与 path=W 的相对 pattern
  const calls: unknown[] = [{ pattern: '/etc/**' }, { pattern: '../../**/*.pem' }, { path: W, pattern: '**/*.ts' }]

  // When: 逐个判定 Glob 能否免询问
  const results = calls.map(input => readUpgradable('Glob', input, W, M))

  // Then: 前两个不免询问，第三个免询问
  expect(results).toEqual([false, false, true])
})
