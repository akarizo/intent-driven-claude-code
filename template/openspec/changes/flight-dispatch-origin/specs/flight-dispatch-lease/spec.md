## ADDED Requirements

### Requirement: 派发须持有活帧凭证
插件每次派发 agent（执行体、解冲突、评审员、修复体、诊断员）都 SHALL 持有活帧凭证。凭证只在处理外部事件的 hook 里取得：`/opsx-apply`、`/flight resume`、批准带按键、子 agent 结束、主会话一轮结束。取得凭证的 hook 处理返回（或抛错）后，凭证 SHALL 失效。没有凭证或凭证已失效时，派发 SHALL 被拒，拒绝原文含「派发须在处理外部事件的 hook 里」，且 SHALL NOT 调用引擎的派发。各调用点按原有的被拒分支处理：执行体与解冲突记 blocked，进而停飞（铁律 10）。

Feature: 在已返回的 hook 或定时器回调里派发的 agent，插件的包络与 measure 对它无效，而且不报错。凭证让这类写法当场暴露，而不是悄悄绕过。

#### Scenario: dispatch-refused-after-hook-returns
- **GIVEN** 在 `withLease` 的 body 里取得凭证并保存下来，body 已经返回；另有一次请求不带任何凭证
- **WHEN** 分别用失效的凭证和「没有凭证」请求派发（`guardedSpawn`）
- **THEN** 两次都得到含「派发须在处理外部事件的 hook 里」的拒绝
- **AND** 派发函数一次都没有被调用

#### Scenario: dispatch-allowed-in-live-hook
- **GIVEN** `withLease` 的 body 正在执行
- **WHEN** body 里用它的凭证请求派发
- **THEN** 派发函数被调用恰一次，并原样返回它的结果

### Requirement: hook 入口的派发照常
`/opsx-apply` 起飞派出首个 wave，以及子 agent 结束时派出下一步（评审员等），SHALL 照常派发，不因凭证要求被拒。

#### Scenario: command-takeoff-dispatches
- **GIVEN** demo 已批准、worktree 干净、lint 与 preflight 绿、waves [[S1, S2], [S3]]
- **WHEN** 人发出 `/opsx-apply demo`
- **THEN** 账本依次为 takeoff 与 S1、S2 的 dispatch，两次都以 flight:executor 派出

#### Scenario: agent-end-dispatches-next
- **GIVEN** `/opsx-apply demo` 已起飞；S1 的执行体收口时门禁绿，合回无冲突
- **WHEN** 处理该执行体的结束（turn.complete）
- **THEN** 最后一次派发是 cwd 为 change worktree 的 flight:reviewer，账本有 role reviewer、slice S1 的 dispatch
