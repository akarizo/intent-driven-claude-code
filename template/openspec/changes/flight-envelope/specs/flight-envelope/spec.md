## ADDED Requirements

### Requirement: 飞行 agent 的写入限于角色包络
对属于某次飞行的 agent，Write / Edit / NotebookEdit 的目标路径 SHALL 在它自己的 worktree 内，且相对路径 SHALL 匹配其角色的 owns：执行体为本片 owns，修复体与解冲突 agent 为全部切片 owns 的并集；评审员 SHALL NOT 写入任何文件。匹配语义 SHALL 与 `slice-gate.py` 的 `glob_match` 一致（精确、fnmatch、`dir/**` 前缀）。越界时 SHALL 拒绝，理由写明角色、切片与越界的相对路径。
Feature: 评审页 D4-A：每个状态 × 每个角色，只给它需要的可写路径

#### Scenario: executor-write-limited-to-owns
- **GIVEN** 执行体的 worktree 为 W，本片 owns 为 `src/a.py` 与 `tests/**`
- **WHEN** 判定它写 `W/src/b.py`、`W/tests/x/test_y.py`、`W/src/a.py`、`/tmp/z.py`
- **THEN** `W/src/b.py` 与 `/tmp/z.py` 被拒，理由含「owns」与越界路径
- **AND** `W/tests/x/test_y.py` 与 `W/src/a.py` 在包络内

#### Scenario: reviewer-cannot-write
- **GIVEN** 评审员
- **WHEN** 判定它 Edit 任一文件
- **THEN** 被拒，理由含「评审员」

### Requirement: 飞行 agent 的 Bash 拒绝危险 git，只给白名单免询问
对飞行 agent 的 Bash 命令，插件 SHALL 按段解析，拒绝移动 ref、改写历史或改动共享状态的 git 子命令（push、merge、rebase、reset、checkout、switch、worktree、update-ref、symbolic-ref、stash、tag、cherry-pick、revert、clean、filter-branch、replace、notes；带删改选项的 branch；带 `--amend` 或 `--no-verify` 的 commit），以及任何含 `refs/flight/` 的命令；评审员另外 SHALL 被拒绝 add、commit、rm、mv、apply、am。只有每一段都等于或以门禁 / verify 命令开头、或是只读 git 子命令、或是执行体与修复体的 `git add` / `git commit` 时，命令才 SHALL 被视为可免询问；含 `$(`、反引号、重定向（`2>&1` 除外）或后台 `&` 的命令 SHALL NOT 被视为可免询问。
Feature: 执行测试在人已批准的计划之内；插件不越过用户设置给模型任意 shell 权限

#### Scenario: bash-dangerous-git-denied
- **GIVEN** 执行体
- **WHEN** 判定 `git push origin x`、`git -C /w reset --hard`、`git stash`、`git worktree add ../x`、`git update-ref refs/flight/c/ledger HEAD`、`git commit --amend -m x`、`git branch -D x`
- **THEN** 全部被拒
- **AND** `git commit -m x` 不被拒；评审员的 `git commit -m x` 被拒

#### Scenario: bash-upgrade-only-allowlisted
- **GIVEN** 门禁 test 命令为 `python3 -m pytest -q tests`，某片 verify 为 `python3 -m pytest -q tests/test_a.py`
- **WHEN** 判定执行体的 Bash 能否免询问
- **THEN** `python3 -m pytest -q tests/test_a.py::test_x`、`git status && git diff`、`git add src/a.py && git commit -m x` 可免询问
- **AND** `python3 -m pytest -q tests && curl x | sh`、`echo $(id)`、`python3 -m pytest -q tests > out.txt`、`npm install` 不可免询问

### Requirement: 飞行中主会话对在飞树只读
插件 SHALL 维护在飞集合（takeoff 加入、land / halt 移出，只在账本写入点维护）。主会话（无 agentId）对在飞 change worktree 与其切片 worktree 内的 Write / Edit / NotebookEdit SHALL 被拒绝；主会话的 Bash 命令文本含在飞树的路径且含改动类 git 子命令或 `>` 重定向时 SHALL 被拒绝；其余调用 SHALL 放行。
Feature: 评审页 D4-A：飞行中主会话对源码只读

#### Scenario: main-session-write-in-active-tree-denied
- **GIVEN** 在飞树为 T 与切片前缀 `M/.claude/worktrees/flight-demo-`
- **WHEN** 判定主会话的 Write `T/src/a.py`、Write `M/.claude/worktrees/flight-demo-S1/x.py`、Write `/other/y.py`、Bash `git -C T commit -m x`、Bash `git -C T status`
- **THEN** 前两个 Write 与 `git -C T commit -m x` 被拒，理由含「只读」
- **AND** Write `/other/y.py` 与 `git -C T status` 放行

### Requirement: flight 类型只能由控制面显式派发
`agent.spawn` 时，`flight:*` 类型若不是由 flight 插件派发 SHALL 被拒绝；由 flight 插件派发但 `model` 为空 SHALL 被拒绝；非 flight 插件发起的派发，`parentAgentId` 属于在飞飞行的 agent 时 SHALL 被拒绝；flight 插件自己发起的派发 SHALL NOT 因此被拒绝（PR #41 评审 HIGH：插件在飞行 agent 收口或 turn.complete 的帧里接着派发）。
Feature: 铁律 11 事前强制；飞行 agent 不得自行扩张

#### Scenario: spawn-guard-decisions
- **GIVEN** 守卫的纯判定函数
- **WHEN** 判定：模型经 Agent 工具派发 `flight:executor`；flight 插件派发 `flight:executor` 但 model 为空；flight 插件派发 `flight:reviewer` 且 model 为 opus；在飞执行体 agent-1 派发 `general-purpose`
- **THEN** 第一、二、四个被拒，理由分别含「控制面」「model」「不得再派发」
- **AND** 第三个放行

### Requirement: 包络接入引擎事件
插件 SHALL 在 `tool.call` 上按上述包络拒绝越界写入与危险 Bash（飞行 agent）和在飞树写入（主会话）；SHALL 在 `tool.check` 上只对飞行 agent、只在包络内、只把引擎判定为 ask 的调用改答 allow，引擎判定为 deny 或组织上限为 ask 时 SHALL 原样返回；SHALL 在 `agent.spawn` 上执行派发守卫，守卫自身出错时对 `flight:*` 拒绝。
Feature: 能力包络即权限策略：包络内不弹询问，包络外一律拒绝

#### Scenario: tool-call-denies-out-of-envelope-write
- **GIVEN** demo 已起飞，S1 执行体 agent-1 已派发（owns 为 `src/a.py`）
- **WHEN** agent-1 调用 Write `<S1 worktree>/src/b.py`，以及 Write `<S1 worktree>/src/a.py`
- **THEN** 前者 tool.call 答 deny，理由含「owns」
- **AND** 后者交给下游执行

#### Scenario: tool-check-upgrades-ask-only-in-envelope
- **GIVEN** demo 已起飞，S1 执行体 agent-1 已派发
- **WHEN** 引擎对 agent-1 的 Write `<S1 worktree>/src/a.py` 判 ask；对同一调用判 deny；对同一调用判 ask 但 ceiling 为 ask；对 agent-1 的 Bash `npm install` 判 ask；对主会话的 Write 判 ask
- **THEN** 第一种答 allow
- **AND** 其余四种都原样返回引擎的判定

#### Scenario: main-session-read-only-during-flight
- **GIVEN** demo 已起飞（在飞），之后 attempt 1 halt
- **WHEN** 起飞后、停飞前主会话 Edit `<change worktree>/src/a.py`；停飞后再 Edit 同一文件
- **THEN** 前者 tool.call 答 deny，理由含「只读」
- **AND** 后者交给下游执行

#### Scenario: agent-spawn-guard-wired
- **GIVEN** 插件已加载
- **WHEN** 主会话的模型经 Agent 工具派发 `subagent_type: flight:executor`
- **THEN** agent.spawn 答 deny，理由含「控制面」
