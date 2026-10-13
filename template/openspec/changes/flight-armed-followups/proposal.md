## Why

#54（0.10.0，起飞待命与按下即起飞）合入时留下 25 条未修的 MEDIUM / LOW。其中三组关系到正确性或规格：
- **起飞并发**：三个起飞入口（命令、批准带按键、待命自动重试）之间仍有窗口，会产生「回复已取消却静默起飞」「无关轮次白耗预算」「卡住的飞行被误拒续飞」；续飞按钮的基线阶段还会并发跑两个基线。
- **文档残留**：几处仍写「按批准起飞后再发 `/opsx-apply`」。
- **规格缺口**：「正在飞」拒飞出口没有 scenario。

另外，用户在本会话里遇到过：按「批准修订并续飞」后，基线在后台跑 2–3 分钟，界面上看不到任何进度。

决策见决策页 `docs/flight-armed-followups.html`。2026-10-13 用户全按推荐（Q1–Q6），代替 grill-me 访谈。

## What Changes

- **起飞锁与 abort**：
  - 三个入口共用的锁（现在的 `armBusy`），拒绝原文改为「正在起飞，稍候」；
  - 自动重试进行中收到 `/flight abort`，回复「正在自动起飞，结束后再 /flight abort」，不动待命（Q2）；
  - 重试结束时即使待命已变，起飞成功也照样通知。
- **交模型对准**：调用 `prompt.submit` 之前记下时刻 T0，提交成功后才置 `awaitingModel`。只认开始时刻（结束时的 clock.now 减 `durationMs`）不早于 T0 的主会话轮次。提交失败则放弃待命。
- **旧待命与状态行**：
  - 人再次起飞被拒为 human / human-key 时，清掉同一 change 的旧待命；
  - 放弃或取消待命时，只在没有别的在飞 change 或待命时清空状态行。
- **「正在飞」判得更准**（Q4）：在飞集合之外，还要求 drive 正在跑这个 change，或本 attempt 有活 agent；否则视为卡住，照常续飞。拒绝原文补上下一步。
- **看门狗**：
  - 诊断员在「已派发、dispatch 未写入」窗口里的请求也计时；
  - tick 处理前复查请求仍然超时（不按陈旧快照停 agent）。
- **批准带**（Q3、Q5）：
  - 从按下到起飞返回、包括续飞的基线阶段，该项显示「起飞中…」或「基线运行中（已 N 分钟）」，不渲染按钮；
  - 状态行显示基线进度；
  - 去重分支的提示改为「已批准，直接起飞」。
- **小修**：
  - `land.ts` 识别已暂存删除时改用 `git status --porcelain -z`（中文路径不再失效）；
  - 放弃待命的做法提示保留 `--takeover` 等参数；
  - 补几处测试缺口；
  - `scenarioFiles` 不再在两个文件各写一份。
- **文档与规格**：三处文档残留照实改；补「正在飞」与「重启后可续飞」的规格；插件 0.10.1（Q6）。

## Capabilities

### New Capabilities
- `flight-takeoff-lock`：起飞锁的拒绝原文、abort 遇锁、重试结果不丢。
- `flight-flying-check`：「正在飞」的判据与卡住时续飞；重启后续飞（护栏）。
- `flight-band-progress`：批准带的进行中显示、基线进度、按键起飞提交工件、去重提示。

### Modified Capabilities
- 无。`template/openspec/specs/` 不存在。下列与旧 change 同名的能力，在本 change 以 ADDED 补充：
  - `flight-armed-takeoff`：交模型对准、旧待命清理、状态行、做法保留参数、记账用例；
  - `flight-watchdog-hardening`：诊断员登记窗口计时、tick 复查；ticker 护栏重述；
  - `flight-takeoff-commit`：已暂存删除的边界情形；
  - `flight-armed-docs`：文档残留、版本 0.10.1。

## Impact

- **插件**：`template/plugins/flight/hooks/` 的 `orchestrator.tsx`、`register.tsx`、`armed.ts`、`land.ts`，以及 `types/index.d.ts`；对应的 TS 测试与 pytest 包装；`plugin.json` 升到 0.10.1。
- **文档**：`opsx-propose` 与 `opsx-apply` 的命令和 skill、`README.md`、`docs/WORKFLOW_zh.md`。
- **不改**：判定器与账本事件。
