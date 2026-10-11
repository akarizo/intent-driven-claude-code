## ADDED Requirements

### Requirement: 带路径或引号的前缀命令照样剥掉
`words` 判断段首前缀（`builtin`、`command`、`exec`、`env`）时 SHALL 先去掉一层引号再取 basename；`/usr/bin/env`、`"exec"`、`'command'` 这类写法 SHALL 与裸名同样剥掉，其后的命令照常判定。
Feature: #46 S9 评审 MEDIUM：`/usr/bin/env -u FOO git push` 放行

#### Scenario: prefix-path-and-quotes-stripped
- **GIVEN** 执行体 worktree 为 W，主仓库为 /repo
- **WHEN** 判定 `/usr/bin/env -u FOO git push origin HEAD:main`、`/usr/bin/env GIT_DIR=/repo/.git git commit -m x`、`"exec" -a n git push`、`'command' cd /repo && git commit -m x`，以及 `/usr/bin/env -u FOO python3 -m pytest -q`
- **THEN** 前四条被拒：第一、三条理由含「git push」，第二条含「GIT_」，第四条含「自己的 worktree」
- **AND** 最后一条不被拒

### Requirement: 目录参数里的 shell 展开判为无法判定
`resolveDir` 对参数去掉一层引号后，若任意位置仍含 `$`、反引号、`'` 或 `"`，SHALL 返回无法判定；`cd`、`pushd`、`git -C`、`--git-dir`、`--work-tree`、`env -C` 都经此判定。不含这些字符的引号路径（如 `'W/a b'`）不受影响。
Feature: #46 follow-up 复核的范围外线索：`cd "$(printf /repo)"`、`cd ".$X"` 被当成 worktree 内的相对路径

#### Scenario: expanded-dir-args-undeterminable
- **GIVEN** 执行体 worktree 为 W
- **WHEN** 判定 `cd W && cd "$(printf /repo)" && git commit -m x`、`cd W && X=/../../../..; cd ".$X" && git commit -m x`、`git -C "./$X" commit -m x`、`` cd `echo /repo` && git add a ``，以及 `cd 'W/a b' && git add x`、`cd W/sub && git add x`
- **THEN** 前四条被拒，理由含「自己的 worktree」
- **AND** 后两条不被拒

### Requirement: 「无法判定」的拒绝理由用中性措辞
改动类 git 因作用目录无法判定而被拒时，理由 SHALL 写「作用目录无法判定（目录栈旋转、相对路径无基准、变量或命令替换等）」，SHALL NOT 再写「相对路径且无绝对基准」。
Feature: #46 follow-up 评审 LOW：理由与实际原因对不上，执行体会照错误的提示改

#### Scenario: undeterminable-reason-neutral
- **GIVEN** 执行体 worktree 为 W
- **WHEN** 判定 `pushd +1 && git commit -m x` 与 `cd "$X" && git add a`
- **THEN** 两条都被拒，理由含「无法判定」与「目录栈旋转」
- **AND** 理由都不含「相对路径且无绝对基准」
