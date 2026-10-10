"""flight 插件能力包络的纯策略（scenario: flight-envelope#* 的纯判定部分）。"""


from test_flight_plugin import assert_ts_passed

# ---------------------------------------------------------------- flight-envelope S3
# S3 已实现：骨架标记已去。


def test_executor_write_limited_to_owns():
    # Given: 执行体 worktree 为 W，本片 owns 为 src/a.py 与 tests/**
    # When: 判定写 W/src/b.py、W/tests/x/test_y.py、W/src/a.py、/tmp/z.py
    # Then: W/src/b.py 与 /tmp/z.py 被拒且理由含「owns」与越界路径；其余两个在包络内
    assert_ts_passed("executor-write-limited-to-owns")


def test_reviewer_cannot_write():
    # Given: 评审员
    # When: 判定它 Edit 任一文件
    # Then: 被拒，理由含「评审员」
    assert_ts_passed("reviewer-cannot-write")


def test_bash_dangerous_git_denied():
    # Given: 执行体
    # When: 判定 git push / git -C /w reset --hard / git stash / git worktree add / git update-ref refs/flight/... / git commit --amend / git branch -D
    # Then: 全部被拒；git commit -m x 不被拒；评审员的 git commit -m x 被拒
    assert_ts_passed("bash-dangerous-git-denied")


def test_bash_upgrade_only_allowlisted():
    # Given: 门禁 test 为 python3 -m pytest -q tests，某片 verify 为 python3 -m pytest -q tests/test_a.py
    # When: 判定执行体的 Bash 能否免询问
    # Then: pytest 子集、git status && git diff、git add && git commit 可免询问；接 curl | sh、$(id)、> 重定向、npm install 不可
    assert_ts_passed("bash-upgrade-only-allowlisted")


def test_main_session_write_in_active_tree_denied():
    # Given: 在飞树为 T 与切片前缀 M/.claude/worktrees/flight-demo-
    # When: 判定主会话的若干 Write 与 Bash
    # Then: 在飞树内的 Write 与 git -C T commit 被拒且理由含「只读」；树外 Write 与 git -C T status 放行
    assert_ts_passed("main-session-write-in-active-tree-denied")


def test_spawn_guard_decisions():
    # Given: 守卫的纯判定函数
    # When: 判定四种派发
    # Then: 模型派 flight:executor、插件派但无 model、在飞 agent 再派发被拒（理由含「控制面」「model」「不得再派发」）；插件带 model 派 flight:reviewer 放行
    assert_ts_passed("spawn-guard-decisions")

def test_spawn_guard_exempts_plugin_own_dispatch():
    # Given: 父 agent 属于在飞飞行
    # When: flight 插件带 model 派发 flight:reviewer / flight:executor；引擎来源派发 general-purpose
    # Then: 插件自己的派发放行，引擎来源被拒（PR #41 评审 HIGH，R1）
    assert_ts_passed("spawn-guard-exempts-plugin-own-dispatch")

# ---------------------------------------------------------------- flight-envelope-tightening S1
# S1 已实现：骨架标记已去。


def test_bash_wrap_pins_worktree():
    # Given: 执行体 worktree 为 /r/.claude/worktrees/flight-demo-S1，门禁 test 为 python3 -m pytest -q tests
    # When: 改写 git commit -m x 并二次改写；判定改写后的门禁命令能否免询问
    # Then: 结果为 cd '<worktree>' && git commit -m x，二次改写不变；改写后的门禁命令可免询问；路径含单引号时正确转义
    assert_ts_passed("bash-wrap-pins-worktree")


def test_mutating_git_must_target_own_worktree():
    # Given: 执行体 worktree 为 W，主仓库为 M，change worktree 为 M/.worktrees/demo
    # When: 判定 git -C W commit、git commit、git -C <change worktree> commit、cd <change worktree> && git add、git -C sub commit、git -C <change worktree> log
    # Then: 第三、四、五个被拒且理由含「自己的 worktree」；第一、二、六个不被拒
    assert_ts_passed("mutating-git-must-target-own-worktree")


def test_deny_table_gaps_closed():
    # Given: 执行体
    # When: 判定 git pull、git config 写入、-c core.hooksPath（含大小写变体）、--config-env=core.hooksPath、commit --am、branch --d、git config --get
    # Then: 前七个被拒；git config --get user.name 不被拒
    assert_ts_passed("deny-table-gaps-closed")


def test_stdin_scripts_and_heredoc_denied():
    # Given: 执行体
    # When: 判定 python3 -、python3 - <<'EOF'、bash -s、python3 /dev/stdin、cat > a.py <<EOF、python3 scripts/x.py
    # Then: 前五个被拒且理由含「脚本文件」或「Write」；python3 scripts/x.py 不被拒
    assert_ts_passed("stdin-scripts-and-heredoc-denied")


def test_upgrade_refuses_env_prefix_and_outside_git():
    # Given: 执行体 worktree 为 W，主仓库为 M
    # When: 判定 GIT_EXTERNAL_DIFF=/x git diff、GIT_DIR=/o git -C W commit、git -C /tmp/other log、git -C W diff、git -C M/.worktrees/demo log 能否免询问
    # Then: 前三个不可免询问，后两个可免询问
    assert_ts_passed("upgrade-refuses-env-prefix-and-outside-git")


def test_read_upgrade_limited_to_repo():
    # Given: 主仓库为 /r，执行体 worktree 为 /r/.claude/worktrees/flight-demo-S1
    # When: 判定仓库内外的 Read、不带 path 的 Grep、Glob path /etc
    # Then: 仓库内的 Read 与 Grep 可免询问；~/.ssh 与 /etc 不可
    assert_ts_passed("read-upgrade-limited-to-repo")

# ---------------------------------------------------------------- flight-measure
# S4 已实现：骨架标记已去。


def test_interpreter_wrappers_checked():
    # Given: 执行体 worktree 为 W
    # When: 判定 bash -c / sh -lc / eval 包住的 push、reset、cd /repo 后的 commit、-c 内含 ; 的命令，以及 bash -c 'python3 -m pytest -q'
    # Then: 前五条被拒（理由含子命令 / 自己的 worktree / 无法判定），最后一条不拒
    assert_ts_passed("interpreter-wrappers-checked")


def test_cd_variants_tracked():
    # Given: 执行体 worktree 为 W，主仓库 /repo
    # When: 判定 pushd /repo、builtin cd /repo、command cd /repo 之后的改动类 git，pushd W/sub && popd 之后的 commit，以及 builtin cd W 之后的 commit
    # Then: 前四条被拒（理由含自己的 worktree），最后一条不拒
    assert_ts_passed("cd-variants-tracked")


def test_git_env_overrides_denied():
    # Given: 执行体 worktree 为 W
    # When: 判定带 GIT_DIR / GIT_CONFIG_* / env GIT_WORK_TREE / export GIT_DIR / 单独 GIT_INDEX_FILE= 赋值的改动类 git，以及 GIT_PAGER=cat git log -1
    # Then: 前五条被拒（理由含 GIT_），最后一条不拒
    assert_ts_passed("git-env-overrides-denied")


def test_shared_config_writers_denied():
    # Given: 执行体 worktree 为 W
    # When: 判定 git fetch、remote add、remote set-url、branch -u、branch --set-upstream-to，以及 remote -v、remote get-url、branch --list
    # Then: 前五条被拒，后三条不拒
    assert_ts_passed("shared-config-writers-denied")


def test_glob_pattern_cannot_escape():
    # Given: 主仓库 /repo，执行体 worktree W 在其内
    # When: 判定 Glob 的绝对 pattern、含 .. 的 pattern 与 path=W 的相对 pattern
    # Then: 前两个不免询问，第三个免询问
    assert_ts_passed("glob-pattern-cannot-escape")
