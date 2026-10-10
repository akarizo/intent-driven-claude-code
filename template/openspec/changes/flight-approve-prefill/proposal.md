## Why

两个目的，范围都很小：

1. **实测 0.3.1 的 Bash 改写**：#42 的全量评审指出，D1（插件把飞行 agent 的 Bash 改写为 `cd '<自己的 worktree>' && …`）只在测试替身里验证过，真实引擎里还没跑过。正式飞 `flight-measure` 之前，先用一次单切片的冒烟飞行确认两件事：执行体的 shell 确实落在自己的切片 worktree 里；提示词首行带着 worktree 说明。
2. **顺带修 #42 评审的一条 LOW**：重复按「批准起飞」时，批准带只 toast「已批准（指纹相同）」，不像第一次那样把 `/opsx-apply <change>` 预填进输入框。如果人第一次按完关掉了预填，再按也拿不到下一步提示。

## What Changes

- **批准带**：重复批准的分支在 toast 之后，同样调用 `$.prompt.fill` 预填 `/opsx-apply <change>`；预填失败时，toast 补一句提示人手动输入。
- **冒烟探针**：切片包要求执行体开工时先运行 `pwd && git rev-parse --abbrev-ref HEAD`，并把输出原样写进最后的回复。主会话据此和执行体转录核对 Bash 改写是否生效。

无 BREAKING。

## Capabilities

### New Capabilities
- `flight-approve-prefill`：重复批准时同样预填起飞命令。

### Modified Capabilities
（无。）

## Impact

- `template/plugins/flight/hooks/register.tsx`、`template/plugins/flight/tests/flight.test.tsx`、`tests/test_flight_plugin.py`。
- **本次飞行就是 0.3.1 的第一次实战**：飞行期间，主会话停在已作废的 `.worktrees/flight-envelope-followups` 里，并且不 cd。这样，如果改写没生效，执行体的 `pwd` 就会是那棵作废树，信号一眼可见；改写生效时，`pwd` 是它自己的切片 worktree。
