---
description: 渲染/刷新 openspec/changes/<change>/spec.html 意图审批面板（手动触发）
---

把当前 OpenSpec change 的 markdown 工件渲染为 `openspec/changes/<change>/spec.html`，作为浏览器里的意图审批面板。

**Input**: `/spec-html` 后的参数是 change-name (kebab-case)；不传则让用户选。

**Steps**

1. **确定 change-name**

   - 若用户传了参数 → 直接用
   - 若没传 → 跑 `openspec list --json`，用 **AskUserQuestion** 让用户选最近修改的 3-4 个；最新一个标 `(Recommended)`

2. **调用 spec-html-render skill**

   按 `.claude/skills/spec-html-render/SKILL.md` 的 8 步流程执行：读工件 → 读 in-force ADR → 读模板 → 替换 block → 判定 mockup → Write `openspec/changes/<change>/spec.html`。

3. **输出一行汇总**

   ```
   spec.html → openspec/changes/<change-name>/spec.html
   章节: 9 · 工件: 3/5 · 图示: 2 · 原型: 1
   ```

   并附一句提示：`双击文件或 open openspec/changes/<change>/spec.html 即可在浏览器里审批意图。`

**Guardrails**

- 若 change 的 artifact 数 = 0 → 优雅拒绝："change 还没有任何已完成工件，先跑 /opsx-propose 或 /opsx-continue 再渲染。"
- 不修改任何 markdown 工件
- 渲染失败时只 warn，不抛异常
