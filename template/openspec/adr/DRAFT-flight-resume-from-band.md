# DRAFT. 停飞后的续飞可由批准带按键触发

- Status: accepted, supersedes DRAFT-flight-orchestrator-state-machine 第 1 条中「人照旧发 `/opsx-apply`」一句（仅限停飞后的续飞）
- Date: 2026-10-13
- Supersedes: DRAFT-flight-orchestrator-state-machine（该 ADR 在 main 上尚未编号，按文件名引用；只取代第 1 条的这一句，其余条款不变）
- 关联：DRAFT-approval-bound-to-plan-fingerprint（批准 = 人的按键写入账本，本 ADR 不改它）· DRAFT-flight-bounded-self-heal
- 来源 change：flight-unattended（design D7）
- 被取代的 ADR 原文不动（铁律 6）。

## Context

- **现状**：`DRAFT-flight-orchestrator-state-machine` 第 1 条写「人照旧发 `/opsx-apply`，插件接管起飞检查与整个飞行」。停飞后要人改计划时，人得依次完成：
  1. 手动重跑 `slice-gate.py baseline`（否则 preflight 拒飞）；
  2. 在批准带按「批准起飞」；
  3. 回车预填的 `/opsx-apply`；工件未提交时还要加「授权提交」。

  计划没改、只需续飞时，要人发 `/flight resume`。
- **用户目标是无人值守到 PR**（2026-10-13）：停飞后让人改完计划按一次键就续飞；首次起飞不变。
- **按键已是可信来源**：`DRAFT-approval-bound-to-plan-fingerprint` 已确立，`ui.press` 只能来自人，模型没有任何工具能触发它。
- **实测**（CLI 2.1.296）：`$.clock.after` / `every` 的回调在 hook 返回后仍可用 `$`，按键处理可以把耗时数分钟的基线放到后台，不阻塞按键。

## Decision

1. **两种新按钮**：批准带对「最新 attempt 以 halt 结束」的 change 显示：
   - 计划改过时：「批准修订并续飞」；
   - 计划未改时：「续飞」。

   从未起飞或已落地的 change 仍显示「批准起飞」，首次起飞仍要人回车 `/opsx-apply`。
2. **「批准修订并续飞」= 一次按键完成**：
   1. 核对指纹与绘制时一致；
   2. 写 approve；
   3. 后台停掉该 change 仍在跑的诊断员；
   4. 重跑基线；
   5. 绿则以「授权提交」语义续飞：只提交本 change 工件、只重派未合回的切片，起飞检查全部照跑；红则通知原因、不起飞。

   「续飞」不写 approve、不跑基线，等同 `/flight resume`。
3. **不新增模型可达的入口**：续飞只由 `ui.press` 调用。不注册新命令、新工具；不从插件内以 `$.command.run` 发 `/opsx-apply`。

否决的方案：
- **按下后预填 `/opsx-apply <c> 授权提交` 让人回车**：多一步，基线仍要人跑。
- **以插件来源发 `/opsx-apply`，并为 plugin 来源开放续飞**：任何插件都能借这个口子续飞。
- **停飞后自动续飞，不等人**：计划改动须人批准（铁律 7）；计划未改的停飞，多数是需要人判断的情形。

## Consequences

- **更易**：停飞后人的动作从「读账本、跑基线、按批准、回车」缩成「看诊断、让主会话改工件、按一次键」。
- **更难**：批准带要多读一次账本判断停飞态；续飞在后台进行，失败只能经通知与 toast 告诉人。
- **中性**：按下「批准修订并续飞」会自动提交本 change 的工件，按钮旁的说明行写明这一点；工件之外有脏改动时照旧拒飞。
