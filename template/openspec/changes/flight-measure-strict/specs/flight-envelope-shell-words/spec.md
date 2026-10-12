## ADDED Requirements

### Requirement: 命令名与 git 词先做 shell 去引号
飞行 agent 的 Bash 判定 SHALL 对程序名、前缀命令、`cd` / `pushd` / `popd` / `export`、`bash -c` / `eval` 的识别，以及 git 的程序名、全局选项与子命令先做 shell 去引号（反斜杠、单引号、双引号）再判断；拒绝表的选项匹配 SHALL 对参数先去引号。
Feature: #47 评审线索，主会话核实：`\git`、`git "push"`、`\cd` 都绕过拒绝表与 worktree 限制

#### Scenario: quoted-command-words-recognized
- **GIVEN** 执行体的 worktree 为 W，主仓库为 /repo
- **WHEN** 逐条判定：
  - `\git push`、`g''it push origin x`、`git "push"`、`git p\ush`；
  - `"git" -C /repo commit -m x`、`git commit "--amend"`、`\env git push`；
  - `\cd /repo && git commit -m x`、`\bash -c 'git push'`；
  - 以及 W 内的 `git commit -m "$(cat msg)"`
- **THEN** 前九条都被拒
- **AND** 最后一条不被拒

### Requirement: 命令名位置的展开判为无法判定
命令名（剥掉前缀之后的第一个词）、git 子命令或 git 全局选项里出现单引号外的 `$` 或反引号时，判定 SHALL 拒绝，理由含「无法判定」；反引号命令替换出现在命令名位置时同样 SHALL 拒绝。参数里的展开不在此列。
Feature: 展开后的命令名无法静态判定，宁可多拒

#### Scenario: expanded-command-word-undeterminable
- **GIVEN** 执行体的 worktree 为 W
- **WHEN** 逐条判定：
  - `$G push`、`${GIT:-git} push`、`$(which git) push`、`` `which git` push ``、`git $SUB origin`；
  - 以及 `echo $HOME`、`git status`
- **THEN** 前五条都被拒，理由含「无法判定」
- **AND** 后两条不被拒
