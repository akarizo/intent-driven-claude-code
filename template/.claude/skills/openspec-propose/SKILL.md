---
name: openspec-propose
description: Propose a new change with all artifacts generated in one step, including a sliced task plan ready for /opsx-apply's flight mode.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.1"
---

一次成稿：并行读完全部待建工件的 instruction，再一次性写出全部工件（含切片计划），最后跑一次 `openspec status`。工件写完后渲染审批面板，然后硬交接给人类：本 skill 到此结束，起飞由人类自己发出 `/opsx-apply`（`takeoff-gate.py` 机械校验这条批准）。

**REQUIRED SUB-SKILL：** 建 change 前先用 `openspec-git-discipline` 的 **Worktree Isolation** 节 —— 本 change 的一切产物落在它自己的 `.worktrees/<name>/` worktree 内，主仓库工作区不落产物。

---

**Input**：change 名（kebab-case），或描述想构建什么的自然语言。

**Steps**

1. **补全输入**（缺失时）

   用 **AskUserQuestion tool**（开放式）问：
   > "What change do you want to work on? Describe what you want to build or fix."

   推导出 kebab-case 名。

   **IMPORTANT**：想不清楚就不要继续。

1.5 **建并进入本 change 的 worktree**（见 `openspec-git-discipline` 的 Worktree Isolation）

   ```bash
   git worktree add .worktrees/<name> -b worktree-<name>
   ```

   进入它（CWD = `.worktrees/<name>/`），之后 step 2 起的 `openspec` CLI 与工件写入自然落在 worktree 内。

   - worktree 已存在（同名 change 续做）→ 直接进入。

2. **建 change 目录**
   ```bash
   openspec new change "<name>"
   ```

3. **一次成稿**

   - `openspec status --change "<name>" --json` 拿 `applyRequires` 与 `artifacts`。
   - 并行对每个待建工件跑 `openspec instructions <id> --change "<name>" --json`，一次性全部读完。
   - 触发器表：

     | 工件 | 触发条件 | 未命中时 |
     |---|---|---|
     | specs | 行为发生变化 | 本模板要求必有，不可跳过 |
     | design | 跨模块 / 新依赖 / 数据模型 / 安全或性能迁移 | 写实质内容；未命中 → design.md 只写一行「触发器未命中，跳过：<理由>」 |
     | adr | 长期架构承诺 | 命中才建，未命中不建 |
     | tasks | 恒必需 | — |

   - 一次性写出全部该建的工件。
   - tasks 阶段额外产出：`slices.json`、每个切片一份 `slices/<S>.md` 切片包、每个 scenario 一个 `xfail(strict)` 骨架（放进所属切片 owns 的测试文件）、由 `slices.json` 生成的 `tasks.md`。
   - 随后：
     ```bash
     python3 .claude/hooks/slice-gate.py lint --change-dir openspec/changes/<name>
     ```
     红 → 修 `slices.json` 直到绿。

4. **基线门禁**
   ```bash
   python3 .claude/hooks/slice-gate.py baseline --change-dir openspec/changes/<name>
   ```
   跑一次全量测试，记耗时到 `slices.json.gate.full_suite_sec`。

5. **渲染审批面板**
   ```bash
   python3 .claude/hooks/spec_html.py --change-dir openspec/changes/<name>
   ```
   一次性生成 `openspec/changes/<name>/spec.html`（模型不逐字渲染 HTML）。失败不阻塞：只 warn，继续。

6. **收尾**
   ```bash
   openspec status --change "<name>"
   ```
   然后**硬交接**（四件事缺一不可）：

   1. 打印 `spec.html` 的**绝对路径**（`openspec/changes/<name>/spec.html`，用 `pwd` 拼成绝对路径再打印），请人类打开审阅飞行计划。
   2. 明确一行：**本 skill / 本命令到此结束。不得在同一轮继续 `/opsx-apply`；起飞需要你自己发出 `/opsx-apply <name>`（`takeoff-gate.py` 会在转录里核验这条人类批准 + 计划新鲜度，模型自证无效）。**
   3. 提示用户把工件单独 commit（artifacts-only commit）。
   4. 打印**一行**可直接复制的起飞指令——人要切模型起飞得先 `/clear`，清空后既不知道进哪个目录也无从复原参数，所以这一行必须自足：

      ```
      去 '<worktree 绝对路径>' apply <name>, 授权你git提交, 完成后就pr-ship, 把pr url交付我review
      ```

      - `<worktree 绝对路径>` = step 1.5 建的 `.worktrees/<name>/`，用 `pwd` 拼成**绝对路径**，**不得**写相对路径。
      - 授权语固化在这一行里：授权范围与 git 铁律「命令即授权」一致——commit · push feature 分支 · 建 PR · 贴评审评论 · draft↔ready 转换。
      - **不得**把 `waves` · `deps` · `expectHead` · `hooksDir` · `agentsDir` 等派发参数列进这一行让人复制；它们由起飞会话自己机械推导。

**Output**

完成后总结：change 名与位置、生成的工件清单、切片数与 wave 数、下一步提示：spec.html 绝对路径 + 那一行起飞指令 + 「请你自己发出它」（本 skill 不代跑）。

**Artifact Creation Guidelines**

- 遵循 `openspec instructions` 返回的 `instruction` 字段。
- **IMPORTANT**：`context` / `rules` 是给你的约束，不要抄进正文。
- 用 `template` 作为文件骨架，逐节填充。

**Guardrails**
- 一次性写出全部工件，不逐个反复问询。
- 已存在同名 change → 问续做还是新建。
- 每个工件写完后确认文件存在再继续。
