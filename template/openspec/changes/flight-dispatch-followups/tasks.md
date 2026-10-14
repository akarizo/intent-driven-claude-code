<!-- 本文件由 slices.json 生成，不要手写编辑；改动请改 slices.json 后重新生成。 -->
> **切片规则**：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
>
> **本仓库自身纪律**：
> - TDD：先写失败测试；
> - 测试函数首行写 `# Given:` / `// Given:` 三段中文注释；
> - `python3 -m pytest -q tests` 全绿；
> - `cd template && openspec schema validate intent-driven` 绿。
>
> **wave 划分**：wave 1 = S1 + S2 + S3，owns 互不相交，并行。
>
> **飞行条件**：
> - 在已安装的插件 0.10.2 上飞，主检出须在 `ed53487` 或更新；
> - **冒烟**（决策页 Q5 A）：基线还在跑时就按「批准起飞」。预期依次出现：
>   1. 被拒，进入起飞待命；
>   2. 基线跑完后出现一轮「只回复收到」的唤醒；
>   3. 起飞，首轮执行体的 measure 正常；
> - 只在本会话起飞；起飞前会话停在本 change 的 worktree，飞行中不要 cd。

## 切片

- [x] S1 orchestrator / armed：排队 drive 计入正在飞、错过的那一轮补发唤醒、abort 区分人工与自动、看门狗唤醒失败留日志、唤醒尾句去重、Arm 类型、补测与 pytest 残留 （deps: - · verify: `python3 -m pytest -q tests/test_flight_orchestrator.py tests/test_flight_armed.py tests/test_flight_watchdog.py tests/test_flight_abort.py tests/test_flight_lease.py`）
- [x] S2 批准带：按键入口同步登记、批准修订已批准时直接续飞、恢复状态行不冲掉别的基线进度、flight.test 残留 （deps: - · verify: `python3 -m pytest -q tests/test_flight_resume.py tests/test_flight_plugin.py tests/test_approval_gate.py`）
- [x] S3 发布 0.10.3 与文档测试残留 （deps: - · verify: `python3 -m pytest -q tests/test_dispatch_followups_docs.py tests/test_dispatch_origin_docs.py tests/test_armed_followups_docs.py tests/test_armed_docs.py tests/test_flight_land.py tests/test_template_docs.py tests/test_opsx_apply_engine.py`）
