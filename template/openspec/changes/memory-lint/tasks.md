> **TDD 适用（无例外）**：本 change 含生产代码 `template/.claude/hooks/memory-lint.py`，`openspec-apply-change` § 7 的「纯文档 / 纯配置」例外条款**不适用**。每个功能组 MUST 先写测试、验红，再写最小实现、验绿。单测以 Given/When/Then 三段中文注释先于代码。
>
> **测试落点**：`tests/test_memory_lint.py`（仓库根，**不进 `template/`**——`install.sh` 是无排除全量 copy_tree，见 design D7）。被测脚本文件名带 `-`，用 `importlib.util.spec_from_file_location` 加载。
>
> **运行时约束**：本机 `python3` 为 **3.9.6**，禁用 3.10+ 语法（`match`、`X | Y` 类型标注、`zip(strict=)`）。

## 1. 测试基础设施与阈值常量

- [x] 1.1 新建 `tests/test_memory_lint.py`，用 `importlib.util.spec_from_file_location` 加载 `template/.claude/hooks/memory-lint.py`，写一个只断言模块可加载的冒烟测试；验证：`python3 -m pytest tests/ -q` 该测试**失败**（脚本尚不存在）——RED
- [x] 1.2 新建 `template/.claude/hooks/memory-lint.py`，仅含 shebang、docstring 与阈值常量 `LINE_WARN=400` / `LINE_ERR=700` / `INDEX_BUDGET=28*1024`；验证：1.1 转绿，且 `python3 -c` 读出的三个常量值与 design D2 表逐一相等——GREEN
- [x] 1.3 在 `tests/` 加一个 pytest fixture，用 `tmp_path` 造一个假 memory 目录（含 `MEMORY.md` + 若干实体文件），供后续全部测试复用；验证：fixture 返回的路径下 `MEMORY.md` 存在且可读

## 2. memory 目录推导与静默退出

- [x] 2.1 先写测试：给定项目根绝对路径，`memory_dir_for()` 返回 `~/.claude/projects/<路径 / 换 ->/memory`；用两条真实路径（`/Users/x/Workspace/amc-afa`、`/a/b/c`）断言逐字符相等；验证：测试失败——RED
- [x] 2.2 实现 `memory_dir_for(project_root)`，只做正向 `replace("/", "-")`（design D5）；验证：2.1 转绿
- [x] 2.3 先写测试：memory 目录不存在 → `run()` 返回 `([], [])` 且无输出；memory 目录存在但无 `MEMORY.md` → 同样静默；验证：两条测试失败——RED
- [x] 2.4 实现两处静默退出分支；验证：2.3 转绿，且对一个真实无 memory 的项目路径跑 CLI 输出为空、退出码 0

## 3. 索引解析与二级索引递归

- [x] 3.1 先写测试：`parse_index()` 从 `- [标题](foo.md)` 行提取出 `foo.md`；同一行含多个指针（`· [A](a.md) · [B](b.md)`）时全部提取；验证：测试失败——RED
- [x] 3.2 实现 `parse_index()`，正则提取 `](文件名.md)`，返回 `[(行号, 行文本, 目标文件名)]`；验证：3.1 转绿
- [x] 3.3 先写测试：`MEMORY.md` 指向 `index-shipped.md`，后者登记 `old.md`；`collect_registered()` 返回的集合**同时包含** `index-shipped.md` 与 `old.md`；验证：测试失败——RED
- [x] 3.4 实现 `collect_registered()`，对文件名以 `index-` 开头的目标递归一层，用 visited 集合防环（design D3）；验证：3.3 转绿
- [x] 3.5 先写测试（**反向防漏报**）：一个**非** `index-` 命名的普通 memory 文件正文里含 `- [x](other.md)` 链接时，`other.md` **不得**被计入已登记；验证：测试失败——RED
- [x] 3.6 收紧 3.4 的递归条件为「仅 `index-` 前缀」；验证：3.5 转绿，且 3.3 仍绿

## 4. 双向闭合：悬空指针与孤儿文件

- [x] 4.1 先写测试：索引指向 `missing.md` 但文件不存在 → 产出一条 ERROR，文本含 `missing.md` 与行号；验证：测试失败——RED
- [x] 4.2 实现悬空指针检查；验证：4.1 转绿
- [x] 4.3 先写测试：实体文件 `orphan.md` 未被任何索引登记 → 产出一条 ERROR，文本含 `orphan.md`；验证：测试失败——RED
- [x] 4.4 实现孤儿检查，**排除** `MEMORY.md` 自身与全部 `index-*.md`；验证：4.3 转绿
- [x] 4.5 先写测试（**重命名双面**）：造 `x-applied.md` 存在、索引指向 `x-propose.md` 的场景 → 同时产出悬空与孤儿两条 ERROR；验证：测试失败——RED
- [x] 4.6 让报告在同时命中两者时追加一句「二者可能是同一次重命名的两面」；验证：4.5 转绿
- [x] 4.7 先写测试（**mutation 自证**）：把 4.2 的悬空检查条件人为反转（存在时才报），4.1 MUST 变红；恢复后 MUST 变绿；验证：手工执行该 mutation 并记录两次结果，证明测试对该缺陷有检验力

## 5. 状态漂移

- [x] 5.1 先写测试：`stage_of("已 propose 未 apply")` 返回 1、`stage_of("已 apply 40/40 待开 MR")` 返回 3、`stage_of("已合 main 并部署 eks-test")` 返回 5、`stage_of("与阶段无关的文本")` 返回 0；验证：测试失败——RED
- [x] 5.2 实现 `stage_of()`，按 design D4 的五级有序表（取命中的**最高**阶段）；验证：5.1 转绿
- [x] 5.3 先写测试：索引行 stage=1、正文 frontmatter `description` stage=3 → 产出一条 **warn**（不是 ERROR），文本同时含两侧状态词；验证：测试失败——RED
- [x] 5.4 实现状态漂移检查，**只读 frontmatter `description` 单行**、不扫正文全文（design D4）；验证：5.3 转绿
- [x] 5.5 先写测试（**防误报**）：正文**正文体**里含「此前 propose 时……」但 `description` 与索引行同为 stage=4 → **不得**产生任何 warn；验证：该测试直接绿（若红则说明 5.4 扫了全文，须修）
- [x] 5.6 先写测试：两侧 stage 相等、或任一侧为 0（无法判定）→ 不产生 warn；验证：测试转绿

## 6. 字节预算

- [x] 6.1 先写测试：401 B 的索引行 → 一条 warn；701 B → 一条 ERROR；400 B → 无输出；验证：测试失败——RED
- [x] 6.2 实现索引行长检查，按 **UTF-8 字节**（非字符）计长；验证：6.1 转绿，且用一行纯中文断言字节数 ≠ 字符数
- [x] 6.3 先写测试：一级索引 + 全部二级索引字节和 > 28 KB → 一条 warn，文本含实际字节与阈值；验证：测试失败——RED
- [x] 6.4 实现常驻总量检查；验证：6.3 转绿
- [x] 6.5 用真实 `amc-afa` 目录跑一次 CLI 全量（只读，不写）；验证：记录实际输出——**期望零 ERROR**（立项调研中三处已手工修复），若有 ERROR 须逐条核实是真缺陷还是脚本误报

## 7. hook 入口与 fail-open

- [x] 7.1 先写测试：构造 `PostToolUse` payload（`{"tool_input":{"file_path":"<memory 目录内某新文件>"}}`）喂给 `cmd_hook()`，该文件未被索引登记 → 返回 2 且 stderr 含孤儿提示；验证：测试失败——RED
- [x] 7.2 实现 `cmd_hook()`，读 stdin JSON、判目标是否在 memory 目录内、不在则 `return 0`；验证：7.1 转绿
- [x] 7.3 先写测试：payload 的 `file_path` 指向仓库内普通文件 → 返回 0 且 stderr 为空；验证：测试转绿
- [x] 7.4 先写测试（**fail-open**）：stdin 非法 JSON、`file_path` 缺失、memory 目录权限异常三种情况 → 均返回 0 且不抛异常；验证：三条测试失败——RED
- [x] 7.5 用 try/except 包住 `cmd_hook()` 全体，异常一律 `return 0`（design D6）；验证：7.4 转绿
- [x] 7.6 实现 `main()`：`--hook` 走 hook 模式、`--all` 走全量 CLI、无参默认全量；有 ERROR 时 stderr 输出并 `return 2`，仅 warn 时输出并 `return 0`；验证：三种入参各跑一次，退出码与预期相符

## 8. hooks.json 挂载

- [x] 8.1 在 `template/.claude/hooks/hooks.json` 的 `PostToolUse` 数组里，给已有的 `Write|Edit` matcher 追加一条 `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/memory-lint.py" --hook`；验证：`python3 -c "import json;json.load(open(...))"` 通过，且 `PostToolUse[0].hooks` 长度为 2
- [x] 8.2 确认 `install.sh` 的 hooks 合并按 command 去重、重跑 install 幂等；验证：读 `install.sh` 合并逻辑确认按 command 元组去重，不需改动该脚本

## 9. spec 与文档同步

- [x] 9.1 `template/.claude/claudemd-standard.md` `§12` 预算表增两行：memory 索引单行（提醒 > 400 B · 拦截 > 700 B）、memory 常驻索引总量（提醒 28 KB），并注明「刻意宽于 CLAUDE.md，因索引行承担坑位前置警告职能」；验证：`§12` 表格含 `memory` 字样的行数为 2
- [x] 9.2 `§12b` 四载体表扩为五载体，新增 `memory/` 行：加载条件「索引常驻 + 正文按需 recall」、装什么「查证得来的事实 / 踩坑根因 / 外部系统真实行为」、常驻成本「一行索引」；验证：该表行数由 4 增至 5，且含 `recall` 字样
- [x] 9.3 `§12b` 判据段补 memory 与 CLAUDE.md 的分界：「不知道它会**做错事** → CLAUDE.md（约束）；不知道它只是**多花时间** → memory（发现）」，并写明准入门槛「每条 memory 给所有会话永久加一行常驻索引，未来 10 次会话用不到 1 次的不该进 memory」；验证：该段同时含「做错事」与「多花时间」两个锚点
- [x] 9.4 `§12b` 补二级索引下沉机制与 `index-*.md` 命名约定；验证：该节含 `index-` 字样
- [x] 9.5 `§13` 合约表增 `memory-lint` 一行（时机：每次写入 memory 后 / CLI 全量；模式：机械拦截；依据：`§12` 预算 + 本 change 的 `memory-index-integrity` spec）；验证：该表含 `memory-lint` 行
- [x] 9.6 `template/CLAUDE.md.snippet` 的「记忆分流」段补一行 memory 指针；验证：`wc -c` 结果 ≤ 4608 B（当前 4216 B，余 392 B），且 `python3 .claude/hooks/claudemd-lint.py` 对 snippet 无 ERROR
- [x] 9.7 `README.md` 门禁段补 `memory-lint` 的两行用法（`python3 .claude/hooks/memory-lint.py` 全量 / `--hook`）；验证：README 含 `memory-lint.py` 字样
- [x] 9.8 `docs/WORKFLOW_zh.md` 同步一句 memory 门禁说明；验证：该文件含 `memory-lint` 字样

## 10. 收口验证

- [x] 10.1 全量跑 `python3 -m pytest tests/ -q`；验证：全绿，记录测试条数
- [x] 10.2 对本仓库自身跑一次 `python3 template/.claude/hooks/memory-lint.py`；验证：本项目 memory 仅 2 文件 2 索引条目，期望零 ERROR 零 warn
- [x] 10.3 对 `amc-afa` 跑一次全量（只读）；验证：零 ERROR；若有 warn 逐条记录并判定是否为真问题
- [x] 10.4 跑 `python3 template/.claude/hooks/claudemd-lint.py` 确认本 change 未破坏既有门禁；验证：无新增 ERROR
- [x] 10.5 确认 `claudemd-lint.py` 一行未改；验证：`git diff --stat` 中不含该文件
- [x] 10.6 用 `spec-html-render` skill 渲染 `spec.html`；验证：文件存在且含全部五工件锚点


## apply 期发现（写回工件，非事后补记）

三处「计划与实测不符」，均已在实现与文档中修正：

- **A · 闸五算错了对象（真 bug，已修）**。原实现把一级索引 + 全部二级索引的字节和当作「常驻索引」，
  实测 `amc-afa` 因此报 35101 B > 28 KB。但二级索引按需 recall、**本就不常驻**——把它算进来会
  **惩罚「下沉」这个正确行为**：下沉后总字节不变，warn 永远消不掉。改为只算 `MEMORY.md`
  （24094 B，合格）。已加测试 `test_二级索引不计入常驻总量` 钉死，并写进 `design.md D2` 与
  `claudemd-standard §12`。

- **B · 立项调研的行长统计口径有偏差（文档已修，阈值不变）**。调研用 `startswith("- [")`，
  漏掉了 `- 二级索引：[…](x.md)` 这类「文字在前、指针在后」的行，得出 `n=209 / max=552 /
  700B 零触发`。用 lint 自身口径复测的真实值是 `n=218 / p95=400 / max=882 / 700B 触发 1 条`。
  **闸的阈值不改**——882 B 那条确实该拦；改的只是 `proposal.md` 与 `design.md` 里对分布的陈述。

- **C · task 8.2 的假设被证伪（挂法已改）**。原假设「install.sh 按 command 去重，不需改动」。
  实测其 `key()` 是按**整个 entry 的 command 元组**去重：老用户已有 `(claudemd-lint,)`，
  新 fragment 若写成 `(claudemd-lint, memory-lint)` 则 key 不同 → 追加成第二个 entry，
  **导致 claudemd-lint 跑两次**。改为让 `memory-lint` 独立成一个 entry，并用模拟脚本验证了
  四种场景（老用户升级 / 重跑幂等 / 全新安装 / 用户手动加过）均无重复。`install.sh` 仍未改动。

**实测门禁效果**（2026-08-30，16 个有索引的项目）：15 个零 ERROR 零 warn；`amc-afa`
1 ERROR（882 B 超长索引行）+ 15 warn（9 条 400–552 B 行长 · 6 条真实状态漂移）。
**双向闭合闸零误报**——217 个实体文件全部闭合正常。
