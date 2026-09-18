# flight-preflight-and-retry · 切片公开接口摘要

供下游切片执行体读取；integrator 合回后按节覆盖。

## S1 · slice-gate（S3 依赖的契约，实现前即为约定）

文件：`template/.claude/hooks/slice-gate.py`

- 子命令 `start <S> --change-dir DIR [--base SHA]` — 同片已有标记则保留 `base` / `red_count`，timeline 记 `slice-start <S> (resume)`；`--base` 替代 HEAD 作为新标记基准。
- 子命令 `gate` 的 JSON 新增 `"base": "<sha>"`（本次判定所用基准）。
- 子命令 `preflight --change-dir DIR` — 规划 lint + `gate-baseline.json` 存在 / ok / `plan_sha` 新鲜 / commit 为 HEAD 祖先；通过打印 waves JSON，否则非 0。
- 子命令 `baseline` 产出 `<change>/gate-baseline.json`：`{commit, at, plan_sha, ok, reasons, test{exit,sec}, lint{exit,lines}|null, typecheck{…}|null, verify{<S>:{exit}}}`。
- 规划 lint 新错误前缀：`verify: <S> 含 typecheck/lint 工具 …`。

## S2 · test-evidence

文件：`template/.claude/hooks/test-evidence.py`

- `find_change(root)` 定位顺序：标记 → 分支 `worktree-<name>` → 唯一未完成 change → `(None, None)`。

## S3 · opsx-apply 工作流

- `startCmd(s, base)`；GATE schema 可选 `base`；重试 prompt 第零步 cherry-pick 上一轮 `commit`。

## S4 · 文档

- `pr-ship.md` 唯一一次问询在 step 10；`opsx-propose.md` step 4 基线红即停；`schema.yaml` verify 只跑测试。
