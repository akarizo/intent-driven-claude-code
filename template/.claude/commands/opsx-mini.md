---
description: 声明一个 mini 任务以跳过 intent-driven 5 工件工作流（留痕 openspec/.mini-active）
---

把一个**确属 mini** 的任务登记下来，让 PreToolUse 门禁（`.claude/hooks/intent-gate.py`）放行其源码写入。
mini 是「被允许但必须被命名」的跳过——marker 留痕，便于事后审计是否误判。

**输入**：`/opsx-mini "<理由>; 范围: <file 或 glob>[, <file2> ...]"`，或 `/opsx-mini --done` 清除声明。

## --done（清除）

删除 `openspec/.mini-active`，回报「mini 声明已清除」。

## 登记 mini

1. **先按 rubric 自检**。命中任一**中级+ 触发器**就**拒绝登记**，让用户改走 `/opsx-propose`：
   - 新 capability / 新公共 API·命令
   - 改公共契约：签名 / 返回结构 / 错误码 / **数据投影·序列化**
   - 跨模块 / 跨子系统
   - 引入新抽象 / 新依赖 / 新模式
   - 影响数据模型 / 迁移 / 存储格式
   - 任何「半年后需要解释为什么这么写」的长期决策

   只有确属下列才继续：文档·注释单改 / 依赖升级 / 配置值调整 / 单文件无行为变化 hotfix / 内部一次性脚本。

2. **确定范围**。问清/推断这次会改哪些文件，精确到 file 或窄 glob（如 `utils/log.py`、`src/auth/*.py`）。
   范围越窄越好；范围外的文件门禁仍会拦。

3. **取 UTC 时间**：运行 `date -u +"%Y-%m-%dT%H:%M:%SZ"`。

4. **写 marker** `openspec/.mini-active`（写它本身落在豁免路径，不会被门禁拦）：

   ```
   # intent-driven mini-task marker (auto-managed; /opsx-mini --done to clear)
   reason: <理由原文>
   created: <上一步的 UTC 时间戳>
   scope:
   - <file 或 glob>
   - <...>
   ```

5. **回报**：marker 已写、覆盖哪些文件、24h 后自动失效、完成后请 `/opsx-mini --done`。

## 边界

- marker 仅在 24h 内、且仅对 `scope` 内文件有效；写 scope 外文件仍被门禁拒绝。
- **不要为绕过门禁把中级+ 任务登记成 mini**——marker 是留痕的，会被一眼看穿。
- 这条命令只影响门禁放行，不替代任何工作流；真正的中级+ 变更仍走 `/opsx-propose`。
