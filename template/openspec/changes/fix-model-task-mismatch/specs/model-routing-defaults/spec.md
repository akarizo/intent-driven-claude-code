# model-routing-defaults

模板分发的模型路由默认层：规约「哪类任务应跑哪个模型层级」这一可验证契约，覆盖 subagent 兜底、低推理命令的模型引导、纯机械 subagent 的显式降级、以及随模板下发的路由纪律。

## ADDED Requirements

### Requirement: subagent 默认降级到 Sonnet

模板 MUST 携带一份可分发的 `settings.json`，把「未显式声明 `model:` 的 subagent 默认使用 Sonnet」这一兜底固化下来，使任何下游项目安装模板后自动获得该行为，而不依赖用户个人机器的环境变量。

#### Scenario: 下游安装模板后派出无 model 声明的 subagent

- GIVEN 一个刚安装了本模板的下游项目
- AND 该项目未在个人环境里设置 `CLAUDE_CODE_SUBAGENT_MODEL`
- WHEN 某个命令或 skill 通过 Agent 工具派出一个未显式声明 `model:` 的 subagent
- THEN 该 subagent 以 Sonnet 层级运行
- AND 无需用户手动配置任何环境变量

#### Scenario: 显式声明 model 的 subagent 不被兜底覆盖

- GIVEN 模板已携带 subagent 默认 Sonnet 的兜底配置
- WHEN 某处派发的 subagent 显式声明了 `model: inherit`（如 code-reviewer）或其它层级
- THEN 该 subagent 使用其显式声明的层级，而非兜底的 Sonnet
- AND 兜底只作用于「未声明」的情形

### Requirement: 低推理命令提供模型降级引导

对纯读取 / 渲染 / 机械同步性质的低推理命令与 skill，其指令文本 MUST 包含一段面向主会话的模型降级引导，建议在 Opus 主会话下先切到 Sonnet。该引导为软约束，MUST NOT 通过 frontmatter 强制锁定模型，以保留用户在需要时使用 Opus 的选择权。

#### Scenario: 用户查看低推理命令的指令

- GIVEN `/spec-html`、`/opsx-explore`、`/opsx-sync`、`/claudemd-sync` 之一，或 `spec-html-render` skill
- WHEN 用户或主会话读取该命令 / skill 的指令文本
- THEN 文本顶部包含一段引导，说明本任务属低推理、建议主会话 `/model sonnet`、并注明需要复杂判断时可自行保留 Opus
- AND 该引导以引用块（软提示）形式出现，命令 frontmatter 未设置强制 `model:` 字段

#### Scenario: 用户选择保留 Opus 运行低推理命令

- GIVEN 一个带降级引导但未锁定 model 的低推理命令
- WHEN 用户明知建议、仍选择在 Opus 主会话直接运行
- THEN 命令正常执行，不被阻断
- AND 系统不强制切换模型（尊重「确定性配置压过软约束」原则）

### Requirement: 纯机械 subagent 派发点显式声明 Sonnet

对派发去做纯机械工作（delta 规约搬运、读文件核验真实路径）的 subagent，其派发指令 MUST 显式标注使用 Sonnet 层级，而不仅依赖 `settings.json` 的兜底，使模型选择意图在派发点自解释、且在兜底缺失时仍正确降级。需推理的实现类与评审类 subagent MUST NOT 被纳入此降级范围。

#### Scenario: archive 触发 sync subagent

- GIVEN 用户在归档流程中选择 sync delta specs
- WHEN 系统通过 Task 工具派出执行 `openspec-sync-specs` 的 subagent
- THEN 该派发指令显式包含 Sonnet 层级标注
- AND 即使下游未加载兜底配置，该 subagent 仍以 Sonnet 运行

#### Scenario: standardize 派出证据调查 subagent

- GIVEN `/claudemd-standardize` 进入证据调查阶段且目标文件较多需并行
- WHEN 系统为每个目标文件派出一个读文件核验的 subagent
- THEN 该派发指令显式标注使用 Sonnet 层级
- AND 需要推理的实现类 subagent（写代码）与评审类 subagent（code-reviewer）不在此降级范围内，保留 inherit

### Requirement: 模型路由纪律随模板分发

模板携带的可分发指令片段（`CLAUDE.md.snippet`）MUST 包含一段精简的模型路由纪律，覆盖「默认 Sonnet 的任务类别」「仅升 Opus 的任务类别」「主会话需自查手动切换」三条，使下游项目获得与模板一致的路由约束。

#### Scenario: 下游项目采用模板的 CLAUDE.md 片段

- GIVEN 一个把 `CLAUDE.md.snippet` 并入自身 CLAUDE.md 的下游项目
- WHEN 该项目的主会话在这些指令约束下工作
- THEN 指令中包含精简版 Model 路由段
- AND 该段说明：搜索 / 读文件 / 探索 / 渲染 / 机械同步默认 Sonnet；复杂多步重构 / 架构决策 / 难 bug 根因 / 长链设计才升 Opus；主会话对低推理命令需手动 `/model sonnet`（因环境变量管不到主会话）
