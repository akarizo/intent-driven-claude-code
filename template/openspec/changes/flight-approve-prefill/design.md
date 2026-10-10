## Context

#42 落地了插件 0.3.1：`tool.call` 把飞行 agent 的 Bash 改写为 `cd '<自己的 worktree>' && <原命令>`。这样做是因为实测发现 spawn 给的 `cwd` 不生效，agent 的 shell 跟着主会话当前的目录走。但这个改写只在 `claude plugin test` 的测试替身里验证过。

## Decisions

### D1 · 重复批准同样预填
`register.tsx` 里 `outcome === 'duplicate'` 的分支，toast 之后与正常批准走同一段预填：
- `const filled = await $.prompt.fill({ text: '/opsx-apply <change>' })`；
- `filled.isFilled` 为 false 时，再 toast 一次 `flight：已批准 <change>，请手动输入 /opsx-apply <change>`，与正常批准分支的措辞一致。

### D2 · 冒烟探针放在切片包里
探针是一条要求执行体执行的命令，不是插件代码：`pwd && git rev-parse --abbrev-ref HEAD`，输出原样写进最后的回复。
- 主会话事后对照执行体转录里这条命令的结果判定：
  - `pwd` 是 `<主 worktree>/.claude/worktrees/flight-flight-approve-prefill-S1`，分支是 `flight/flight-approve-prefill/S1` → 改写生效；
  - 是停车位 `.worktrees/flight-envelope-followups` → 未生效。
- 判定结果写进 PR 正文。

## Risks / Trade-offs

- **改写未生效**：执行体会落在停车位那棵作废树里。0.3.1 的写入包络仍然会拒绝它写到自己 worktree 之外，提示词首行也给了绝对路径，所以切片本身大概率照样能完成。探针结果就是判定依据。
- **本会话处于 bypass 权限模式**：这次测不到 default 模式下引擎对 `cd` 前缀判 ask 还是 deny（#42 评审的另一半疑问）。这一点在 PR 里如实写明，留到 default 模式会话里再测。

## Migration Plan

合入后执行 `claude plugin update`，再 `/reload-plugins`，确认版本 0.3.2（本 change 升小版本）。

## Open Questions

无。
