## Why

大目标是「模型只做创作，门禁由插件与判定器裁决，模型不自证」。飞行内已经做到：测量、门禁、合回、评审结论都由插件记进账本 `refs/flight/<change>/ledger`。**收尾还没做到**：

- **评审由模型派、结论由模型转述**：落地后 `/flight:pr-ship` 由主会话派评审员。评审员的提示词由模型写，评审结论也由模型读完后转述。
- **闭环由模型判定、文件由模型改写**：主会话自己判断 CRITICAL/HIGH 闭环没有，判完就自己改 `review-findings.json` 的 `blocking`。
- **ready 由模型执行**：`slice-gate.py ship` 读 `review-findings.json` 与 `gate-report.md` 给出 ready，再由模型执行 `gh pr ready`。这两个文件模型都能改。

PR #51 就是这样转成 ready 的：评审结论确实是通过，但从机制上看，这正是铁律 4、5 要防的自证。

2026-10-13 用户在阶段 4–5 决策页（`docs/flight-phase4-decisions.html`）上全部选推荐项。本 change 是其中的 change 1：C1–C4 四项都选 A，并附带「已定」的两项。它与 change 2（判定器收口、intent-gate、可靠性）叠成一个 PR。

## What Changes

- **控制面派全量评审**（C1-A）：
  - final 绿之后、落地之前，插件派 `flight:reviewer` 审整条 change 分支：范围从与目标分支的分叉点到 final 的 commit。
  - 提示词由插件写，并列出切片评审提过的 CRITICAL/HIGH，要评审员逐条核对。findings 经 `submit_findings` 进账本（review 事件，slice 为 `whole`）。
- **全量评审有 CRITICAL/HIGH 时自动修，至多 2 轮**（C2-A）：
  - 每一轮：派修复体（slice `fix-r<k>`），它的收口门禁就是全量 final；合回后重跑 final，再派复核员（slice `whole-r<k>`）只审这一轮修复带来的改动。
  - 复核仍有 CRITICAL/HIGH 且已跑满 2 轮，就落地为 draft。全程不问人。
- **ship 只读账本**（已定）：
  - `slice-gate.py ship` 改从账本裁决，依据为：各片合回、本 attempt 的 final、全量评审最新一轮的 CRITICAL/HIGH、该轮评审的 commit 是否仍对应 HEAD、各角色的实际模型（路由对账）。
  - `gate-report.md` 与 `review-findings.json` 只供人读：落地时由插件按 ship 的输出写入。模型改这两个文件，影响不到裁决。
- **draft / ready 由插件执行**（C3-A）：
  - 新增模型可调用的工具 `ship`，只有主会话可用。
  - `/flight:pr-ship` 在飞行模式下一律以 `--draft` 建 PR，建完调 `ship` 并交出 change 名与 PR 号。
  - 插件先核对 PR 头分支与 commit，再按账本裁决，把裁决与评审结论贴成 PR 评论，需要时执行 `gh pr ready` 或 `gh pr ready --undo`，最后记 ship 事件进账本。
- **飞行外的 PR 维持现流程**（C4-A）：没有 `slices.json` 的 PR 仍由主会话派 `flight:code-reviewer`，PR 正文标明「非账本裁决」。
- **#51 遗留**（已定）：
  - 插件自己注册了 `opsx-apply`（项目里没有同名命令文件）时，`--gate=per-task` 直接回复 legacy skill 的路径，不再透传给一个没有正文的命令；
  - 「来源规则」在命令文档与 skill 里各只写一处。
- **判定器要求**：
  - 账本新增 `ship` 事件；
  - `slice-gate.py features` 新增 `ship-ledger`，起飞时核对；
  - `timeline.py report` 的「批准 → PR 打开」改取账本里第一条 ship 事件。
- **版本**：插件 0.8.0（change 2 同 PR，不再改版本号）。

**BREAKING**：

- `slice-gate.py ship` 不再读 `gate-report.md` 与 `review-findings.json`；没有 `slices.json` 的目录一律判 draft。
- `/flight:pr-ship` 飞行模式不再派评审员、不再问人、不再执行 `gh pr ready`：以上由控制面与 `ship` 工具完成。
- 判定器须认识 `ship` 事件并声明 `ship-ledger` 能力：合入后主检出要快进，否则起飞被拒。这一核对沿用 #50 的机制。

## Capabilities

### New Capabilities

- `flight-ship-ledger`：ship 只从账本裁决；判定器认识 ship 事件、声明 ship-ledger 能力；飞行记录的 PR 用时取自账本。
- `flight-whole-review`：final 之后控制面派全量评审，CRITICAL/HIGH 自动修至多 2 轮并复核；落地时按 ship 输出写入给人读的记录。
- `flight-ship-tool`：主会话可调用的 `ship` 工具，按账本裁决、贴评论、切换 draft / ready、记 ship 事件；工具与命令不变量随之更新；`--gate=per-task` 在插件自己注册入口时给出指引。
- `flight-ship-docs`：`/flight:pr-ship` 飞行模式改用 `ship` 工具；apply 文档写明全量评审与修复轮；来源规则各写一处。

### Modified Capabilities

（无。`openspec/specs/` 下没有已归档的规格。`flight-ship-tool` 的不变量取代 flight-entry-handoff 中「模型可调用的工具恰为 submit_findings 与 measure」的约束，见 design D7。）

## Impact

- **判定器**：`template/.claude/hooks/` 下的 `slice-gate.py`、`ledger.py`、`timeline.py`。
- **插件**：
  - `hooks/` 下的 `core.ts`、`landing.tsx`、`land.ts`、`prompts.ts`、`io.ts`、`orchestrator.tsx`、`versions.ts`，新增 `ship.ts`；
  - `agents/reviewer.md`、`commands/pr-ship.md`；
  - 版本 0.8.0。
- **文档**：`/opsx-apply` 命令与 skill、`README.md`、`docs/WORKFLOW_zh.md`。
- **测试**：`test_ship_verdict.py` 的文件判据用例改为账本判据；插件测试世界的 `features` 应答补上 `ship-ledger`。
- **本 change 自己的飞行**：
  - 在已装的 0.7.0 上飞，用的是主检出 ac5d051 的判定器；全量评审、`ship` 工具都还不存在；
  - 落地交接到 0.7.0 的 `/flight:pr-ship` 时，主会话按用户指令只提交记录、推送分支、**不建 PR**；
  - change 2 落地后，两个 change 合成一个 PR。
