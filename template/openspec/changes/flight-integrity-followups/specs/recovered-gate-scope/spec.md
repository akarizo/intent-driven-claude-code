## ADDED Requirements

### Requirement: 找回门禁结论只限同一基点
重派时找回门禁结论，SHALL 要求重派 worktree 的 HEAD 等于结论记录的 base 或 commit。改计划后重飞时，计划改动的提交与新的批准提交会让分支尖端前移，重派 worktree 的 HEAD 与旧 base 不同，SHALL NOT 找回旧结论。本需求钉住现有行为：基点相同就意味着已提交的计划相同，所以不另外绑定计划指纹。
Feature: 改了计划就不能用旧计划下的结论

#### Scenario: resume-start-refuses-record-after-replan
- **GIVEN** 切片 S1 门禁绿、结论已留存，随后飞行中断
- **AND** 人改了计划并提交，又按批准提交了一次，再从新的分支尖端开 worktree
- **WHEN** 新一轮飞行里重派运行 `start S1 --resume-checkpoint`
- **THEN** 以 0 退出，输出不含 recovered，也没有交出旧计划下的 commit
