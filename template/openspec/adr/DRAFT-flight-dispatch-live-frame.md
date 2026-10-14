# DRAFT. 插件只在处理外部事件的 hook 里派发 agent；定时到点先唤醒一轮再派发

- Status: accepted
- Date: 2026-10-13
- Supersedes: 无（补充 DRAFT-flight-armed-takeoff 的调用时机，原条款不变）
- 关联：
  - DRAFT-flight-armed-takeoff（有界重试、按键即起飞）；
  - DRAFT-flight-capability-envelope（包络靠 `tool.call` / `tool.check` hook 生效）；
  - DRAFT-flight-bounded-self-heal（看门狗与诊断员）。
- 来源 change：flight-dispatch-origin（design D1–D5）

## Context

- **实测**（CLI 2.1.296，2026-10-13）：插件的 `$` 调用不在「处理外部事件、尚未返回的 hook」的异步链里时，引擎把它算作插件自己发起。这时 `$.agent.spawn` 出的 agent，工具调用的 origin 是插件本身，插件自己的 `tool.call`、`tool.check`、`turn.step`、`classic.SubagentStop` hook 全部按 re-entry 跳过，只有 `turn.complete` 照常到达。
- **后果**：能力包络、账本守卫、`measure` 应答对这类 agent 全部失效，而且没有任何报错。flight-armed-followups 按键起飞时，首轮三个执行体就是这样，因为调不到 `measure` 才被发现。
- **范围**：0.10.x 有四个入口这样派发：按键起飞、按键续飞、待命定时重试、看门狗派诊断员。

## Decision

1. **派发只在活的 hook 链里发生**：插件派发 agent，必须发生在处理外部事件（命令、按键、agent 结束、主会话一轮结束）且尚未返回的 hook 的 await 链里。
2. **定时器到点不派发，先唤醒一轮**：
   - 定时器到点时，条件满足才以插件身份提交一轮简短对话，请模型只回复「收到」；
   - 这一轮结束时，在主会话 `turn.complete` 里再起飞或派发；
   - 等待类先零 token 检查条件，不满足就不唤醒。
3. **派发凭证当场强制**：
   - 每次派发都须持有活帧凭证，凭证只在 hook 入口取得，hook 返回即失效；
   - 不持活凭证的派发当场拒绝，按铁律 10 停飞并留下记录。
4. **批准带按键在按键 hook 内 await 起飞与续飞**：实测挂起期间输入不受影响，按键并发由进行中记录拦住。

否决的方案：
- **借自己注册的命令拿一个活 hook**：实测插件调自己的命令，自己的 hook 不应答。
- **定时器到点只通知人**：无人值守能力退步。
- **只靠文档约定，或静态扫描回调**：这次缺陷正是写法看似正确、语义踩坑，约定和扫描都挡不住。
- **agent 结束后事后对账**（插件 hook 从没见过它的工具调用就判红）：引擎没有区分好坏 agent 的字段（`spawnedBy` 相同，usage 无工具次数）；用「没见过 turn.step / tool.call」作信号，会让测试世界大面积误判。等引擎提供 origin 字段后再议。

## Consequences

- **正面**：所有飞行 agent 都经过包络与 measure；以后写在回调里的派发会当场暴露，不会悄悄绕过包络。
- **负面**：
  - 定时重试与看门狗诊断，每次多一轮主会话对话（只回复「收到」）；
  - 按键 hook 会挂起到起飞或续飞结束；
  - 凭证挡不住刻意绕过：在回调里自己调用 `withLease` 就能拿到凭证。
- **后续**：
  - 合入后在真引擎上冒烟：按键起飞时首轮 measure 正常；定时到点出现唤醒轮；
  - 引擎提供 origin 字段后，补「事后对账」。
