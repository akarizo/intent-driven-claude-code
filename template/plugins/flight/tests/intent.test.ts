// scenario 来源：spec flight-intent-guard（intent-verdict-module）。intent.ts 只经 Io 做副作用，这里用假 Io 记下全部 argv、按世界作答。
import { expect, test } from 'claude-code/testing'
import { intentVerdict, toolTargets } from '../hooks/intent'
import type { Io, RunResult } from '../hooks/core'

const HOOKS = '/h'

/** 假 Io：run 记下 argv，按给定的结果作答；读写文件不应被调用 */
function fakeIo(result: Partial<RunResult>) {
  const calls: string[][] = []
  const io: Io = {
    async run(argv) {
      calls.push([...argv])
      return { exitCode: 0, stdout: '', stderr: '', ...result }
    },
    async read() {
      return undefined
    },
    async write() {},
    async exists() {
      return false
    },
  }
  return { io, calls }
}

test('intent-verdict-module', async () => {
  // Given: 四个假 Io：
  //   空世界（任何调用都记下）；
  //   世界一 check 输出 {"allow": false, "denied": [{"path": "/r/src/x.py", "reason": "没有 apply 上下文"}]}；
  //   世界二 check 以 2 退出、stderr 为「Traceback boom」；
  //   世界三 check 输出 {"allow": true, "denied": []}
  const empty = fakeIo({})
  const w1 = fakeIo({ stdout: JSON.stringify({ allow: false, denied: [{ path: '/r/src/x.py', reason: '没有 apply 上下文' }] }) + '\n' })
  const w2 = fakeIo({ exitCode: 2, stderr: 'Traceback boom\n  File "x"' })
  const w3 = fakeIo({ stdout: '{"allow": true, "denied": []}\n' })

  // When: 求 toolTargets('Write', {file_path: 'src/x.py'}, '/r')、toolTargets('Bash', {command: 'ls -la'}, '/r')、toolTargets('Read', {file_path: 'a'}, '/r')；
  //   用目标 [] 在空世界调 intentVerdict；用目标 ['/r/src/x.py'] 在三个世界各调一次 intentVerdict
  const targets = [toolTargets('Write', { file_path: 'src/x.py' }, '/r'), toolTargets('Bash', { command: 'ls -la' }, '/r'), toolTargets('Read', { file_path: 'a' }, '/r')]
  const none = await intentVerdict(empty.io, HOOKS, '/r', [])
  const [v1, v2, v3] = await Promise.all([w1, w2, w3].map(w => intentVerdict(w.io, HOOKS, '/r', ['/r/src/x.py'])))

  // Then: 三次 toolTargets 依次为 ['/r/src/x.py']、[]、[]；
  //   空目标没有运行任何命令，返回 undefined；
  //   世界一运行的 argv 恰为 python3 /h/intent-gate.py check --cwd /r /r/src/x.py，deny 含「/r/src/x.py」与「没有 apply 上下文」；
  //   世界二 deny 含「意图门禁判定失败」与「Traceback boom」；
  //   世界三返回 undefined
  expect(targets).toEqual([['/r/src/x.py'], [], []])
  expect(empty.calls).toEqual([])
  expect(none).toBeUndefined()
  expect(w1.calls).toEqual([['python3', '/h/intent-gate.py', 'check', '--cwd', '/r', '/r/src/x.py']])
  expect(v1?.deny).toContain('/r/src/x.py')
  expect(v1?.deny).toContain('没有 apply 上下文')
  expect(v2?.deny).toContain('意图门禁判定失败')
  expect(v2?.deny).toContain('Traceback boom')
  expect(v3).toBeUndefined()
})
