## ADDED Requirements

### Requirement: 提交工件时，已暂存的删除也能提交
`land.ts` 的 `commitArtifacts(io, f, paths)` SHALL 在某个工件的删除已经暂存时照常提交（暂存删除指：暂存区与工作区都没有该文件，`git status --porcelain` 为 `D `）。具体做法：
- 这类路径 SHALL NOT 交给 `git add`；
- 它们 SHALL 仍出现在 `git commit -m … -- <路径>` 的路径里，提交记下该删除。

Feature: 起飞「授权提交」曾被 `fatal: pathspec '…/slices/S5.md' did not match any files` 拒绝（flight-unattended，2026-10-13）。实测：跳过 add、只在 commit 的路径里保留，删除能被正确提交，工作区干净。

#### Scenario: commit-artifacts-handles-staged-deletion
- **GIVEN** 测试世界：工件 `a.md` 已修改未暂存；`S5.md` 的删除已暂存，git status 对它答 `D  …/S5.md`
- **WHEN** 调用 `commitArtifacts(io, f, [a.md, S5.md])`
- **THEN** `git add` 的路径只有 `a.md`
- **AND** `git commit` 的路径同时含 `a.md` 与 `S5.md`
- **AND** 返回没有错误
