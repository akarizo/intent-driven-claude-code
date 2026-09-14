## ADDED Requirements

### Requirement: 故意的简化必须留下天花板与升级路径
切片提交里的 `ceiling:` 标记 SHALL 同时给出**限制**与**升级条件或路径**两段；只给一段的标记 MUST NOT 通过切片门禁。合规标记 SHALL 被汇总进该 change 的 `gate-report.md`，使简化决策与门禁结论同处一份记录。
Feature: 切了真角的地方，理由钉在代码旁，不靠会话记忆
Rule: 标记只校验完整性，不校验"该不该标"——后者是评审的事

#### Scenario: ceiling-marker-passes-gate
- **GIVEN** 一个已 `start` 的切片，区间内新增的源码行含行首注释标记 `# ceiling: 全局锁，单进程内够用 -> 吞吐成为瓶颈时换 per-account 锁`
- **WHEN** 运行 `python3 .claude/hooks/slice-gate.py gate <S> --change-dir <dir>`
- **THEN** `failed` 里没有任何以 `G8` 开头的项
- **AND** `gate-report.md` 出现「天花板」表，其中一行同时含该标记所在的 `文件:行号`、限制段文本与升级路径段文本
- **AND** 全角箭头 `→` 与半角 `->` 同样被接受

#### Scenario: ceiling-missing-upgrade-path
- **GIVEN** 区间内新增的源码行含 `# ceiling: 先用全局锁`（只有限制，无分隔符与升级路径）
- **WHEN** 运行切片门禁
- **THEN** `ok` 为 `false`，`failed` 含一项以 `G8 ceiling:` 开头并点名该标记的 `文件:行号`
- **AND** 该项的文本说明缺的是升级路径，且给出期望形状 `限制 -> 升级条件/路径`

#### Scenario: ceiling-missing-limit
- **GIVEN** 区间内新增的源码行含 `# ceiling: -> 以后优化`（有分隔符与升级段，但限制段为空）
- **WHEN** 运行切片门禁
- **THEN** `ok` 为 `false`，`failed` 含一项以 `G8 ceiling:` 开头并点名该标记的 `文件:行号`
- **AND** 两段中任一段去空白后短于 4 个字符时同样被判为缺段

### Requirement: 判据不得越界扫描
`ceiling` 判据 SHALL 只扫描本切片区间内**新增的源码行**，且只匹配**行首注释紧跟标记**的形式；无标记的切片 MUST NOT 因此判红，文档与配置文件、以及代码中偶然出现 `ceiling:` 字样的非注释行 MUST NOT 触发判定。
Feature: 门禁只在它确实该说话的地方说话
Rule: 宁可漏判，不可把「没标」变成红 —— 否则判据退化成形式主义标注

#### Scenario: no-marker-no-gate
- **GIVEN** 一个已 `start` 的切片，区间内改动的源码与测试里**不含任何** `ceiling:` 标记
- **WHEN** 运行切片门禁
- **THEN** `failed` 与 `warnings` 里都没有以 `G8` 开头的项，门禁结论与该判据引入之前一致
- **AND** 同一区间内若存在含 `ceiling:` 字样但非行首注释的代码行（如 `CEILING_RE = re.compile(r"ceiling:")`），仍不触发判定
- **AND** 同一区间内若 Markdown 文档里写了 `# ceiling: 示例` 作为说明，仍不触发判定

### Requirement: 实现段携带减法纪律
切片执行体的契约 SHALL 包含三条减法纪律——写新符号前先查项目内是否已有同义实现、改函数体前先查全部 caller 并修在汇流处、故意切角的简化用 `ceiling:` 标记留痕；评审员的契约 SHALL 包含「症状修复」这一审查维度。两者 MUST NOT 以 LOC 或 diff 行数作为判断依据。
Feature: 减法发生在动手前，评审退为兜底
Rule: 只在实现段生效，不进常驻记忆

#### Scenario: executor-carries-subtractive-rules
- **GIVEN** `template/.claude/agents/slice-executor.md`
- **WHEN** 读它的纪律段
- **THEN** 三条减法纪律都在：先查已有同义实现再写、改函数体前查全部 caller 修在汇流处、切角简化写 `ceiling:` 标记
- **AND** 正文不含任何以行数 / LOC 为阈值的要求

#### Scenario: reviewer-flags-symptom-fix
- **GIVEN** `template/.claude/agents/code-reviewer.md`
- **WHEN** 读它的审查 checklist
- **THEN** 正确性维度含「症状修复」一条，要求检查同类输入经其他 caller 是否仍失败
- **AND** 既有的可维护性维度（重复代码 · 未要求的抽象 / 过度设计）一条不少
