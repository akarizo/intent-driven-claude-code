## Why

flight-armed-followups 是第一次用批准带按键起飞，首轮 S1–S3 的执行体全都调不到 `measure`，每片都重派了一次。用 spike 复现后（CLI 2.1.296）查清了原因：插件在已经返回的 hook 里、或在定时器回调里调用 `$.agent.spawn`，引擎把这次派发算作插件自己发起。之后这个 agent 的工具调用 origin 都记成 flight，flight 自己的 `tool.call` / `tool.check` hook 一律按 re-entry 跳过。于是能力包络、账本守卫、`measure` 应答对这些 agent 全部失效。0.10.x 的按下即起飞、续飞、待命定时重试、看门狗派诊断员，这四个入口都是这种写法。

决策页：`docs/flight-dispatch-origin.html`（主检出，未跟踪），Q1–Q7 全按推荐。按键 hook 长时间挂起时界面不卡，已在交互会话实测通过。

## What Changes

- **定时器到点不直接派发（唤醒轮）**：
  - 起飞待命的定时重试（等待类的 60 秒 tick、偶发类的 10 秒重试）到点时，不再直接起飞。条件满足时，插件提交一轮简短对话，请模型只回复「收到」；这一轮结束时，在主会话 `turn.complete` 里重试。
  - 等待类先零 token 检查条件（基线是否跑完、上一次的 agent 是否结束），没满足就不提交。
  - 看门狗停飞后的诊断员同样经唤醒轮派出。
  - agent 结束、主会话一轮结束这些现成触发，照旧直接重试。
- **批准带按键在 hook 内起飞**：按「起飞 / 批准起飞」「续飞 / 批准修订并续飞」后，在按键 hook 里 await 起飞或续飞，不再经 `clock.after(0)` 转到回调里。顺带修 #56 留下的三项：
  - 进行中再按会被拒；
  - 重绘失败不再留下「起飞中」；
  - 基线结束后状态行会恢复。
- **派发凭证**：所有派发都须持有「活帧凭证」。凭证只在处理外部事件的 hook 里取得，hook 返回即失效。不持有活凭证的派发当场拒绝，并按铁律 10 停飞、如实记录。
- **交模型 / 唤醒的提交绑定待命**：提交的结果只作用于安排它的那次待命；待命换新后，旧提交成功不会把新待命标为已提交，失败也不会放弃新待命（#56 MEDIUM）。
- **文档**：
  - `opsx-propose` 命令的 description 去掉「起飞需人类自己发 /opsx-apply」（#56 MEDIUM）；
  - `opsx-apply` 命令与 skill、README、WORKFLOW 补写唤醒轮。
- 插件版本 0.10.2。

## Capabilities

### New Capabilities
- `flight-wake-turn`：定时到点经唤醒轮再起飞 / 派诊断员；纯判定在定时事件上不给出起飞；提交绑定待命。
- `flight-band-live-takeoff`：批准带按键在 hook 内完成起飞与续飞；进行中再按被拒；重绘失败不留进行中；基线结束后恢复状态行。
- `flight-dispatch-lease`：派发须持活帧凭证；命令起飞与 agent 结束时的派发照常（护栏）。
- `flight-dispatch-docs`：文档写明唤醒轮；`opsx-propose` 的 description 不再写旧流程；插件 0.10.2。

### Modified Capabilities
- 无。仓库没有主 specs 目录，前几个 change 的规格都以 ADDED 记在各自的 change 目录里。本 change 改变了 flight-armed-takeoff 中「tick / 计时到点即重试」的行为，以上面 `flight-wake-turn` 的 ADDED 要求重述。

## Impact

- **插件代码**：
  - `template/plugins/flight/hooks/`：`orchestrator.tsx`、`register.tsx`、`armed.ts`，新增 `lease.ts`；
  - `template/plugins/flight/types/index.d.ts`；
  - 对应的 TS 测试与 pytest 包装。
- **不改判定器**（`.claude/hooks/*.py`），账本事件类型不变。
- **可见行为变化**：
  - 定时重试与看门狗诊断会以插件身份发一轮「只回复收到」的对话，每次多一轮主会话；
  - 按键后起飞在按键处理中完成，按键 hook 会挂起到起飞或续飞结束（实测不影响输入）。
- **测试边界**：测试世界模拟不出 origin，单测只能断言结构（定时器只提交唤醒、按键内起飞、无活凭证被拒）。真引擎上的验证靠合入后冒烟。
