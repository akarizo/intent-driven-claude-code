## ADDED Requirements

### Requirement: 有计划切片 blocked 时评审收齐后停飞
全部切片都已合回或 blocked、且已合回切片的评审都已收齐后，本 attempt 里只要有计划内切片 blocked，状态机 SHALL 返回恰好一条停飞动作，原因列出每个 blocked 切片及其原因首行，并写明「未派修复、未跑 final」；SHALL NOT 派发修复 agent，SHALL NOT 返回 final。评审未返回（`review:<S>`）与修复 agent blocked 不算计划内切片 blocked。
Feature: afa 实测：S2/S3 blocked 后仍派修复体、跑两次必红 final；修复体的收口门禁会被别的切片的 xfail scenario 卡住

#### Scenario: core-halts-when-slices-blocked
- **GIVEN** waves [[S1, S2]]；attempt 1 里 S1 blocked（gate，原因 G7 x）
- **AND** S2 已合回，评审给了 1 条 HIGH
- **WHEN** 求下一批动作
- **THEN** 恰为一条停飞动作，原因含 S1、G7 x 与「未跑 final」
- **AND** 没有派发修复 agent，没有 final

#### Scenario: core-waits-reviews-before-halting
- **GIVEN** waves [[S1, S2]]；S1 blocked，S2 已合回、评审员已派发但还没结束
- **WHEN** 求下一批动作
- **THEN** 没有停飞动作

#### Scenario: core-review-blocked-still-finals
- **GIVEN** waves [[S1, S2]] 全部合回；S1 评审为空列表，`review:S2` blocked（infra，评审未返回）
- **WHEN** 求下一批动作
- **THEN** 恰为一条 final 动作

### Requirement: 续飞只重派 blocked 的切片
因切片 blocked 停飞后，新 attempt 起飞时状态机 SHALL 只为上一 attempt 里 blocked 的切片派发执行体，已合回的切片不重派。
Feature: 停飞是为了修好原因后续飞，已完成的切片不重做

#### Scenario: core-resume-redispatches-blocked-slice
- **GIVEN** attempt 1 里 S1 blocked、S2 已合回且评审为空列表、之后停飞；账本随后有 attempt 2 的 takeoff
- **WHEN** 求下一批动作
- **THEN** 恰为派发 S1 的执行体，没有 S2 的动作
