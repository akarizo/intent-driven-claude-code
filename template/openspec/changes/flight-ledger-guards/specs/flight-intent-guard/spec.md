## ADDED Requirements

### Requirement: 意图判定可由插件调用
`intent-gate.py check --cwd <C> <PATH>…` SHALL 对每个路径做与 classic 模式相同的判定，stdout SHALL 为 `{"allow": bool, "denied": [{"path", "reason"}]}` 并退出 0；判定异常 SHALL 退出 2。classic 模式（读 stdin）SHALL 保持输出形状，异常时 SHALL 仍放行。
Feature: 用户定（2026-10-13）：D2-A intent-gate.py 改成纯判定

#### Scenario: intent-check-cli
- **GIVEN** 仓库根有 `openspec/`，没有任何 change；仓库在分支 main
- **WHEN** 运行 `intent-gate.py check --cwd <root> src/x.py docs/a.md /tmp/elsewhere.py`；再以 `{"tool_input": {"file_path": "<root>/src/x.py"}, "cwd": "<root>"}` 运行 classic 模式；再以非 JSON 的 stdin 运行 classic 模式
- **THEN** check 退出 0，allow 为 false，denied 恰为一项，path 为 `<root>/src/x.py`
- **AND** classic 模式输出 `permissionDecision` 为 deny 的 PreToolUse JSON
- **AND** 非 JSON 的 stdin 退出 0，输出为空

### Requirement: apply 上下文只认目标所在 worktree 的 change
目标所在 git toplevel 的当前分支形如 `worktree-<name>` 或 `flight/<name>/…` 时，SHALL 只有 change `<name>` 的 `tasks.md` 有未勾项才放行源码，否则 SHALL 拒绝并说明原因；其他分支 SHALL 沿用「任一 change 有未勾项」。`.openspec-slice` SHALL NOT 影响判定。
Feature: 用户定（2026-10-13）：D2-A；铁律 1「只能加严」

#### Scenario: apply-context-scoped-to-change
- **GIVEN** 一个仓库：`openspec/changes/a` 的 tasks.md 有未勾项，`openspec/changes/b` 的 tasks.md 全部勾选
- **AND** 四个 worktree 的分支分别为 `worktree-b`、`flight/a/S1`、`main`、`worktree-c`（没有 change c）
- **AND** `worktree-b` 的根目录另有遗留 `.openspec-slice`，内容指向 change a 与 owns `src/**`
- **WHEN** 在每个 worktree 里 check `src/x.py`
- **THEN** `worktree-b` 被拒，原因含「change b 没有未完成的任务」
- **AND** `flight/a/S1` 放行
- **AND** `main` 放行（change a 未完成）
- **AND** `worktree-c` 被拒，原因含「change c」

### Requirement: 识别 Bash 的写入目标
`bashWriteTargets(command, cwd)` SHALL 按 design D6 识别重定向、tee、sed -i、perl -i、cp / mv / install / ln、touch / rm / rmdir / mkdir / truncate、dd of= 的写入目标，SHALL 按命令内的 cd 与 cwd 解析为绝对路径，SHALL 排除 fd 复制与 /dev 下的特殊文件，SHALL 不把引号内的 `>` 当重定向，SHALL 把含 `$`、反引号、通配符或以 `~` 开头的目标放进 unresolved。
Feature: 用户定（2026-10-13）：D2-A 覆盖 Bash 的写法

#### Scenario: bash-write-targets
- **GIVEN** cwd 为 `/w`
- **WHEN** 对下列命令求 `bashWriteTargets`：
  1. `echo hi > a.txt`
  2. `echo hi >> logs/b.log 2>/dev/null`
  3. `make 2>&1 | tee -a c.txt d.txt`
  4. `sed -i '' -e 's/x/y/' e.py`
  5. `sed -i.bak 's/x/y/' f.py g.py`
  6. `cp -r src dst/`
  7. `cd sub && touch h && rm -f i`
  8. `echo '>' j`
  9. `ls >&2`
  10. `python3 tool.py > out.json`
  11. `dd if=a of=k.bin`
  12. `echo x > $OUT`
  13. `git status`
- **THEN** 1–11 的 targets 依次为：
  1. `[/w/a.txt]`
  2. `[/w/logs/b.log]`
  3. `[/w/c.txt, /w/d.txt]`
  4. `[/w/e.py]`
  5. `[/w/f.py, /w/g.py]`
  6. `[/w/dst]`
  7. `[/w/sub/h, /w/sub/i]`
  8. `[]`
  9. `[]`
  10. `[/w/out.json]`
  11. `[/w/k.bin]`
- **AND** 12 的 targets 为空，unresolved 为 `["$OUT"]`
- **AND** 13 的 targets 与 unresolved 都为空

### Requirement: 飞行 agent 的 Bash 写入限在 owns 内
`bashWritesVerdict(who, command)` SHALL 对飞行 agent 的 Bash 命令取写入目标，并按 Write / Edit 的同一口径（本 worktree、本片 owns、评审员不写）判定；unresolved 非空时 SHALL 拒绝。包络 SHALL 在 `bashVerdict` 通过后对 Bash 再走这一判定。
Feature: 用户定（2026-10-13）：D2-A 飞行中按 agentId 套用切片 owns

#### Scenario: flight-agent-bash-writes-within-owns
- **GIVEN** 执行体 E（S1，owns `src/a/**`，worktree `/wt/S1`）与评审员 R
- **WHEN** 分别判定：
  - E：`echo x > src/a/y.py`、`echo x > src/b/z.py`、`echo x > "$OUT"`、`sed -i 's/a/b/' src/a/y.py`；
  - R：`echo x > notes.txt`
- **THEN** E 的第一条与第四条放行
- **AND** E 的第二条被拒，原因含 `src/b/z.py` 与 owns
- **AND** E 的第三条被拒，原因含「写入目标无法静态判定」
- **AND** R 的命令被拒

### Requirement: 意图判定模块
`intent.ts` 的 `toolTargets` SHALL 取 Write / Edit 的 `file_path`、NotebookEdit 的 `notebook_path`、Bash 的写入目标（相对路径按 cwd 解析），其他工具为空；`intentVerdict` SHALL 在目标为空时不运行任何命令，否则 SHALL 只运行一次 `python3 <hooksDir>/intent-gate.py check --cwd <cwd> <targets…>`，按 design D6 返回放行、逐条拒绝或「判定失败」拒绝。
Feature: 用户定（2026-10-13）：D2-A 插件在 tool.call 调同一个 Python 判定

#### Scenario: intent-verdict-module
- **GIVEN** 假 Io 按 argv 应答：
  - 世界一：check 输出 `{"allow": false, "denied": [{"path": "/r/src/x.py", "reason": "没有 apply 上下文"}]}`；
  - 世界二：check 以 2 退出，stderr「Traceback boom」；
  - 世界三：check 输出 `{"allow": true, "denied": []}`
- **WHEN** 求：
  - `toolTargets('Write', {file_path: 'src/x.py'}, '/r')`；
  - `toolTargets('Bash', {command: 'ls -la'}, '/r')`；
  - `toolTargets('Read', {file_path: 'a'}, '/r')`；
  - 用目标 `[]` 调一次 `intentVerdict`；
  - 用目标 `['/r/src/x.py']` 在三个世界各调一次 `intentVerdict`
- **THEN** 三次 `toolTargets` 依次为 `['/r/src/x.py']`、`[]`、`[]`
- **AND** 目标为空的那次没有运行任何命令，返回 undefined
- **AND** 世界一运行的 argv 恰为 `python3 <hooksDir>/intent-gate.py check --cwd /r /r/src/x.py`，返回的 deny 含「/r/src/x.py」与「没有 apply 上下文」
- **AND** 世界二返回的 deny 含「意图门禁判定失败」与「Traceback boom」
- **AND** 世界三返回 undefined

### Requirement: 主会话与非飞行 agent 的写入经意图判定
`tool.call` SHALL 对主会话与非飞行 agent 的 Write、Edit、NotebookEdit、Bash，在现有检查通过后，以 `$.session.cwd()` 与会话所在仓库主检出的判定器目录调用 `intentVerdict`，拒绝时 SHALL deny；找不到判定器目录时 SHALL 放行且不运行判定；飞行 agent SHALL NOT 调用意图判定。
Feature: 用户定（2026-10-13）：D2-A

#### Scenario: main-session-writes-checked
- **GIVEN** 会话 cwd 为主检出 `/repo`，其判定器在 `/repo/template/.claude/hooks`；check 对 `/repo/src/x.py` 与 `/repo/src/y.py` 判拒绝
- **AND** 另一个世界的会话 cwd 里找不到判定器
- **WHEN** 依次发起：
  - 主会话 Write `src/x.py`；
  - 主会话 Bash `echo x > src/y.py`；
  - 主会话 Bash `ls`；
  - 一个非飞行 agent 的 Write `src/x.py`；
  - 在飞执行体在本 worktree 内对 owns 内文件的 Write；
  - 第二个世界里主会话的 Write `src/x.py`
- **THEN** 前两次被拒，原因含对应路径，check 的 argv 分别以 `/repo/src/x.py`、`/repo/src/y.py` 结尾
- **AND** `ls` 放行，没有运行 check
- **AND** 非飞行 agent 的 Write 被拒
- **AND** 执行体的 Write 放行，没有运行 check
- **AND** 第二个世界的 Write 放行，没有运行 check
