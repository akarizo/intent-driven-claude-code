## ADDED Requirements

### Requirement: 账本认识预合并事件
账本 SHALL 认识 `premerge` 事件，必需字段 `attempt`（正整数）、`ok`（布尔）、`ref`、`target`、`commit`、`reason`（字符串）、`conflicts`（字符串数组）；停飞事件的可选 `kind` SHALL 接受 `premerge`。字段不合法时账本判损坏、原因点名字段。

#### Scenario: ledger-knows-premerge
- **GIVEN** demo 的账本依次有一条合法的 `premerge`（ok 为 false、conflicts 为 ["a.py"]）与一条 kind 为 premerge 的 halt；other 的账本有一条 conflicts 为字符串 "a.py" 的 `premerge`
- **WHEN** 对 demo 与 other 分别运行 `ledger.py show`，再运行 `ledger.py events`
- **THEN** demo 以 0 退出并打印这两条事件；other 以 4 退出，stderr 含「premerge 的 conflicts」
- **AND** `events` 的输出含 premerge

### Requirement: 落地前预合并目标分支
收口阶段、本 attempt 第一次 final 之前，控制面 SHALL 在 change worktree 预合并目标分支并记一条 `premerge` 事件，之后才跑 final：
- 没有 `origin` 远端 → 跳过，`ok` 为真；
- 目标 = `origin/HEAD` 指向的分支，解析不出用 `origin/main`；先 `git fetch`，失败 → `ok` 为假，停飞 kind `premerge`，原因含「拉取」与「/flight resume」；
- 目标提交已是 HEAD 的祖先 → 不合并，`ok` 为真；
- `git merge-tree` 判无冲突 → `git merge --no-edit <目标>`，`ok` 为真，`commit` 为合并后的 HEAD。
同一 attempt 之后再跑的 final（整合修复、修复轮之后）SHALL NOT 再预合并。

#### Scenario: premerge-clean-merges-then-final
- **GIVEN** demo 已起飞，S1 已合回、评审无 CRITICAL/HIGH；origin/HEAD 指向 origin/main，origin/main 不是 HEAD 的祖先，merge-tree 判无冲突
- **WHEN** drive 推进到收口
- **THEN** change worktree 依次运行了 `git fetch origin main`、`git merge --no-edit origin/main`
- **AND** 账本里 ok 为 true 的 premerge 事件排在第一条 final 之前，final 之后照常派全量评审

#### Scenario: premerge-up-to-date-skips-merge
- **GIVEN** 同上，但 origin/main 已是 HEAD 的祖先
- **WHEN** drive 推进到收口
- **THEN** 没有运行任何 `git merge` 合并 origin/main
- **AND** 账本有一条 ok 为 true、reason 含「已包含」的 premerge，随后有 final

#### Scenario: premerge-fetch-failure-halts
- **GIVEN** 同上，但 `git fetch origin main` 以 128 退出
- **WHEN** drive 推进到收口
- **THEN** 账本有一条 ok 为 false、reason 含「拉取」的 premerge，随后是 kind 为 premerge 的 halt，原因含「/flight resume」
- **AND** 本 attempt 没有 final 事件

### Requirement: 全量评审起点是合入的目标提交
本 attempt 有 `ok` 为真且 `target` 非空的 premerge 时，全量评审 SHALL 以该 `target` 为起点，SHALL NOT 用主检出 HEAD 求 merge-base。

#### Scenario: whole-review-base-is-target
- **GIVEN** demo 收口时预合并成功，premerge 的 target 为 origin/main 的提交 T；主检出 HEAD 是另一个提交
- **WHEN** final 绿后派全量评审
- **THEN** 全量评审的 dispatch 事件 base 为 T

### Requirement: 预合并冲突交解冲突 agent
预合并判出冲突时，控制面 SHALL 在独立的解冲突 worktree（从 change 分支尖端切出、在其中合并目标分支）派解冲突 agent，SHALL NOT 在 change worktree 留下合并现场。解冲突 agent 收口 SHALL 跑 final 门禁；绿则 change 分支快进到它的合并提交、记 `merge`（slice 为 premerge），再跑 final；收口未通过、未结束合并或快进失败 SHALL 停飞 kind `premerge`，原因列出冲突文件并提示人工合并后 `/flight resume`。

#### Scenario: premerge-conflict-dispatches-resolver
- **GIVEN** demo 收口时 merge-tree 判 origin/main 与 HEAD 在 a.py 冲突；解冲突 agent 收口时 final 门禁绿
- **WHEN** drive 推进，解冲突 agent 结束
- **THEN** 账本依次有：ok 为 false、conflicts 为 ["a.py"] 的 premerge；role 为 resolver、slice 为 premerge 的 dispatch（worktree 名含 premerge-resolve）；slice 为 premerge 的 merge（ok 为 true）；final
- **AND** change worktree 从未运行 `git merge --no-edit origin/main`

#### Scenario: premerge-resolver-red-halts
- **GIVEN** 同上，但解冲突 agent 三次收口的 final 门禁都红
- **WHEN** 解冲突 agent 结束
- **THEN** 账本有 kind 为 premerge 的 halt，原因含 a.py 与「/flight resume」
- **AND** 本 attempt 没有 slice 为 premerge 的 merge，也没有 final

### Requirement: 落地后重验
人发出的 `/flight recheck <change>`：最新 attempt 已落地，且判定器 `slice-gate.py ship` 的原因含「final 过期」或「全量评审过期」时，控制面 SHALL 另起一个 attempt，不派执行体，直接进入收口（预合并 → final → 全量评审 → 落地）；final 与全量评审仍新鲜时 SHALL 拒绝并回复「无需重验」；未落地时 SHALL 拒绝并提示用 `/flight resume`。

#### Scenario: recheck-after-land-reruns-final-and-review
- **GIVEN** demo 的 attempt 1 已落地（S1 合回、评审、final、全量评审、land 齐全）；`slice-gate.py ship` 的 reasons 含「final 过期」
- **WHEN** 人发出 `/flight recheck demo`
- **THEN** 账本追加 attempt 2 的 takeoff，随后依次有 premerge、final、全量评审的 dispatch
- **AND** attempt 2 没有任何 role 为 executor 的 dispatch

#### Scenario: recheck-refused-when-fresh
- **GIVEN** demo 的 attempt 1 已落地；`slice-gate.py ship` 的 reasons 为空
- **WHEN** 人发出 `/flight recheck demo`
- **THEN** 回复含「无需重验」
- **AND** 账本没有新的 takeoff
