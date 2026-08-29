# memory-index-integrity

memory 索引层与实体文件之间的完整性契约：索引与文件的双向映射闭合、二级索引的递归展开、索引所述状态与正文的一致性、以及常驻索引的字节预算。本能力回答「索引说的还算不算数」，不回答「哪条知识值得记」——后者属 `claudemd-standard §12b` 的分流判据。

memory 的加载条件决定了本契约的必要性：**索引常驻（每会话必付）、正文按需 recall**。索引失真的成本因此与 `CLAUDE.md` 失真同级，而它此前没有任何机械守护。

## ADDED Requirements

### Requirement: 索引与实体文件双向闭合

memory 索引与实体文件之间 MUST 保持双向映射闭合。索引中的每一个文件指针 MUST 指向真实存在的文件；memory 目录下的每一个实体文件 MUST 被至少一个索引登记。二者任一方向断裂 MUST 被判定为 ERROR 并回灌给 Claude 要求当轮修复，因为断裂意味着「召不回」或「指向不存在」，两者都让常驻索引失去意义。

Feature: Bidirectional index closure
Rule: 索引指针必须指向真实文件，实体文件必须被索引登记，任一方向断裂即 ERROR

#### Scenario: 悬空指针被判定为 ERROR

- GIVEN memory 索引中存在一行指向 `foo-status.md`
- AND memory 目录下不存在 `foo-status.md`
- WHEN memory-lint 执行检查
- THEN 该行被报为 ERROR 并指明缺失的文件名
- AND 检查以退出码 2 结束，结果回灌给 Claude

#### Scenario: 孤儿文件被判定为 ERROR

- GIVEN memory 目录下存在实体文件 `bar-facts.md`
- AND 一级索引与所有二级索引都没有登记 `bar-facts.md`
- WHEN memory-lint 执行检查
- THEN `bar-facts.md` 被报为孤儿 ERROR
- AND 报告指明它未被任何索引登记

#### Scenario: 文件重命名导致的双向断裂被同时报出

- GIVEN 实体文件由 `x-propose-status.md` 改名为 `x-applied-status.md`
- AND 索引行仍指向 `x-propose-status.md`
- WHEN memory-lint 执行检查
- THEN 悬空指针与孤儿文件两条 ERROR 同时被报出
- AND 报告指出二者可能是同一次重命名的两面

### Requirement: 二级索引被递归展开

索引解析 MUST 递归展开二级索引。当 `MEMORY.md` 中的某个指针指向的文件本身也是索引（承载 `- [标题](文件名)` 形式的条目清单）时，其登记的条目 MUST 一并计入「已登记」集合。二级索引是把已完结条目移出常驻层的正当机制，若不递归展开，被下沉的条目 MUST NOT 被误报为孤儿。

Feature: Recursive secondary index expansion
Rule: 二级索引登记的条目计入已登记集合，不得被误报为孤儿

#### Scenario: 二级索引登记的文件不算孤儿

- GIVEN `MEMORY.md` 声明了二级索引 `index-shipped-changes.md`
- AND `index-shipped-changes.md` 登记了 `old-change-status.md`
- AND `MEMORY.md` 自身没有直接登记 `old-change-status.md`
- WHEN memory-lint 执行检查
- THEN `old-change-status.md` 被视为已登记
- AND 它不出现在孤儿报告中

#### Scenario: 二级索引文件自身不被当作孤儿

- GIVEN `MEMORY.md` 声明了二级索引 `index-dlib-parser-facts.md`
- WHEN memory-lint 统计孤儿
- THEN 索引文件自身被排除在实体文件集合之外
- AND 它不出现在孤儿报告中

### Requirement: 索引所述状态与正文保持一致

索引行所述的状态 MUST 与被指向文件的 frontmatter `description` 所述状态一致。当二者出现可判定的矛盾时 MUST 报出提醒，因为常驻层主动提供错误信息比不提供更坏。状态一致性依赖自然语言比对、无法做到完全可判定，故 MUST 判为 warn 而非 ERROR，MUST NOT 阻断写入。

Feature: Index-body status coherence
Rule: 索引行状态词与正文 description 状态词矛盾时提醒，但不阻断

#### Scenario: 状态漂移被提醒

- GIVEN 索引行描述某 change 为「已 propose 未 apply」
- AND 被指向文件的 frontmatter `description` 描述它为「已 apply 40/40 待开 MR」
- WHEN memory-lint 执行检查
- THEN 该行被报为状态漂移 warn
- AND 报告同时给出索引侧与正文侧的状态词
- AND 检查不因此返回退出码 2

#### Scenario: 状态一致时不出声

- GIVEN 索引行与正文 `description` 描述的状态词一致
- WHEN memory-lint 执行检查
- THEN 不产生状态漂移提醒

### Requirement: 常驻索引受字节预算约束

常驻索引 MUST 受字节预算约束，分索引单行与索引总量两档。单行超过提醒线报 warn、超过拦截线报 ERROR；索引总量超过提醒线报 warn。阈值 MUST 明显宽于 `CLAUDE.md` 的对应阈值，因为索引行承担坑位前置警告职能——把危险摘要放在常驻层是刻意设计，按 `CLAUDE.md` 行长标准压缩等同于摘除防护。

Feature: Resident index byte budget
Rule: 索引单行与索引总量分档受限，阈值宽于 CLAUDE.md 以保留坑位警告职能

#### Scenario: 索引行超过提醒线

- GIVEN 某索引行的 UTF-8 字节长度大于提醒线且不超过拦截线
- WHEN memory-lint 执行检查
- THEN 该行被报为行长 warn 并给出实际字节数与阈值
- AND 检查不因此返回退出码 2

#### Scenario: 索引行超过拦截线

- GIVEN 某索引行的 UTF-8 字节长度大于拦截线
- WHEN memory-lint 执行检查
- THEN 该行被报为行长 ERROR
- AND 报告建议把细节下沉到正文、索引行只留主题与关键词

#### Scenario: 常驻索引总量超线

- GIVEN 一级索引与其全部二级索引的字节总量大于总量提醒线
- WHEN memory-lint 执行检查
- THEN 报出总量 warn 并给出当前字节数与阈值
- AND 报告建议把已完结条目下沉到二级索引

### Requirement: memory 目录在运行时推导

memory 目录的位置 MUST 在运行时从当前工作目录推导，MUST NOT 硬编码任何用户名或项目路径。推导规则为：取当前项目根的绝对路径，将其中的 `/` 全部替换为 `-`，拼为 `~/.claude/projects/<该字符串>/memory/`。当推导出的目录不存在或其中没有索引文件时，检查 MUST 静默退出，因为多数项目没有 memory 目录。

Feature: Runtime memory directory resolution
Rule: memory 目录路径运行时推导，缺失时静默退出

#### Scenario: 从项目根推导出 memory 目录

- GIVEN 当前项目根为某绝对路径
- WHEN memory-lint 推导 memory 目录
- THEN 得到 `~/.claude/projects/<路径中 / 换为 - 后的字符串>/memory/`

#### Scenario: 无 memory 目录时静默退出

- GIVEN 推导出的 memory 目录不存在
- WHEN memory-lint 执行检查
- THEN 不产生任何输出
- AND 以退出码 0 结束

#### Scenario: memory 目录存在但无索引时静默退出

- GIVEN memory 目录存在但其中没有 `MEMORY.md`
- WHEN memory-lint 执行检查
- THEN 不产生任何输出
- AND 以退出码 0 结束

### Requirement: 写入 memory 文件后即时校验

`PostToolUse(Write|Edit)` MUST 在被写文件位于 memory 目录内时触发校验，其余情况 MUST 静默放行。校验 MUST 覆盖「该文件是否已被索引登记」，使新写入的 memory 文件在未登记时当场被发现，而不是积累到某次全量检查。任何内部异常 MUST 静默放行——坏门禁不能锁死编辑。

Feature: Post-write memory validation
Rule: 写入 memory 目录内的文件后即时校验其登记状态，异常一律 fail-open

#### Scenario: 新写入的 memory 文件未登记时当场报出

- GIVEN Claude 通过 Write 在 memory 目录下创建了 `new-fact.md`
- AND 该文件尚未被任何索引登记
- WHEN PostToolUse 触发 memory-lint
- THEN 报出孤儿 ERROR 并提示需要在索引中补一行
- AND 以退出码 2 结束

#### Scenario: 写入非 memory 文件不触发

- GIVEN Claude 写入的文件不在 memory 目录内
- WHEN PostToolUse 触发 memory-lint
- THEN 不产生任何输出
- AND 以退出码 0 结束

#### Scenario: 内部异常时放行

- GIVEN memory-lint 在执行过程中发生未预期的内部异常
- WHEN PostToolUse 触发它
- THEN 不产生阻断
- AND 以退出码 0 结束
