## Why

模板工程里的低推理任务（spec→HTML 渲染、探索、delta 同步、文档增量同步）在主会话为 Opus 时会跟着烧 Opus token；派出的 subagent 也没有随模板分发的 Sonnet 兜底，下游装模板后默认在 Opus 上跑机械活。根因是模板既没把「简单活降级」的路由纪律固化进指令，也没把 subagent 的 Sonnet 兜底写进可分发的 `settings.json`，导致任务与模型系统性错配、token 成本约 5× 浪费。

## What Changes

- **新建 `template/.claude/settings.json`**：固化 `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`，让每个装模板的下游项目自动获得「无 `model:` 声明的 subagent 默认 Sonnet」兜底。
- **低推理命令加软引导行**：为 `/spec-html`、`/opsx-explore`、`/opsx-sync`、`/claudemd-sync` 命令及 `spec-html-render` skill 顶部各加一段「建议主会话 `/model sonnet`」引导（引用块形式，软约束，**不锁 frontmatter**，保留用户选择权）。
- **纯机械 subagent 派发点显式降级**：为 `opsx-archive` / `openspec-archive-change` 的 sync subagent、`claudemd-standardize` 的证据调查 subagent 补充 `model: sonnet` 显式标注（双保险，不再只依赖 env 兜底）。
- **`CLAUDE.md.snippet` 补精简版 Model 路由段**：把「默认 sonnet / 仅复杂活升 opus / 主会话自查」纪律随模板下发，让下游项目获得一致的路由约束。
- 明确**保留 inherit**：逐 task 实现 subagent（写代码需推理）、`code-reviewer`（已 `model: inherit`）不降级。

## Capabilities

### New Capabilities
- `model-routing-defaults`: 定义模板分发的模型路由默认行为——subagent 兜底模型、低推理命令的模型引导契约、纯机械 subagent 的显式降级规则、以及随模板下发的路由纪律。规约「哪类任务应跑哪个模型层级」这一可验证契约。

### Modified Capabilities
<!-- 无既有 capability 的行为契约被改变；本 change 引入的是全新的模型路由默认层，既有 openspec/specs/ 下无对应 spec。 -->

## Impact

- **新增文件**：`template/.claude/settings.json`
- **命令（4）**：`template/.claude/commands/spec-html.md`、`opsx-explore.md`、`opsx-sync.md`、`claudemd-sync.md` —— 各加引导行
- **命令（2，subagent 派发）**：`opsx-archive.md`、`claudemd-standardize.md` —— 派发点补 `model: sonnet`
- **skill（3）**：`spec-html-render/SKILL.md`（加引导行）、`openspec-archive-change/SKILL.md`（派发点补 model）、（`claudemd-standardize` 的证据调查在命令内，无独立 skill）
- **分发文件**：`template/CLAUDE.md.snippet` —— 补 Model 路由段
- **不影响**：任何业务逻辑、hooks、intent-gate 门禁、openspec schema；全部为配置与指令文案改动
- **依赖**：无新增依赖；`settings.json` 的 env 机制是 Claude Code 原生能力
