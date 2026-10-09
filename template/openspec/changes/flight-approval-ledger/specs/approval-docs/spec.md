## ADDED Requirements

### Requirement: 铁律 7 与机制同步
根 `CLAUDE.md` 的铁律 7 与 `template/CLAUDE.md.snippet` 的「两处人类审批不可省」SHALL 写明：第一处批准是人在批准带上按下按钮、把计划指纹写入 `refs/flight/<change>/ledger`，由 `takeoff-gate.py` 比对账本指纹与当前计划指纹，模型不得自证；SHALL NOT 再出现「人类消息证据」「新鲜度」作为判据。
Feature: CLAUDE.md 描述的是现在真实生效的机制

#### Scenario: iron-rule-7-states-ledger-approval
- **GIVEN** 根 `CLAUDE.md` 与 `template/CLAUDE.md.snippet`
- **WHEN** 读取铁律 7 与对应条目
- **THEN** 两者都含「批准带」「指纹」与 `takeoff-gate`
- **AND** 都不含「人类消息证据」

### Requirement: 命令与同名 skill 的交接与起飞自检同改
`/opsx-propose` 与 `openspec-propose` skill 的收尾交接 SHALL 打印 `spec.html` 绝对路径、声明「本命令到此结束」（skill 为「本 skill 到此结束」），并说明：核对 `spec.html` 上的计划指纹与批准带一致后按「批准起飞」，再回车发出预填的 `/opsx-apply <name>`。`/opsx-apply` 与 `openspec-apply-change` skill 的 step 0 SHALL 说明 `takeoff-gate.py` 以账本指纹为判据、exit 3 的三种原因与补救（含插件安装命令）。两组文档 SHALL NOT 再说「在转录里核验」。
Feature: 命令与 skill 不漂移

#### Scenario: propose-handoff-points-to-band
- **GIVEN** `opsx-propose.md` 与 `openspec-propose/SKILL.md`
- **WHEN** 读取收尾交接段
- **THEN** 两者都含「绝对路径」「spec.html」「批准带」「指纹」「/opsx-apply」与 `takeoff-gate`，命令含「本命令到此结束」、skill 含「本 skill 到此结束」
- **AND** 都不含「转录」

#### Scenario: apply-step0-explains-ledger-gate
- **GIVEN** `opsx-apply.md` 与 `openspec-apply-change/SKILL.md`
- **WHEN** 读取 step 0
- **THEN** 两者都含 `takeoff-gate.py --change-dir`、「账本」「指纹」与 `claude plugin install`
- **AND** 都不含「人类消息」

### Requirement: 面向用户的文档同步
`README.md` 与 `docs/WORKFLOW_zh.md` 中描述起飞批准的段落 SHALL 改为批准带 + 账本指纹，并 SHALL 说明需要安装 `flight@intent-driven` 插件；`install.sh` 的安装摘要同样 SHALL NOT 再出现「人类消息证据」。`docs/flight-control-plane.html` SHALL 纳入仓库，`README.md` SHALL 链接到它。
Feature: 用户从文档就能知道怎么批准、缺什么

#### Scenario: docs-drop-transcript-approval
- **GIVEN** `README.md`、`docs/WORKFLOW_zh.md` 与 `install.sh`
- **WHEN** 检索起飞批准相关文字
- **THEN** 三者都不含「人类消息证据」
- **AND** `README.md` 与 `docs/WORKFLOW_zh.md` 都含「批准带」与 `flight@intent-driven`

#### Scenario: readme-links-control-plane-doc
- **GIVEN** 仓库中的 `docs/flight-control-plane.html` 与 `README.md`
- **WHEN** 检查文件存在性与 README 链接
- **THEN** 该文件存在，且 `README.md` 含指向 `docs/flight-control-plane.html` 的链接
