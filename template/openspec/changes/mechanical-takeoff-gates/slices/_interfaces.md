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

## S2 · 收口路由对账：session-decompose.py --expect-models

文件：`template/.claude/hooks/session-decompose.py`（`tests/test_evidence_timeline.py` 无新增公开符号）

- `PHASE_ROLE = {"Implement": "executor", "Fix": "executor", "Review": "reviewer", "Finalize": "integrator"}` — 阶段名到角色的映射
- `ROLE_ORDER = ("executor", "reviewer", "integrator")` — 角色展示顺序
- `EXIT_ROUTE_MISMATCH = 3` — 路由核对不通过时的退出码
- `def load_alias_of()` — 加载模型别名判定函数（复用 S1 alias_of）
- `def workflow_agents(wf_dir)` — 解析 workflow 目录下各 agent 声明
- `def role_of(desc)` — 由 agent 描述推断角色
- `def audit_routes(agents, expect, alias_of)` — 核对实际路由是否符合 `--expect-models` 期望，不符则退出 EXIT_ROUTE_MISMATCH
- `def decompose(rows)` / `def classify_user(d)` / `def text_of(content)` / `def ts(s)` / `def load(path)` — 既有转录解析辅助（未改签名）
- `def subagent_stats(sub_dir, launches)` / `def fmt_h(sec)` — 既有耗时统计辅助
- `def main()` — CLI 入口，新增 `--expect-models` 用于收口路由对账

## S4 · 起飞批准门禁 takeoff-gate.py（CLI + PreToolUse hook）与 propose 硬交接

文件：`template/.claude/hooks/takeoff-gate.py`（新增），`template/.claude/hooks/hooks.json`，`template/.claude/commands/opsx-propose.md`，`template/.claude/skills/openspec-propose/SKILL.md`，`tests/test_approval_gate.py`

- `DISPATCH_TOOLS = ("Workflow", "Agent", "Task")` — 受门禁拦截的派发类工具
- `APPLY_CMD_RE` — 匹配 `/opsx-apply` `/opsx-bulk-apply` 命令的正则
- `APPROVE_WORD_RE` — 匹配"批准/起飞/授权/approve/go ahead"等人类批准用词
- `CHANGE_PATH_RE` — 从文本中提取 `openspec/changes/<name>` 路径
- `NON_HUMAN_MARKERS` — 用于排除自述/自发批准的标记集合
- `PLAN_FILES = ("proposal.md", "design.md", "tasks.md", "slices.json")` — 判定飞行计划是否存在的文件集合
- `EXIT_NO_APPROVAL = 3` — 未获批准时的退出码
- `def verdict(change_dir, session)` — 判定该 change 是否已获得新鲜的人类批准
- `def latest_approval(path)` / `def approval_of(text)` — 从会话记录中定位并解析最近一次批准
- `def plan_mtime(change_dir)` — 取飞行计划文件的最新修改时间，用于"新鲜度"比对
- `def locate_cli(session_arg)` / `def locate_by_sid(sid)` — 定位会话记录文件（CLI 用）
- `def run_cli(args)` — CLI 子命令入口，供人工/脚本查验批准状态
- `def find_change_dir(payload)` / `def locate_hook(payload)` — 从 hook payload 反推 change 目录与会话记录（hook 用）
- `def emit_deny(reason)` — 以 EXIT_NO_APPROVAL 输出拒绝派发的原因
- `def run_hook(raw)` — PreToolUse hook 主流程：未批准即 emit_deny 拒绝 Workflow/Agent/Task 派发
- `def main(argv=None)` — 统一入口，区分 CLI 子命令与 hook 调用模式
- `hooks.json` — 新增 `PreToolUse` 对 `Workflow|Agent|Task` matcher 挂载 `takeoff-gate.py`
- `opsx-propose.md` / `openspec-propose/SKILL.md` — propose 流程结尾新增硬交接提示（等待人类批准，禁自行起飞）
