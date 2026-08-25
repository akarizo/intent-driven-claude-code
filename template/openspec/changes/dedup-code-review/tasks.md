> **TDD 例外声明**：本 change 的全部产物是指令文案（skill / command / agent / 文档 markdown），**没有一行生产代码**，因此 `openspec-apply-change` § 7 的 TDD 例外条款适用（「纯文档 / 纯配置类 task 可跳过，但必须明告用户」）。每条 task 的「验证」是结构检查与文本核对，可复现、可判定。

## 1. 水位线契约（其余全部改动的前置）

- [ ] 1.1 在 `template/.claude/skills/openspec-subagent-apply-change/SKILL.md` 新增一节「Review 水位线（review-log.md）」，定义文件路径 `openspec/changes/<change>/review-log.md`、字段（`BASE_REF` / `REVIEWED_UPTO` / 已审区间表 / deferred 清单）与一份完整示例；验证：该节存在，且示例同时含 `REVIEWED_UPTO` 与 `## Deferred` 两个锚点
- [ ] 1.2 在同节写明「唯一写入方 = 逐 task 守门的主会话；`code-reviewer` subagent 不读该文件，已审范围由主会话摘进 prompt」；验证：该节含「唯一写入方」与「不读」两条约束文本
- [ ] 1.3 在同节写明兜底原则「读不到 review-log.md → 一切回退全量审；水位线只能缩小已覆盖部分范围，不能放过未审代码」；验证：该节含兜底原则文本

## 2. `code-reviewer` agent 的评审模式契约

- [ ] 2.1 `template/.claude/agents/code-reviewer.md` 新增「Review 模式」一节，定义 `full` / `integration` / `follow-up` 三种模式各自的「必须报」与「不得报」；验证：文件含三个模式名，且每个模式下都有「不得报」条目
- [ ] 2.2 同文件「铁律」补第 5 条：不重复上报 prompt 已声明「已审范围 / 已处理 finding」内的问题；确认上游 finding 未闭环时可上报，但须标注「上游 review 未闭环」；验证：铁律小节条目数为 5，且末条含「上游 review 未闭环」字样
- [ ] 2.3 同文件「评审流程」step 1 补一句「先读 prompt 声明的评审模式与已审范围，据此决定审查边界」；验证：step 1 含「评审模式」字样
- [ ] 2.4 确认未改动分级标准表、finding 格式与签名要求（本 change 的 Non-Goal）；验证：`git diff` 中 `## 分级标准`、`## 输出格式` 两节无改动

## 3. 逐 task 守门：写水位线 · 聚焦复核 · 修复不 amend

- [ ] 3.1 `openspec-subagent-apply-change/SKILL.md` § 4b 派活 prompt 补 `评审模式：full`，并说明本 task 净 diff 即全量范围；验证：4b prompt 块含 `full`
- [ ] 3.2 同文件 § 4c 修复 subagent prompt 第 3 条改为「统一新增独立 `fix:` commit，**不要** `--amend`」，并说明理由（修复增量区间需可稳定圈定）；验证：4c 不再出现 `--amend` 作为可选项，且含「fix:」commit 要求
- [ ] 3.3 同文件 § 4c 的复审改为聚焦复核：范围 = 修复 commit，prompt 声明 `评审模式：follow-up` + 原 finding 清单，任务限定为「核对原 finding 闭环 + 修复本身有无新问题」；验证：4c 复审段含 `follow-up` 与「原 finding 清单」，且不再要求重审整个 task
- [ ] 3.4 同文件 § 4d 勾选 checkbox 后补一步「主会话追加 review-log.md 记录：推进 `REVIEWED_UPTO`、登记本 task 的 MEDIUM/LOW 到 deferred」；验证：4d 含 `REVIEWED_UPTO` 与 `deferred` 两个字样
- [ ] 3.5 同文件 § 3 起点记录处补「若 `review-log.md` 不存在则以 `BASE_REF` 初始化它」；验证：§ 3 含初始化说明
- [ ] 3.6 同文件 Guardrails 与 Common Mistakes 表同步新增：「修复用 amend 导致区间不可圈定」「守门通过不写水位线」两条；验证：两条各命中一行

## 4. 整合审：一次且位置明确

- [ ] 4.1 `openspec-subagent-apply-change/SKILL.md` § 5 改写为「整合审位置判定」：用 AskUserQuestion 明确问下一步，选「立即送出 PR」→ 跳过本地整合审并说明将在 PR 阶段执行；选「暂不送出」→ 本地执行且限定只审跨 task 维度；验证：§ 5 含 AskUserQuestion 且不再出现「用户计划立即 `/pr-ship`」这类需推断的软条件
- [ ] 4.2 同节保留并明确既有硬条件「task 数 = 1 → 恒跳过」，理由改为「逐 task 守门已覆盖其全部 diff」；验证：该硬条件仍在且理由文本已更新
- [ ] 4.3 本地整合审的 prompt 声明 `评审模式：integration` + 已审范围，明列只审跨 task 交互 / 整体一致性 / 端到端完整性；验证：prompt 块含 `integration` 与三个维度
- [ ] 4.4 § 7 收口报告模板补「整合审位置」与「water­mark 区间」两行；验证：收口模板含这两项

## 5. `/pr-ship`：水位线感知评审 · 深度声明 · 增量复核

- [ ] 5.1 `template/.claude/commands/pr-ship.md` § 8 前置一步「读 `openspec/changes/*/review-log.md`（若本 PR 对应某个 change）」，并给出三种覆盖情况 → 三种评审模式的判定表；验证：§ 8 含判定表且三种模式名齐全
- [ ] 5.2 § 8 的 subagent prompt 按模式分支给出：`integration` 传已审范围 + 已处理 finding 摘要并声明不得重报；`full` 保持今日文本不变；验证：prompt 段落含模式分支，且 `full` 分支文本与改前一致
- [ ] 5.3 § 9 评论体补「审查深度声明」块（评审模式 / 已守门覆盖区间 / task 数 / 阻断并修复项数）与「守门期间 deferred」清单；验证：§ 9 评论模板含这两个块
- [ ] 5.4 § 12 复审改为默认 `follow-up`：范围 = 上轮评审时 HEAD 到当前 HEAD，任务 = 核对上轮 CRITICAL/HIGH 闭环 + 修复补丁自身问题；同时保留「用户明确要求完整重审」的回退选项；验证：§ 12 含 `follow-up` 与回退选项两者
- [ ] 5.5 § 12 之前记录「本轮评审时的 HEAD SHA」，供下一轮圈定区间；验证：§ 8 或 § 9 含记录 HEAD SHA 的步骤
- [ ] 5.6 Guardrails 补一条「无 review-log.md → 全量审，行为与改前一致」；验证：Guardrails 命中该条

## 6. `/opsx-verify`：测试纪律降级 + 修命令与 skill 漂移

- [ ] 6.1 `template/.claude/skills/openspec-verify-change/SKILL.md` § 6 的 Test Discipline Check 前置分支判断：水位线覆盖全部 task → 降级为「配对测试文件存在 + 抽 1 例确认三段注释存在」并注明细节判定已由守门覆盖；无水位线 → 保持今日完整抽查；验证：该节含两个分支，且「无水位线」分支文本与改前一致
- [ ] 6.2 `template/.claude/commands/opsx-verify.md` 补上 Test Discipline 维度（与 skill 对齐，含同样的降级分支）；验证：命令文件含 Test Discipline 段且与 skill 的分支逻辑一致
- [ ] 6.3 两文件的 Summary Scorecard 表补 Test Discipline 行，并标注本次是「完整抽查」还是「已降级」；验证：两处 scorecard 均含该行

## 7. 调用方描述同步

- [ ] 7.1 `template/.claude/commands/opsx-apply.md` step 6 的「subagent 逐 task 守门」选项描述补「守门结论写入 review-log.md，整合审位置在收口时由你选」；验证：该选项文本含 `review-log.md`
- [ ] 7.2 同文件 Guardrails 同步该行为；验证：Guardrails 命中

## 8. 文档同步

- [ ] 8.1 `README.md` 第 211–221 行「两层守门 · 实现中 vs 合并前」小节改写：删除「靠不同 diff 范围区分，不会把同一段代码白审两次」与「互补不重复」断言，替换为水位线分层模型表（守门点 / 评审模式 / 范围来源 / 是否受水位线约束）；验证：README 不再含「互补不重复」字样，且新表含「评审模式」列
- [ ] 8.2 `README.md` 阶段 5 的 verify 表补「测试纪律按水位线降级」说明；验证：该表命中
- [ ] 8.3 `docs/WORKFLOW_zh.md` 的「逐 task 守门循环」代码块与「三处守门同一 agent」条目同步为水位线模型；验证：该文件不再含「互补不重复」，循环块含 `review-log.md`
- [ ] 8.4 `README.md` 的 `code-reviewer` agent 说明补三种评审模式；验证：该条目含三个模式名

## 9. 一致性校验与收口

- [ ] 9.1 全仓库 grep 复核：`review-log.md` / `REVIEWED_UPTO` / `integration` / `follow-up` 四个关键词在各文件出现位置符合预期，无遗漏调用方；验证：逐关键词 grep 输出与本 tasks 清单逐条对齐
- [ ] 9.2 复核向后兼容：串行 `openspec-apply-change`、`openspec-bulk-apply-change` 两个 skill 未被本 change 改动；验证：`git diff --stat` 中这两个文件不出现
- [ ] 9.3 复核 Non-Goal 未被破坏：`code-reviewer.md` 的分级标准、finding 格式、只读工具集未变；验证：`git diff` 对应段落无改动
- [ ] 9.4 在 `template/` 下运行 `openspec validate dedup-code-review --type change --strict`；验证：退出码 0
- [ ] 9.5 更新 `spec.html` 审批面板到最终工件状态；验证：`openspec/changes/dedup-code-review/spec.html` 存在且含 tasks 全量清单
