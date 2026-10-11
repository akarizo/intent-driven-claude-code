## ADDED Requirements

### Requirement: /pr-ship 预合并用 merge-tree --write-tree 判断冲突
`template/.claude/commands/pr-ship.md` 第 4 步 SHALL 用 `git merge-tree --write-tree --name-only HEAD origin/<target>` 的退出码判断：0 为无冲突，1 为有冲突并列出冲突文件，其他退出码报告错误；SHALL NOT 再用 `grep -c "^<<<<<<<"` 统计旧版三参数 `merge-tree` 的输出。
Feature: #46 实测：旧检查对 2 个冲突文件报 0（冲突标记前带 `+`）

#### Scenario: premerge-uses-write-tree
- **GIVEN** 本 change 合入后的 pr-ship.md
- **WHEN** 读取第 4 步
- **THEN** 含 `merge-tree --write-tree` 与「退出」
- **AND** 不含 `grep -c "^<<<<<<<"`
