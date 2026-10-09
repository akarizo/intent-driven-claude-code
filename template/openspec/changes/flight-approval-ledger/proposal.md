## Why

起飞批准（铁律 7 第一处）今天的判据是「会话转录里有一条人类消息，且晚于计划工件的 mtime」（`takeoff-gate.py`）。这条判据有三处结构性弱点：

| 弱点 | 现状 | 后果 |
|---|---|---|
| 判据靠启发式推断 | 从转录逐行判断「是不是人发的」「是不是批准词」（≤40 字且含「批准 / 起飞 / approve」） | 判错两头都有：人说「不批准，先别起飞」也可能命中；规则越补越长 |
| 新鲜度靠 mtime | 计划工件最大 mtime ≤ 批准时刻 | `touch` / checkout / rebase 会改 mtime 而不改内容；改了内容但 mtime 更早（如 `git checkout` 旧版本）则漏判 |
| 拿不到转录就放行 | hook 模式下转录缺失 → fail-open | 判据缺席时门禁形同不存在 |

2026-10-09 的架构评审（`docs/flight-control-plane.html`，D1–D7 全部按推荐裁决）确定：飞行控制面整体迁入 Claude Code mod 作为可信执行面，判定器保持纯 Python。同日在 Claude Code 2.1.295 上实测 8 项能力全部成立（S1–S8，数据见 design.md），其中与本 change 直接相关的是：按钮按压事件 `ui.press` 只能来自人（S3）、git 引用上的提交链可作账本且并发写由 `update-ref` 旧值校验兜住（S4）、项目级插件在新会话与 worktree 会话中都会加载（S6）。

本 change 是迁移的**第一个机制切换**：把起飞批准从「转录推断 + mtime」换成「人按按钮 → 计划内容指纹写入 git 账本 → 门禁比对指纹」。编排（Workflow）、路由、收口门禁不在本次范围，按 design.md 的迁移路径在后续 change 里切换。

## What Changes

- **新增计划指纹判定器** `template/.claude/hooks/plan_fp.py`：对 change 目录里定义计划的文件（proposal / design / specs / slices.json / 切片包）做规范化后取 sha256；执行记录（tasks.md 勾选、spec.html、timeline、gate-report、evidence、review-findings、`_interfaces.md`、基线）与 `slices.json` 里的实测耗时 `gate.full_suite_sec` 不计入。`spec.html` 顶部显示指纹前 8 位。
- **新增账本读取器** `template/.claude/hooks/ledger.py`（只读）：读取 `refs/flight/<change>/ledger` 提交链、校验结构、给出最新批准指纹；结构不合法即判为损坏。
- **新增 flight 插件**（Claude Code mod，`template/plugins/flight/`）：输入框上方的批准带显示待批准计划及其指纹；人按「批准起飞」后，插件在进程内把 `approve{fp}` 追加进账本（单写者、CAS 冲突重试），并把 `/opsx-apply <change>` 预填进输入框；拒绝模型侧任何写账本的 Bash 命令；Claude Code 版本低于实测下限时停用批准带。插件**不提供**任何模型可调用的批准入口。
- **BREAKING · 起飞门禁判据切换**：`takeoff-gate.py` 改为「账本里最新批准指纹 == 当前计划指纹」才放行；删除全部转录解析与 mtime 判据，`--session` 参数移除；没有账本记录（含未安装插件）一律拒绝并给出安装与操作指引。
- **BREAKING · 分发**：仓库根新增 `.claude-plugin/marketplace.json`（marketplace `intent-driven`，插件 `flight`）；`install.sh` 在检测到 `claude` CLI 时按项目作用域登记 marketplace 并安装插件，缺 CLI 时打印手动命令。已安装模板的下游仓库升级后，未装插件就无法起飞（fail-closed，见 ADR）。
- **文档与铁律 7 同步**：根 `CLAUDE.md`、`template/CLAUDE.md.snippet`、`/opsx-propose` 与 `/opsx-apply`（含同名 skill）、`README.md`、`docs/WORKFLOW_zh.md` 改写批准方式；`docs/flight-control-plane.html` 纳入仓库作为迁移总图。
- **ADR**：新增 `DRAFT-flight-control-plane-in-mod`（迁移方向）与 `DRAFT-approval-bound-to-plan-fingerprint`（取代 `DRAFT-gate-evidence-not-self-reported`：原则保留，人类批准证据改为按钮按压写入账本并绑定计划指纹）。

## Capabilities

### New Capabilities
- `plan-fingerprint`: 计划内容指纹的范围、规范化规则、CLI 与 spec.html 展示
- `flight-ledger`: 账本的格式、只读读取、结构校验与跨 worktree 可见性
- `approval-band`: flight 插件的批准带、进程内账本写入、Bash 写账本拦截、版本下限、无模型可调批准入口
- `ledger-takeoff-gate`: 起飞门禁以账本指纹为唯一判据（CLI 与 PreToolUse hook 两种模式）
- `plugin-distribution`: marketplace 清单与 install.sh 的项目级插件安装
- `approval-docs`: 铁律 7 与命令 / skill / README / 工作流文档对新批准方式的描述

### Modified Capabilities
- （无：`openspec/specs/` 尚无已归档规格；原 `takeoff-approval` 行为由 `ledger-takeoff-gate` 整体取代，见 design.md D5）

## Impact

- **代码**：`template/.claude/hooks/` 新增 `plan_fp.py`、`ledger.py`，改 `takeoff-gate.py`、`spec_html.py`；新增 `template/plugins/flight/`（TS mod）；新增 `.claude-plugin/marketplace.json`；改 `install.sh`。
- **测试**：新增 `tests/test_plan_fp.py`、`tests/test_ledger.py`、`tests/test_flight_plugin.py`（包装 `claude plugin validate` / `claude plugin test`）；改 `tests/test_approval_gate.py`、`tests/test_spec_html.py`、`tests/test_install.py`、`tests/test_docs_iron_rules.py`、`tests/test_template_docs.py`。本仓库测试从此依赖本机 `claude` CLI（≥ 2.1.295）。
- **下游仓库**：升级后必须安装 `flight@intent-driven` 插件才能起飞；Claude Code 低于 2.1.295 的环境无法批准。
- **本仓库自身**：本 change 用 main 上的旧机制飞行；合入后，本仓库的后续飞行需先在本机安装插件（design.md 迁移计划）。
- **不变**：Workflow 编排、integrator、stop-gate、test-evidence、模型路由、PR review（后续 change）。
