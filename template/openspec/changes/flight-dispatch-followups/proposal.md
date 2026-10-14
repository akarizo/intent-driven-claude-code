## Why

#57（0.10.2）与 #56 的评审各留下一项会造成重复起飞的 MEDIUM：
- **批准带按键先查后登记**：连按时第二次也能通过「进行中」检查；
- **排队中的 drive 不算「正在飞」**：这时发 `/flight resume` 会在 attempt 未结束时再写一次 takeoff。

另有一处会让待命卡住：唤醒（或交模型）那一轮结束时，若恰好撞上同一 change 的起飞锁，推进会被直接丢掉，待命停在「已唤醒」直到 30 分钟过期。此外还有一批便宜的 LOW、缺测与残留。

0.10.2 的修复在测试世界里模拟不出 origin，这次起飞同时用作真引擎冒烟。

决策页：`docs/flight-dispatch-followups.html`（主检出，未跟踪），Q1–Q6 全按推荐。

## What Changes

- **按键在入口同步登记**：解析出 change 后、任何 await 之前，就登记该 change 正在处理；已登记的再按一律拒绝；处理结束（含异常）时删除。
- **排队中的 drive 计入「正在飞」**：drive 入队即计数，跑完减一；「正在飞」= drive 在跑、或在排队、或本 attempt 有活 agent。
- **错过的那一轮不丢**：
  - 唤醒或交模型那一轮结束时撞上起飞锁，先记下这个 change；
  - 锁释放时，若待命仍在等那一轮，就标为「错过一轮」；
  - 下一次 tick 立即补发唤醒；重试仍在唤醒那一轮结束时、在活的 hook 里做。
- **便宜的 LOW**：
  - 看门狗唤醒失败也记一行日志；
  - 唤醒正文的尾句只保留一份；
  - `Arm` 类型补上 `submittedAt`，去掉强转；
  - abort 撞锁时区分人工起飞与自动重试；
  - 批准修订并续飞时如果已批准（指纹相同），toast 写「直接续飞」并真的续飞；
  - 续飞结束恢复状态行时，不冲掉另一个 change 正在显示的基线进度。
- **测试与残留**：
  - 补测：交模型提交成功时待命已换新、唤醒提交失败时待命已换新、「drive 在跑而 agent 都已结束」时的「正在飞」；
  - 清理：无用的 `import pytest`、过时的「骨架」标题、孤立注释；`refresh-failure-clears-busy` 不再吞掉按键异常。
- 插件版本 0.10.3。

## Capabilities

### New Capabilities
- `flight-dispatch-hardening`：排队中的 drive 计入「正在飞」；abort 撞上人工起飞时如实回复；看门狗唤醒失败留日志；错过的那一轮在下一次 tick 补发唤醒。
- `flight-band-press-guard`：按键在入口同步登记，连按被拒；批准修订已批准时直接续飞；恢复状态行不冲掉别的基线进度。
- `flight-dispatch-followups-docs`：插件 0.10.3。

### Modified Capabilities
- 无。仓库没有主 specs 目录，以上都以 ADDED 记在本 change 目录。

## Impact

- **插件**：
  - `template/plugins/flight/hooks/`：`orchestrator.tsx`、`armed.ts`、`register.tsx`；
  - `types/index.d.ts`；
  - 对应的 TS 测试与 pytest 包装。
- **不改**判定器与账本事件类型，不建 ADR。
- **D 组罕见问题记入 backlog**，本 change 不改：
  - `land.ts` Y 位改名；
  - tick 同毫秒；
  - 非首项的进行中显示。
- **冒烟**：基线还在跑时按「批准起飞」，一次飞行验证两项：
  - 首轮执行体的 measure 正常；
  - 唤醒轮能走通。
