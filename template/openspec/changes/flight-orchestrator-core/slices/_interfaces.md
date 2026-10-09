# 公开接口摘要

## S1 template/.claude/hooks/ledger.py
```

## S5 template/plugins/flight/hooks/io.ts
- `ioOf($)`: 由 EngineInterface 构造 Io
- `trees(io, cwd)` / `judgesDir(io, mainTree)`: worktree 列表 / judge 脚本目录
- `judge(io, f, name, args, cwd, timeoutMs?)`: 运行 judge 脚本
- `readLedger(io, f)` / `appendEvent(io, f, event)`: 读账本 / 追加事件
- `worktreePath(f, name)` / `ensureWorktree(io, f, name)`: 切片 worktree 路径 / 确保存在
- `agentType(role)` / `spawnAgent(...)`: 角色到 agent 类型 / 派发
- `flights: Map<string, Flight>` / `flightOfAgent(io, agentId)`: 飞行登记表 / 按 agent 反查

## S6 template/plugins/flight/hooks/land.ts
- `RECORD_FILES`: 飞行记录文件清单
- `mergeSlice(io, f, slice, gate, owns)`: 合回切片并刷新接口摘要
- `prepareResolve(io, f, slice)` / `finishResolve(io, f, slice, gate, owns)`: 冲突解决 worktree 准备 / 收尾
- `mergeFix(io, f, note)`: 合回 fix
- `validateFindings(input)`: 校验评审发现
- `closeout(io, f, lists, merged)`: 收口
