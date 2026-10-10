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

