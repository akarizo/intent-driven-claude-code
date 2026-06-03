#!/usr/bin/env python3
# intent-driven 提醒 · UserPromptSubmit
# 仅当项目已 intent-driven 初始化(存在 openspec/)时，在每个任务开头注入分级 rubric。
# 输出到 stdout 的文本会被 Claude Code 作为附加上下文注入；无 openspec/ 则静默。
import sys, os, json

RUBRIC = (
    "[intent-driven] 动代码前先分级：\n"
    " 中级+（必须 /opsx-propose 走 proposal→specs→design→adr→tasks 五工件）：\n"
    "   新 capability / 新公共 API·命令 / 改公共契约(签名·返回·错误码·数据投影/序列化) /\n"
    "   跨模块 / 引入新抽象·依赖 / 影响数据模型·迁移 / 任何\"半年后要解释为什么\"的长期决策。\n"
    " mini（可跳过；改源码前先 /opsx-mini 留痕）：文档·注释 / 依赖升级 / 配置值 /\n"
    "   单文件无行为变化的 hotfix / 内部一次性脚本。\n"
    " ⚠ 原生 plan mode 的 markdown plan + ExitPlanMode 审批 ≠ intent-driven 工作流，\n"
    "   不满足中级+ 的工件要求——你仍欠五工件。源码写入受 .claude/hooks/intent-gate.py 门禁。\n"
)


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (ValueError, OSError):
        data = {}
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    if not os.path.isdir(os.path.join(root, "openspec")):
        return
    sys.stdout.write(RUBRIC)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
