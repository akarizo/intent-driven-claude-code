## ADDED Requirements

### Requirement: 飞行 agent 的 Bash 固定在自己的 worktree 里运行
插件 SHALL 把飞行 agent 的每条 Bash 命令改写为 `cd '<自己的 worktree>' && <原命令>`（单引号转义，已有该前缀时不重复），`bashUpgradable` SHALL 把开头这一段视为白名单段。
Feature: 实测插件派发的 agent 不在 spawn 的 cwd 里运行，shell 跟随主会话当前目录；裸 git 与相对路径会落到别的树

#### Scenario: bash-wrap-pins-worktree
- **GIVEN** 执行体的 worktree 为 `/r/.claude/worktrees/flight-demo-S1`，门禁 test 命令为 `python3 -m pytest -q tests`
- **WHEN** 改写 `git commit -m x`，再改写一次已改写的结果；并判定改写后的 `python3 -m pytest -q tests` 能否免询问
- **THEN** 结果为 `cd '/r/.claude/worktrees/flight-demo-S1' && git commit -m x`，二次改写不变
- **AND** 改写后的门禁命令可免询问；worktree 路径含单引号时被正确转义

#### Scenario: bash-runs-in-own-worktree
- **GIVEN** demo 已起飞，S1 执行体 agent-1 已派发
- **WHEN** agent-1 调用 Bash `git status`
- **THEN** 到达插件之下执行端的命令为 `cd '<S1 worktree>' && git status`

### Requirement: 改动类 git 只能作用于自己的 worktree
对飞行 agent，git 调用的作用目录（`-C`、`--git-dir`、`--work-tree`、同一命令前面的绝对路径 `cd`，都没有时为自己的 worktree）不在自己的 worktree 内且子命令不是只读时，插件 SHALL 拒绝；只读子命令指向主仓库内的任何树 SHALL 放行；相对路径无法判定时 SHALL 按「不在」处理。
Feature: #41 的执行体把提交落进了 change worktree

#### Scenario: mutating-git-must-target-own-worktree
- **GIVEN** 执行体 worktree 为 W，主仓库为 M，change worktree 为 `M/.worktrees/demo`
- **WHEN** 判定 `git -C W commit -m x`、`git commit -m x`、`git -C M/.worktrees/demo commit -m x`、`cd M/.worktrees/demo && git add a.py`、`git -C sub commit -m x`、`git -C M/.worktrees/demo log`
- **THEN** 第三、四、五个被拒，理由含「自己的 worktree」
- **AND** 第一、二、六个不被拒

#### Scenario: commit-outside-own-worktree-denied
- **GIVEN** demo 已起飞，S1 执行体 agent-1 已派发
- **WHEN** agent-1 调用 Bash `git -C <change worktree> commit -m x`
- **THEN** tool.call 答 deny，理由含「自己的 worktree」

### Requirement: 拒绝表补齐
对飞行 agent 的 Bash，插件 SHALL 拒绝 `git pull`、`git config` 的非只读用法、全局 `-c core.hooksPath=…` 与 `--config-env=core.hooksPath=…`（键名不分大小写）；长选项识别门槛 SHALL 为 `--` 之后 1 个字符；SHALL 拒绝读标准输入的解释器（`python`、`python3`、`node`、`bash`、`sh`、`zsh`、`ruby`、`perl` 带单独的 `-` 或 `-s`，或命令含 `/dev/stdin`）与 heredoc `<<`，理由给出替代做法。
Feature: #41 评审 MEDIUM（拒绝表缺口）与 LOW（缩写门槛）；#41 执行体 `python3 -` 挂起 1 小时 24 分钟

#### Scenario: deny-table-gaps-closed
- **GIVEN** 执行体
- **WHEN** 判定 `git pull`、`git config core.hooksPath /x`、`git -c core.hooksPath=/dev/null commit -m x`、`git -c CORE.HOOKSPATH=/x commit -m x`、`git --config-env=core.hooksPath=X commit -m x`、`git commit --am -m x`、`git branch --d x`、`git config --get user.name`
- **THEN** 前七个被拒
- **AND** `git config --get user.name` 不被拒

#### Scenario: stdin-scripts-and-heredoc-denied
- **GIVEN** 执行体
- **WHEN** 判定 `python3 -`、`python3 - <<'EOF'`、`bash -s`、`python3 /dev/stdin`、`cat > a.py <<EOF`、`python3 scripts/x.py`
- **THEN** 前五个被拒，理由含「脚本文件」或「Write」
- **AND** `python3 scripts/x.py` 不被拒

### Requirement: 免询问白名单收紧
`bashUpgradable` SHALL 对任何带前导 `VAR=` 的段返回 false；git 段的作用目录 SHALL 满足：只读子命令在主仓库内，`add` / `commit` 在自己的 worktree 内，否则返回 false。
Feature: #41 评审 MEDIUM：白名单不检查 git 的作用目标，前导环境变量可在只读子命令里起进程

#### Scenario: upgrade-refuses-env-prefix-and-outside-git
- **GIVEN** 执行体 worktree 为 W，主仓库为 M
- **WHEN** 判定 `GIT_EXTERNAL_DIFF=/x git diff`、`GIT_DIR=/o git -C W commit -m x`、`git -C /tmp/other log`、`git -C W diff`、`git -C M/.worktrees/demo log` 能否免询问
- **THEN** 前三个不可免询问
- **AND** 后两个可免询问

### Requirement: 读取免询问限于主仓库内
`tool.check` 对飞行 agent 的 Read / Grep / Glob，SHALL 只在目标路径（Read 的 `file_path`；Grep / Glob 的 `path`，缺省视为自己的 worktree）规范化后位于主 worktree 内时改答 allow，其余 SHALL 原样返回引擎判定。
Feature: #41 评审 MEDIUM：飞行 agent 读 `~/.ssh` 也不弹询问，与「不越过用户设置」相悖

#### Scenario: read-upgrade-limited-to-repo
- **GIVEN** 主仓库为 `/r`，执行体 worktree 为 `/r/.claude/worktrees/flight-demo-S1`
- **WHEN** 判定 Read `/r/.claude/worktrees/flight-demo-S1/a.py`、Read `/r/template/x.md`、Read `/Users/u/.ssh/id_rsa`、不带 path 的 Grep、Glob path `/etc`
- **THEN** 前两个与 Grep 可免询问
- **AND** `~/.ssh` 与 `/etc` 不可免询问

#### Scenario: read-outside-repo-not-upgraded
- **GIVEN** demo 已起飞，S1 执行体 agent-1 已派发
- **WHEN** 引擎对 agent-1 的 Read `/Users/u/.ssh/id_rsa` 判 ask，对 Read `<S1 worktree>/a.py` 判 ask
- **THEN** 前者原样返回 ask
- **AND** 后者改答 allow

### Requirement: 派发登记前 fail-closed
agent 已派发、dispatch 事件尚未写入账本时，插件 SHALL 拒绝它的 Write / Edit / NotebookEdit / Bash，理由含「登记中」；`tool.check` SHALL NOT 为它升级。
Feature: #41 评审 LOW：先 spawn 后登记，窗口内包络放行

#### Scenario: pending-agent-writes-denied
- **GIVEN** demo 已起飞，S1 执行体 agent-1 已派发，但它的 dispatch 事件没能写入账本
- **WHEN** agent-1 调用 Write `<S1 worktree>/src/s1.py`
- **THEN** tool.call 答 deny，理由含「登记中」

### Requirement: 起飞检查 git 版本
起飞时 `git --version` 低于 2.38，插件 SHALL 拒绝起飞且 SHALL NOT 写账本，回复含「git ≥ 2.38」。
Feature: #41 评审 LOW：合回用 `merge-tree --write-tree`，旧 git 会让所有合回失败

#### Scenario: takeoff-refuses-old-git
- **GIVEN** demo 已批准，`git --version` 输出 `git version 2.37.1`
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 回复含「git ≥ 2.38」，账本没有 takeoff 事件
