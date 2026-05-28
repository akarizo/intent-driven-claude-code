---
name: spec-html-render
description: 把 OpenSpec change 工件渲染为单文件 HTML 审批面板 `openspec/changes/<change>/spec.html`。当 /opsx-propose 完成所有工件、/opsx-continue 创建一个工件、或用户运行 /spec-html 时调用。HTML 用于用户在浏览器一屏审批意图，不参与 OpenSpec merge。
---

# spec-html-render

把 OpenSpec change 下的 markdown 工件 (proposal / specs / design / tasks) 与 in-force ADR 渲染为一份**单文件 self-contained** 的 HTML 审批面板，让用户双击在浏览器里一眼审批 AI 即将做的事。

## 何时触发

下面三种情况**全部**应当触发本 skill：

1. **/opsx-propose 全部工件创建完成后** — 命令第 4.5 步会调用本 skill (全量首次渲染)。
2. **/opsx-continue 创建完一个工件后** — 命令第 3.5 步会调用本 skill (按当前已存在的工件**全量重渲**，不增量补)。
3. **用户手动 /spec-html `<change-name>`** — 兜底 / 离线刷新。

不触发的情况：

- `/opsx-new` (只 scaffold change 目录，没有内容可渲染)
- `/opsx-explore` (探索阶段没有工件)
- `/opsx-archive` (归档不需要刷新 HTML)
- `/opsx-apply` (实施期间 tasks.md 勾选状态会变；如需重新出 HTML 让用户主动 /spec-html)

## 输入

- `change-name` — kebab-case，来自调用方
- 若调用方没给 (例如 /spec-html 不带参)：跑 `openspec list --json` 用 AskUserQuestion 让用户选

## 输出

- 路径：`openspec/changes/<change-name>/spec.html`
- 行为：直接覆盖；不创建中间文件；一次 Write 完成

## 步骤

1. **确认 change 存在且至少有 1 个工件**

   ```bash
   openspec status --change "<change-name>" --json
   ```

   - 若 change 不存在 → 报错并停
   - 若 `artifacts` 数组里没有任何 `status: "done"` → **直接退出，不写 HTML**（避免空骨架）

2. **并行 Read 已完成的工件**

   按出现情况读：
   - `openspec/changes/<change-name>/proposal.md` (必有)
   - `openspec/changes/<change-name>/specs/**/spec.md` (零到多个，按 capability 分组)
   - `openspec/changes/<change-name>/design.md` (可选)
   - `openspec/changes/<change-name>/tasks.md` (可选)

3. **扫描 in-force ADR**

   ```bash
   ls adr/ 2>/dev/null
   ```

   - 并行 Read 所有 `adr/NNNN-*.md`
   - 解析每份的 `Status:` 与 `Supersedes:` 字段
   - 按 supersedes 链算出当前 in-force 集合 (accepted 且未被 supersede)
   - 若 `adr/` 不存在或为空 → in-force 集合为空，本步骤跳过

4. **读取模板**

   `Read templates/spec.html.tmpl` 拿到完整模板字符串。

5. **替换占位块**

   模板里每个可填段都是这种格式：

   ```html
   <!-- block:NAME -->
   <p class="placeholder">...</p>
   <!-- /block:NAME -->
   ```

   **替换契约**：找到 `<!-- block:NAME -->` 与 `<!-- /block:NAME -->` 之间的全部内容 (不含 marker 本身)，整段替换为新的 HTML。保留 marker，便于幂等。

   下面是必须处理的块清单与渲染规则：

   | block 名 | 来源 | 渲染规则 |
   |---|---|---|
   | `title` | change-name | `<change-name> · 意图审批面板` |
   | `change-name` | change-name | 文本 |
   | `meta-chips` | `openspec status` JSON | 每个 artifact 一个 `<span class="chip" data-state="done|ready|blocked">artifact-id</span>` |
   | `why` | proposal.md `## Why` | 第一段用 `<p class="why-statement">`；后续段落用 `<p class="why-body">` |
   | `what` | proposal.md `## What Changes` + `## Impact` | bullet 转 `<ul><li>...</li></ul>`；Impact 子段用 `<div class="impact"><span class="tag">...</span></div>` |
   | `capabilities` | proposal.md `## Capabilities` | New / Modified 各一个 `<div class="cap-card" data-kind="new|modified">`，含 `<span class="cap-kind">New|Modified</span>`、`<h4>` capability name、`<p>` 描述 |
   | `specs` | 每个 specs/*/spec.md | 每个 capability 一个 `<div class="spec-card">`；ADDED/MODIFIED/REMOVED 用 `<span class="delta" data-op="added|modified|removed">`；每条 requirement 一个 `<div class="requirement">`；每个 scenario 一个 `<div class="scenario">`，steps 用 `<ul class="steps">`，每行 `<li><span class="step-key" data-kw="GIVEN|WHEN|THEN|AND|BUT">KW</span> <span>text</span></li>` |
   | `design` | design.md | 每个二级标题一个 `<div class="design-block">`；Decisions/Risks 子项用 `<details><summary>...</summary>...</details>` |
   | `diagrams` | design.md 中的 ```mermaid 块 | 每块包 `<div class="diagram-frame"><div class="mermaid">...</div><pre class="diagram-fallback">...</pre><div class="caption">...</div></div>`；caption 用图前的最近一行解说 |
   | `mockups` | **条件性** | 见 § 何时画 mockups |
   | `adrs` | in-force ADR 列表 | 每个 ADR 一个 `<li>`，含 `<span class="adr-num">NNNN</span>`、`<a href="../../adr/NNNN-...md">title</a>`、`<span class="adr-status">accepted</span>` |
   | `tasks` | tasks.md | 每个 `## N. Group` 一个 `<details class="task-group">`；每条 `- [ ] N.M ...` 一个 `<li><input type="checkbox" disabled [checked]><span>text</span></li>`；勾选状态读 `[x]` 还是 `[ ]` |
   | `footer` | 自填 | `生成于 YYYY-MM-DD HH:MM · 章节 N · 图示 M · 任务 K` |

   未涉及的块**保留原始 placeholder**，不要清空。

6. **何时画 mockups (block:mockups)**

   触发关键字 (在 proposal 的 capabilities/What/Impact 或 design.md 任意位置出现即可)：

   - UI、UX、界面、页面、表单、表格、组件、按钮、对话框、modal、dashboard、面板
   - 数据流、data flow、pipeline、流水线、ETL
   - 状态机、state machine、状态转换、workflow

   命中后，从 `references/mockup-examples.md` 挑 1-3 个最契合的样例，**改写**成针对本 change 的简化原型 (不要直接照抄)，包在 `<div class="mockup-frame">` 中，含一行 `<div class="caption">原型示意：...</div>` 说明它代表什么。

   **没命中关键字时**：保留模板里的 placeholder 说明文字 ("仅当...才填入；其它情况保留以示无原型需求")，不要画。

7. **Write 单文件**

   一次性 `Write openspec/changes/<change-name>/spec.html` 写入完整 HTML。**不 chunk、不 split、不 Edit 一段一段补**。

8. **简短输出**

   ```
   spec.html → openspec/changes/<change-name>/spec.html
   章节: 9 · 工件: 3/5 · 图示: 2 · 原型: 1
   ```

## 设计原则

- **单文件 self-contained**：除 `https://cdn.jsdelivr.net/npm/mermaid@10/...` 外不引任何外部资源；不引外部字体、图标库、UI 框架。
- **离线兼容**：Mermaid CDN 失败时模板会自动给 `<body>` 加 `.offline`，原始 mermaid 源码以 `<pre>` 显示，不留白屏。
- **HTML 是 render layer**：所有"事实来源"是 markdown 工件；不要在 HTML 里写 markdown 没有的事实，不要修改任何 markdown。
- **反模板**：跟随 Swiss/Editorial 风格 — 大 hero 标题、强对比、克制留白、克制阴影、不滥用渐变。看着不像 GitHub README、不像 shadcn 默认面板。
- **中文为主，必要术语保留英文**：章节 eyebrow、step-key (GIVEN/WHEN/THEN)、技术词保留英文；其余正文中文。
- **幂等**：同一份工件状态重跑 → 产物字节级一致 (footer 的时间戳除外)。
- **不主动改 .gitignore**：spec.html 是否提交由用户决定，本 skill 不干预。

## Guardrails

- **artifact = 0 时不渲染**：避免一份只有占位符的空文件。
- **失败不阻塞 propose/continue**：本 skill 异常时只 warn (用户上下文里看见即可)，不让主流程死掉。
- **不修改 markdown 工件**：所有 markdown 是只读输入。
- **一次 Write 完成**：禁止用 Edit 拼接 HTML。HTML 模板很整体，分段写容易破坏结构。
- **mockup 不要满屏画**：1-3 个足够；多了反而干扰审批。
- **找不到模板时报错**：`templates/spec.html.tmpl` 不存在 → 报错让用户检查 skill 是否完整安装。

## 常见误用

| 误用 | 正解 |
|---|---|
| 用 Edit 一个一个 block 替换 | 整文件读完、字符串替换、一次 Write |
| 把 markdown 原文直接塞 `<pre>` | 把 markdown 语法解析为对应 HTML 结构 (列表、标题、强调) |
| Mermaid 块塞到 `<pre><code>` | 必须用 `<div class="mermaid">...</div>` 让 Mermaid 渲染 |
| capabilities 没分 New / Modified | 必须按 `data-kind="new|modified"` 区分，颜色靠 CSS 自动 |
| 每个 scenario step 用 `<p>` | 必须 `<ul class="steps">` + `<span class="step-key">` 让三色 chip 生效 |
| 在 HTML 里塞"待用户决定的事" | 那是 design.md `## Open Questions` 的事；这里只渲染、不发明 |
