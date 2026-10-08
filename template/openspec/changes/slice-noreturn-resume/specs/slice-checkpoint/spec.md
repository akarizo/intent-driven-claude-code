## ADDED Requirements

### Requirement: 切片工作中自动快照 owns 内改动
`slice-gate.py checkpoint` 从 stdin 读 hook 载荷（取 `cwd`，缺省用进程 cwd）。当 `cwd` 所在 git 顶层存在 `.openspec-slice` 标记时，SHALL 把该标记切片在 `slices.json` 中 `owns` 匹配的改动（已跟踪文件的修改与删除、未跟踪文件，按文件粒度）连同 HEAD 的树拍成一个以 HEAD 为父的 commit，并写入引用 `refs/flight/<change 目录名>/<S>`。它 SHALL NOT 改动真实 index、HEAD 或工作区文件，SHALL NOT 向 stdout 输出任何内容；没有标记、载荷非法或任何内部异常时 SHALL 静默以 0 退出（hook 坏了不能锁死执行体）。
Feature: 执行体被截断时半成品不丢
Rule: 快照只收 owns 内文件，门禁只认 owns，快照也只认 owns

#### Scenario: checkpoint-snapshots-owned-changes
- **GIVEN** 已 `start` 的切片 S1（owns `src/**` 与 `tests/test_mod.py`），工作区改了已跟踪的 `src/mod.py`、新建了未跟踪的 `src/pkg/new.py`，并在 owns 外新建了 `notes.txt`，都没有提交
- **WHEN** 以 PostToolUse 载荷（`cwd` 为仓库根）运行 `slice-gate.py checkpoint`
- **THEN** 退出码为 0 且 stdout 为空
- **AND** `refs/flight/c/S1` 存在，其树中 `src/mod.py` 与 `src/pkg/new.py` 是新内容，不含 `notes.txt`
- **AND** HEAD 与 `git status --porcelain` 的输出都和运行前一致

#### Scenario: checkpoint-silent-without-marker
- **GIVEN** 有 change 计划、工作区有未提交改动，但没有 `.openspec-slice` 标记
- **WHEN** 分别以合法载荷与一段非法 JSON 运行 `slice-gate.py checkpoint`
- **THEN** 两次都以 0 退出且 stdout 为空
- **AND** 仓库中没有任何 `refs/flight/` 引用

### Requirement: 重派时从快照恢复半成品
`slice-gate.py start <S> --resume-checkpoint` SHALL 先做既有校验（切片存在、`--expect-branch`）。工作区已有同一切片的标记时 SHALL 沿用既有 resume 行为（半成品就在工作区）。否则：引用 `refs/flight/<change>/<S>` 存在且 HEAD 是它的祖先时，SHALL 把快照相对 HEAD 在 owns 内有差异的文件恢复为未提交改动（快照中已删除的文件从工作区删除），HEAD 不变，再按既有规则写标记；stdout JSON SHALL 带 `checkpoint` 对象，`restored` 列出恢复的文件，timeline 的 `slice-start` 备注含 `checkpoint`。快照不存在或 HEAD 不是其祖先时 SHALL 不恢复任何文件，`checkpoint.restored` 为空并以 `checkpoint.note` 说明原因，标记照常写入。
Feature: 隔离模式重派拿到新 worktree 也能接着做
Rule: 只在快照建立在当前基点之上时恢复，基点不符宁可从头做

#### Scenario: start-resume-restores-checkpoint
- **GIVEN** 切片 S1 在基点 X 上已 commit 了 `src/a.py`，另有未提交的 `src/mod.py` 改动，`checkpoint` 已拍快照
- **AND** 从 X 新开一个干净的 worktree（模拟隔离模式重派）
- **WHEN** 在新 worktree 中运行 `start S1 --change-dir <dir> --resume-checkpoint`
- **THEN** 退出码为 0，`src/a.py` 与 `src/mod.py` 以快照内容出现在工作区，HEAD 仍是 X
- **AND** stdout JSON 的 `base` 为 X，`checkpoint.restored` 恰为这两个文件
- **AND** timeline 最后一行事件为 `slice-start`，备注含 `checkpoint`

#### Scenario: start-resume-skips-foreign-base
- **GIVEN** S1 在基点 X 上的快照已存在
- **AND** 在 X 之后另一条不在快照祖先链上的 commit Y 上新开 worktree
- **WHEN** 在该 worktree 中运行 `start S1 --change-dir <dir> --resume-checkpoint`
- **THEN** 退出码为 0，工作区文件保持 Y 上的内容
- **AND** stdout JSON 的 `checkpoint.restored` 为空、`checkpoint.note` 非空，`base` 为 Y

### Requirement: 快照只活在本次飞行内
写新标记的 `start`（不带 `--resume-checkpoint`）SHALL 在写标记前删除本切片的 `refs/flight/<change>/<S>`，使重派时能用到的快照只来自本次飞行的首轮执行。`gate` 判定为绿时 SHALL 删除本切片的快照引用；判定为红时保留。
Feature: 不跨飞行接续
Rule: 用户裁决——快照只用于本次飞行内的重派

#### Scenario: start-fresh-clears-stale-checkpoint
- **GIVEN** 切片 S1 留有旧快照引用 `refs/flight/c/S1`，且工作区没有标记
- **WHEN** 不带 `--resume-checkpoint` 运行 `start S1 --change-dir <dir>`
- **THEN** 退出码为 0，且 `refs/flight/c/S1` 已不存在

#### Scenario: gate-ok-deletes-checkpoint
- **GIVEN** 已 `start` 且实现完整的切片 S1（门禁会绿），存在快照引用 `refs/flight/c/S1`
- **WHEN** 运行 `slice-gate.py gate S1 --change-dir <dir>`
- **THEN** 门禁 JSON 的 `ok` 为 true
- **AND** `refs/flight/c/S1` 已不存在
