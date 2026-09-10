# 切片公开接口摘要

## S1 · 判定脚本 session-model.py

文件：`template/.claude/hooks/session-model.py`

- `ALIASES = ("opus", "sonnet", "haiku", "fable")` — 合法模型别名集合
- `EXIT_UNRESOLVED = 3` — 判定不出主模型时的退出码
- `SYNTHETIC = "<synthetic>"` — 合成会话标记
- `def alias_of(model_id)` — 把完整模型 ID 归一为别名
- `def fail(msg)` — 输出错误并以 EXIT_UNRESOLVED 退出
- `def locate(session_arg)` — 定位会话记录文件路径
- `def last_main_model(path)` — 从会话记录取最近一次主模型
- `def main(argv=None)` — CLI 入口，判定当前会话主模型，判定不出即报错退出

## S3 · 接线与文档

纯文本改动，无代码符号；涉及文件：

- `template/.claude/commands/opsx-apply.md` — 把批准来源改为机械答案
- `template/.claude/commands/pr-ship.md` — 同上，`<main>` 取值机械化
- `template/.claude/skills/openspec-apply-change/SKILL.md` — 与 opsx-apply 命令同改，防漂移
- `README.md` / `docs/WORKFLOW_zh.md` — 文档同步固定契约
- `template/CLAUDE.md.snippet` / `CLAUDE.md` — 模板与仓库根说明同步
- `install.sh` — 安装脚本文本调整（无新增函数，`log_*`/`usage`/`copy_tree` 等既有函数未改签名）
