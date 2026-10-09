# DRAFT. 起飞批准 = 人的按钮按压写入账本，绑定计划内容指纹

- Status: accepted, supersedes DRAFT-gate-evidence-not-self-reported
- Date: 2026-10-09
- Supersedes: DRAFT-gate-evidence-not-self-reported（该 ADR 在 main 上尚未编号，按文件名引用）
- 关联：DRAFT-flight-control-plane-in-mod

## Context

`DRAFT-gate-evidence-not-self-reported`（2026-09-10）确立了「门禁判据不得由被门禁的一方提供」，并规定第 4 条：人类审批的证据是会话转录里人自己发出的消息，且晚于被批准物的最后一次改动。落地为 `takeoff-gate.py` 的转录解析 + mtime 新鲜度后，暴露三处结构性弱点：

1. 「是不是人发的、是不是批准」只能靠启发式判断（消息形状排除表、≤40 字且含批准词），规则越补越长，两头都可能判错。
2. mtime 不等于内容：`touch` / checkout 改 mtime 不改内容，checkout 旧版本改了内容而 mtime 更早。
3. hook 模式下拿不到转录就放行，判据缺席时门禁形同不存在。

2026-10-09 在 Claude Code 2.1.295 上实测：插件绘制的按钮被按下时引擎发出 `ui.press`，模型侧没有任何工具能触发它；git 引用上的提交链可作账本，并发追加由 `update-ref` 旧值校验兜住。本 ADR 修订第 4 条；原 ADR 的其余原则不变，在此重述以使本 ADR 自足。

## Decision

1. **凡门禁判据，必须来自被门禁方之外的可核验来源**（原第 1 条原则保留）。真值源：git（提交、引用、diff）· 文件系统内容 · 控制面插件观测到的引擎事件 · hook 留痕。模型的叙述只能用于展示，不能用于判定。
2. **强制点放在机械层**（hook / 插件），命令与 skill 的文字只是解释与兜底自检；只写在文字里的判据视为未强制（原第 2 条保留）。
3. **证据不足 fail-closed，门禁自身故障 fail-open**（原第 3 条保留）；「没有批准记录」属于证据不足，必须拒绝。
4. **（修订）起飞批准的证据 = 人在控制面插件的批准带上按下按钮，插件把当时计划内容的指纹作为 `approve` 事件写入 `refs/flight/<change>/ledger`**。起飞门禁只比对「账本最新批准指纹 == 当前计划指纹」；会话转录与文件 mtime 不再参与。计划指纹只覆盖定义计划的内容（proposal、design、specs、slices.json、切片包），执行记账不计入。
5. **写账本的入口只存在于插件进程内、只由按钮按压触发**；判定器只读；不提供任何模型可调用的写入命令或工具。

## Consequences

- **更易**：判据从启发式变成两个哈希相等；改计划自动让批准失效、记账不会；门禁可用 git fixture 精确测试，不再需要构造转录。
- **更难**：批准必须在有界面的 Claude Code 会话里完成（`claude -p` 无法批准，这是刻意的）；依赖插件安装与版本下限；PR 审阅者若要复核批准，需要 fetch `refs/flight/*`。
- **威胁模型**：防走捷径的模型（自记批准、直接改证据）；不防蓄意伪造 git 对象的对抗者——那需要 OS 级密钥，超出本仓库范围。
- **被取代者**：`DRAFT-gate-evidence-not-self-reported` 的文件保持原样作为历史记录；其第 1–3 条原则由本 ADR 继承，第 4 条由本 ADR 第 4、5 条取代。
