## ADDED Requirements

### Requirement: 已暂存删除的识别不受路径引号影响
`commitArtifacts` 识别已暂存删除时，SHALL 读 `git status --porcelain -z` 的输出：
- 按 NUL 切成条目；
- 改名条目带第二个路径，SHALL 跳过它；
- 含中文或空格的路径 SHALL 与传入的路径逐字比对。

以下两种情形 SHALL 有用例覆盖：
- 全部路径都是已暂存删除时，不调用 `git add`；
- `git status` 失败时，照旧对全部路径 `git add`。

Feature: PR #54 LOW：不带 `-z` 时，git 默认 `core.quotePath` 会给含非 ASCII 字符的路径加引号转义，与传入路径对不上，又退回「pathspec 不匹配」的老错误；两种边界情形也没有用例。

#### Scenario: staged-deletion-edge-cases
- **GIVEN** 三个测试世界：
  - 甲：`切片/S5.md` 的删除已暂存，`a.md` 已修改，`git status --porcelain -z` 原样给出这两条；
  - 乙：传入的两个路径都是已暂存删除；
  - 丙：`git status` 以 1 退出
- **WHEN** 分别调用 `commitArtifacts`
- **THEN** 甲的 `git add` 只含 `a.md`，`git commit` 含两个路径
- **AND** 乙没有调用 `git add`，`git commit` 含两个路径
- **AND** 丙对全部路径调用了 `git add`
