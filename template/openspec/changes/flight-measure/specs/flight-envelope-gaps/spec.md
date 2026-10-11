## ADDED Requirements

### Requirement: 解释器 -c 与 eval 内的命令按同一规则判定
一段的程序名为 `bash`、`sh` 或 `zsh` 且带 `-c`（含 `-lc` 这类组合），或程序名为 `eval` 时，`bashVerdict` SHALL 取其后的命令文本、去掉一层引号，以这一段的当前目录为起点递归判定；命令文本取不出来（引号不配对等）SHALL 拒绝，理由含「无法判定」。
Feature: #42 评审 MEDIUM：`bash -c 'git push …'` 绕过拒绝表

#### Scenario: interpreter-wrappers-checked
- **GIVEN** 执行体 worktree 为 W
- **WHEN** 判定 `bash -c 'git push origin HEAD:main'`、`sh -lc "git reset --hard"`、`eval git push`、`cd /repo && bash -c 'git commit -m x'`、`bash -c 'cd /repo; git commit -m x'`，以及 `bash -c 'python3 -m pytest -q'`
- **THEN** 前五条都被拒绝：前三条理由含相应的 git 子命令，第四条理由含「自己的 worktree」，第五条理由含「无法判定」
- **AND** 最后一条不被拒绝

### Requirement: 换目录的各种写法都计入作用目录
判定程序名前，`words` SHALL 剥掉段首的 `builtin`、`command`、`exec`，以及 `env` 及其选项与 `VAR=`；`pushd <p>` SHALL 与 `cd <p>` 一样设定目录；`popd` 之后目录 SHALL 记为无法判定。
Feature: #42 评审 MEDIUM：`pushd /repo && git commit` 被当成自己的 worktree

#### Scenario: cd-variants-tracked
- **GIVEN** 执行体 worktree 为 W，主仓库为 /repo
- **WHEN** 判定 `pushd /repo && git commit -m x`、`builtin cd /repo && git commit -m x`、`command cd /repo && git add a`、`pushd W/sub && popd && git commit -m x`，以及 `builtin cd W && git commit -m x`
- **THEN** 前四条被拒绝，理由含「自己的 worktree」
- **AND** 最后一条不被拒绝

### Requirement: 改动类 git 不得借 GIT_* 环境变量改变作用对象
改动类 git 段的前导赋值（含经 `env` 给出的）里有以 `GIT_` 开头的键时 SHALL 拒绝；`export` 段出现 `GIT_` 开头的名字、或只含赋值且赋值键以 `GIT_` 开头的段 SHALL 拒绝。只读子命令带 `GIT_*` 的不拒绝（仍不免询问）。
Feature: #42 评审 MEDIUM：`GIT_DIR=… git commit`、`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath …`

#### Scenario: git-env-overrides-denied
- **GIVEN** 执行体 worktree 为 W
- **WHEN** 判定 `GIT_DIR=/repo/.git git commit -m x`、`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x`、`env GIT_WORK_TREE=/repo git add a`、`export GIT_DIR=/repo/.git && git commit -m x`、`GIT_INDEX_FILE=/tmp/i; git add a`，以及 `GIT_PAGER=cat git log -1`
- **THEN** 前五条被拒绝，理由含「GIT_」
- **AND** 最后一条不被拒绝

### Requirement: 写共享 config 或移动 ref 的子命令进拒绝表
`git fetch` SHALL 被拒绝；`git remote` 只放行无参数、`-v` / `--verbose`、`show`、`get-url`，其余 SHALL 拒绝；`git branch` 的 `-u`、`--set-upstream-to`、`--unset-upstream`、`--edit-description` SHALL 拒绝。
Feature: #42 评审 MEDIUM：worktree 与主仓库共用 `.git/config` 与 ref 库

#### Scenario: shared-config-writers-denied
- **GIVEN** 执行体 worktree 为 W
- **WHEN** 判定 `git fetch . HEAD:refs/heads/main`、`git remote add x /tmp/x`、`git remote set-url origin /tmp/x`、`git branch -u origin/main`、`git branch --set-upstream-to=origin/main`，以及 `git remote -v`、`git remote get-url origin`、`git branch --list`
- **THEN** 前五条被拒绝，理由含相应的子命令或选项
- **AND** 后三条不被拒绝

### Requirement: eval 内层的换目录回传外层
`eval` 在当前 shell 执行：其内层 `cd`、`pushd`、`popd` 设定的目录 SHALL 回传给外层后续各段；`bash`、`sh`、`zsh -c` 在子进程执行，外层目录 SHALL 不受影响。
Feature: flight-measure attempt 1 · S4 评审 HIGH：`eval cd /repo && git commit` 被放行

#### Scenario: eval-cd-carries-to-outer
- **GIVEN** 执行体 worktree 为 W，主仓库为 /repo
- **WHEN** 判定 `eval cd /repo && git commit -m x`、`eval cd W && git commit -m x`、`bash -c 'cd /repo' && git commit -m x`
- **THEN** 第一条被拒，理由含「自己的 worktree」
- **AND** 后两条不被拒

### Requirement: 外层的 GIT_* 赋值带进 -c 与 eval 的内层
段首（含经 `env` 给出）的 `GIT_*` 赋值 SHALL 与内层各段自己的赋值合并后判定：内层改动类 git 见到合并后的 `GIT_*` SHALL 拒绝，只读 git 不拒。
Feature: flight-measure attempt 1 · S4 评审 HIGH：`GIT_DIR=… bash -c "git commit"` 被放行

#### Scenario: outer-git-env-reaches-inner
- **GIVEN** 执行体 worktree 为 W
- **WHEN** 判定 `GIT_DIR=/repo/.git bash -c "git commit -m x"`、`env GIT_WORK_TREE=/repo eval git add a`、`GIT_PAGER=cat bash -c 'git log -1'`
- **THEN** 前两条被拒，理由含「GIT_」
- **AND** 第三条不被拒

### Requirement: 前缀命令带参数的选项不得让判定失守
剥 `env`、`exec` 前缀时：不带参数的已知选项（env 的 `-i`、`-0`、`-v` 及其长名）SHALL 剥掉；带参数的选项 SHALL 连同参数一起剥掉，包括 env 的 `-u` / `--unset`、`-C` / `--chdir`、`-S` / `--split-string`、`-P`，以及 exec 的 `-a`；`env -C <p>` 与 `--chdir=<p>` SHALL 按 `cd <p>` 设定目录；剥前缀时遇到不认识的 `-` 选项 SHALL 拒绝，理由含「无法判定」。
Feature: flight-measure attempt 1 · S4 评审 MEDIUM：`env -u FOO git push` 让整段判定失守（fail-open）

#### Scenario: prefix-options-with-arguments
- **GIVEN** 执行体 worktree 为 W，主仓库为 /repo
- **WHEN** 判定 `env -u FOO git push origin HEAD:main`、`exec -a n git push`、`env -C /repo git commit -m x`、`env --chdir=/repo git add a`、`env -Z x git commit -m x`，以及 `env -u FOO python3 -m pytest -q`、`env -C W git commit -m x`
- **THEN** 前五条被拒：前两条理由含「git push」，第三、四条含「自己的 worktree」，第五条含「无法判定」
- **AND** 后两条不被拒

### Requirement: Glob 的 pattern 不得越界免询问
`readUpgradable` 对 Glob SHALL 在 `pattern` 为绝对路径或含 `..` 段时返回 false。
Feature: #42 评审 LOW：只看 `path` 时 `pattern` 可越出仓库

#### Scenario: glob-pattern-cannot-escape
- **GIVEN** 主仓库 /repo，执行体 worktree W 在其内
- **WHEN** 判定 Glob `{ pattern: '/etc/**' }`、`{ pattern: '../../**/*.pem' }`、`{ path: W, pattern: '**/*.ts' }`
- **THEN** 前两个不免询问
- **AND** 第三个免询问
