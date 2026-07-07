## 1. subagent 兜底配置（根因，独立）

- [ ] 1.1 新建 `template/.claude/settings.json`，含 `env.CLAUDE_CODE_SUBAGENT_MODEL = "sonnet"`；验证：文件是合法 JSON 且键存在（`python3 -c "import json;print(json.load(open(...))['env']['CLAUDE_CODE_SUBAGENT_MODEL'])"` 输出 `sonnet`）

## 2. 纯机械 subagent 派发点显式降级

- [ ] 2.1 `template/.claude/commands/opsx-archive.md` 第 59 行 sync subagent 的 Task 调用补 `model: "sonnet"`；验证：grep 该行含 `model` 与 `sonnet`
- [ ] 2.2 `template/.claude/skills/openspec-archive-change/SKILL.md` 第 66 行同一 sync subagent 派发同步补 `model: "sonnet"`（与 2.1 保持一致）；验证：grep 命中
- [ ] 2.3 `template/.claude/commands/claudemd-standardize.md` 第 26 行「证据调查…并行子 agent」处补一句显式说明「每个证据调查 subagent 用 `model: sonnet`（读文件核验，无需 Opus）」；验证：该步文本含 sonnet 标注

## 3. 主会话低推理命令 / skill 软引导行

- [ ] 3.1 `template/.claude/commands/spec-html.md` 顶部（描述下方、Steps 上方）加引用块引导：本命令低推理、建议主会话 `/model sonnet`、需复杂判断可保留 Opus；验证：文件含引用块且未在 frontmatter 加 `model:` 字段
- [ ] 3.2 `template/.claude/skills/spec-html-render/SKILL.md` 顶部（`# spec-html-render` 标题下方）加同类引导块；验证：含引导块
- [ ] 3.3 `template/.claude/commands/opsx-explore.md` 顶部加引导块（探索=读代码+澄清，低推理）；验证：含引导块，frontmatter 无强制 `model:`
- [ ] 3.4 `template/.claude/commands/opsx-sync.md` 顶部加引导块（delta 搬运，机械）；验证：含引导块
- [ ] 3.5 `template/.claude/commands/claudemd-sync.md` 顶部加引导块（增量文档同步，机械）；验证：含引导块

## 4. 路由纪律随模板下发

- [ ] 4.1 `template/CLAUDE.md.snippet` 补一段精简版「## Model 路由」：默认 sonnet 的任务类别 / 仅复杂升 opus / 主会话自查手动 `/model sonnet`；验证：snippet grep 命中 `Model 路由` 且含三条要点

## 5. 一致性校验与收口

- [ ] 5.1 全仓库复核：4 处引导块措辞一致、2+1 处显式 sonnet 标注到位、无遗漏命中的低推理命令；验证：逐文件 grep 汇总
- [ ] 5.2 确认「实现类 subagent / code-reviewer 保留 inherit」未被误改；验证：`code-reviewer.md` 仍 `model: inherit`，`openspec-subagent-apply-change` 实现 subagent 派发处未加 sonnet
- [ ] 5.3 运行 `openspec validate fix-model-task-mismatch --type change --strict`（在 template/ 下）确认 change 工件结构合法；验证：命令退出码 0
