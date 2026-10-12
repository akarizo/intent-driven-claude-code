## ADDED Requirements

### Requirement: 安装器移除退役 hook 注册
`install.sh` 合并 settings 时 SHALL 移除命令串与历代模板下发的退役 hook 完全相同的项（takeoff-gate 无参、`slice-gate.py checkpoint`、stop-gate），用户自写的命令 SHALL NOT 改动；目标里存在退役文件（`.claude/workflows/opsx-apply.js`、`.claude/agents/integrator.md`、`.claude/agents/slice-executor.md`、`.claude/hooks/session-decompose.py`）时 SHALL 在收尾输出里列出并提示可手动删除，SHALL NOT 替用户删除。
Feature: 已安装项目升级后不再调用退役 hook

#### Scenario: install-removes-retired-hooks
- **GIVEN** 一个已安装旧版模板的目标项目：
  - `.claude/settings.json` 注册了三条退役 hook（模板原样命令串）；
  - 另有一条用户自写的 `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-gate.py" --mine`；
  - `.claude/workflows/opsx-apply.js` 存在
- **WHEN** 以升级方式运行 `install.sh`
- **THEN** settings 里三条退役注册都不在，用户那条仍在
- **AND** 输出含「退役」与 `.claude/workflows/opsx-apply.js`，该文件仍存在
