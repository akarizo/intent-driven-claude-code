## ADDED Requirements

### Requirement: 起飞核对会话加载的插件副本与已安装记录
新文件 `versions.ts` SHALL 提供纯函数（经 Io 读文件），输入会话加载的插件目录 `pluginRoot`、配置目录与主 worktree，给出：
- 加载版本：读 `<pluginRoot>/.claude-plugin/plugin.json` 的 `version`；读不到时 SHALL 写「未知」。
- 已安装记录：读 `<配置目录>/plugins/installed_plugins.json`，在键以 `flight@` 开头的条目中，先取 `scope` 为 project 且 `projectPath` 等于主 worktree 的，再取 `scope` 为 user 的。
- 判定：
  - 加载目录与该条目的 `installPath` 都在 `<配置目录>/plugins/cache/` 下且两者不同 → SHALL 判拒飞，理由含两边的版本与「/reload-plugins」；
  - 两者相同 → SHALL 判通过，给出「插件 <版本>」；
  - 文件不存在、JSON 损坏、找不到条目，或加载目录不在缓存下 → SHALL 判通过，并附「已安装版本未核对：<原因>」。
Feature: #41、#42 两次飞行因未 /reload-plugins 跑在旧版 · 用户定：读不到照常起飞并注明

#### Scenario: loaded-matches-installed
- **GIVEN** 加载目录为 `<cfg>/plugins/cache/intent-driven/flight/0.4.0`（其 plugin.json 版本 0.4.0）；installed_plugins.json 的 `flight@intent-driven` 有一条 project 条目，`projectPath` 为主 worktree、`installPath` 为同一目录
- **WHEN** 核对版本
- **THEN** 结果为通过，文本为「插件 0.4.0」，不含「未核对」

#### Scenario: loaded-differs-from-installed
- **GIVEN** 加载目录为 `<cfg>/plugins/cache/intent-driven/flight/0.3.2`（版本 0.3.2）；project 条目的 `installPath` 为 `<cfg>/plugins/cache/intent-driven/flight/0.4.0`、`version` 为 0.4.0
- **WHEN** 核对版本
- **THEN** 结果为拒飞，理由含「0.4.0」「0.3.2」与「/reload-plugins」

#### Scenario: installed-unverifiable-noted
- **GIVEN** 四种情形：installed_plugins.json 不存在；内容不是 JSON；没有 `flight@` 条目；加载目录是 `/dev/flight`（不在缓存下）
- **WHEN** 分别核对版本
- **THEN** 四次结果都是通过，文本都含「已安装版本未核对」与各自的原因

### Requirement: 起飞核对判定器认识插件要写的全部事件
`versions.ts` SHALL 提供判定器核对：运行 `python3 <判定器目录>/ledger.py events`。插件会写的事件类型中有它不认识的，SHALL 判拒飞，理由列出缺的类型并含「主检出」；命令退出码非 0 SHALL 判拒飞，理由含「判定器过旧」。
Feature: 判定器不认识的事件会让整条账本判损坏

#### Scenario: judges-must-know-events
- **GIVEN** 三种 `ledger.py events` 的应答：列出全部类型；缺 `measure`；退出 2（旧判定器没有该子命令）
- **WHEN** 分别核对判定器
- **THEN** 第一种通过
- **AND** 第二种拒飞，理由含「measure」与「主检出」
- **AND** 第三种拒飞，理由含「判定器过旧」

### Requirement: 起飞接入版本核对并在回复中给出插件版本
起飞 SHALL 在 git 版本检查之后、写入任何账本事件或 timeline 记录之前，依次做插件副本核对与判定器核对；任一判拒飞 SHALL 直接回复理由并停止。起飞回复 SHALL 含「插件 <版本>」，未核对时 SHALL 附原因。配置目录 SHALL 取 `CLAUDE_CONFIG_DIR`，未设时取 `$HOME/.claude`。
Feature: 版本错位当场可见

#### Scenario: takeoff-checks-versions
- **GIVEN** demo 已批准、其余起飞检查都过
- **WHEN** 三次起飞：installed_plugins.json 的条目指向与加载目录不同的缓存目录；`ledger.py events` 缺 `measure`；两项都正常
- **THEN** 前两次回复分别含「/reload-plugins」与「主检出」，账本都没有新增事件
- **AND** 第三次回复含「✈ 起飞」与「插件 」，账本新增 takeoff 事件
