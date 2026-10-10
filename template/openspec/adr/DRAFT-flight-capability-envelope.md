# DRAFT. 飞行 agent 的能力由插件按角色包络强制，飞行中主会话对在飞 worktree 只读

- Status: accepted
- Date: 2026-10-10
- 关联：DRAFT-flight-orchestrator-state-machine（承接其「中性」一条：按 agentId 限写与 tool.check 权限策略在后续 change 落地）· DRAFT-flight-control-plane-in-mod
- 评审记录：docs/flight-orchestrator.html（D4）

## Context

`DRAFT-flight-orchestrator-state-machine` 让 flight 插件的状态机接管了 `/opsx-apply`，但在「中性」一条里留了口子：飞行中执行体的权限仍随会话的权限模式，按 agentId 限写与 `tool.check` 权限策略在后续 change 落地。评审页 `docs/flight-orchestrator.html` 的 D4（能力包络）选了 A：专用 agent 类型，加上 `tool.call` 按 agentId 限写；飞行中主会话对源码只读。agent 类型已在 3a 落地，本 ADR 落定剩下的包络部分。

2.1.295 上的相关实测：
- `tool.call` 带 agentId，越界 Write 被拒后 agent 没有改走 Bash；6 个并行 agent 没有串话。
- `tool.check` 对自家 agent 答 allow，Write 与 `git commit` 即放行，不弹询问。
- `tool.check` 的 `next(e)` 返回引擎自己的判定（规则、模式、PreToolUse），hook 可以改答 allow / ask / deny；输入带 `agentId` 与组织上限 `ceiling`。
- `agent.spawn` 的输入带 `subagentType`、`parentAgentId`；`next.origin` 指明是哪个插件的 hook 帧触发了派发。

## Decision

1. **写入包络：按 agentId 找角色，按角色限路径。** 飞行 agent 的 Write / Edit / NotebookEdit 先把目标规范成绝对路径，再按角色判断：执行体只能写自己切片 worktree 内、匹配本片 `owns` 的路径；修复体与解冲突 agent 只能写自己 worktree 内、匹配全部切片 `owns` 并集的路径；评审员不能写。匹配语义与 `slice-gate.py` 的 `glob_match` 一致（精确、fnmatch、`dir/**` 前缀）。拒绝理由写明角色、切片和越界的相对路径。角色先查派发时写入的内存缓存，查不到再扫账本。不属于任何飞行的 agent 一律放行。
2. **Bash：危险 git 一律拒绝。** 命令按 `&&`、`||`、`;`、`|`、换行切段，跳过前导 `VAR=…` 与 git 全局选项后取子命令。`push`、`merge`、`rebase`、`reset`、`checkout`、`switch`、`worktree`、`update-ref`、`symbolic-ref`、`stash`、`tag`、`cherry-pick`、`revert`、`clean`、`filter-branch`、`replace`、`notes` 拒绝；`branch` 带删除 / 改名 / 强制类选项拒绝；`commit --amend` / `--no-verify` 拒绝；命令含 `refs/flight/` 拒绝。评审员另外拒绝 `add`、`commit`、`rm`、`mv`、`apply`、`am`。
3. **Bash：只给白名单免询问。** 每一段都命中白名单才把 ask 升为 allow：门禁命令（`gate.test` / `gate.lint` / `gate.typecheck`）与切片 `verify`、只读 git（`status`、`diff`、`log`、`show`、`rev-parse`、`ls-files`、`blame`、`grep`）、执行体与修复体的 `git add` / `git commit`。含命令替换、反引号、输入输出重定向（`2>&1` 除外）或后台 `&` 的一律不升级。白名单外的命令按用户自己的权限设置处理。
4. **`tool.check` 只升 ask，只在包络内。** 先取引擎判定 `next(e)`：主会话或非飞行 agent 原样返回；判定不是 ask 原样返回（不推翻 deny、不收回 allow）；组织上限为 ask 原样返回。只有 Read / Grep / Glob、包络内的写入、白名单 Bash、评审员调用 `mcp__flight__submit_findings` 答 allow。包络外的写入与危险 Bash 已在 `tool.call` 被拒。
5. **飞行中主会话对在飞 worktree 只读（尽力而为）。** 插件在账本写入点维护「在飞」集合（takeoff 加入，land / halt 移出），记录 change worktree 与切片 worktree 前缀。主会话在在飞树内的写入一律拒绝；主会话 Bash 命令文本含在飞树绝对路径且带改动类 git 子命令或 `>` 重定向时拒绝。
6. **`agent.spawn` 守卫。** `flight:*` 类型只能由 flight 插件派发；由插件派发的 `flight:*` 必须显式指定 model（铁律 11）；飞行中的 agent 不得再派发子 agent；守卫自身抛错时对 `flight:*` 拒绝、其他类型放行。

否决的方案：
- **对飞行 agent 的 Bash 一律 allow**：执行测试本来就在人已批准的计划之内，所以门禁和 verify 可以免询问；但插件不能越过用户设置，把任意 shell 权限交给可能被注入提示的模型。
- **只靠门禁事后核对、不做事前包络**：`ownership_violations` 只能在收口时发现越界，越界写入、危险 git（push、reset、改历史、改账本 ref）在那之前已经生效，有的不可逆；事前包络把这类操作挡在发生之前，门禁仍是权威核对。

## Consequences

- **更易**：飞行 agent 在 default 权限模式下，包络内的写入、门禁 / verify、只读 git、`git add` / `git commit` 不再弹询问；越界写入与危险 git 在发生前被拒，拒绝理由可直接定位到角色与路径；飞行中的 agent 不能再派生子 agent，派发路径收拢到控制面。
- **更难**：包络判定成为可信计算基的一部分，切段、选项跳过与白名单匹配的 bug 会直接误拒或误放，必须由 scenario 测试覆盖；Bash 白名单比较保守，白名单外的合法命令仍可能弹询问。
- **已知边界**：Bash 写文件绕得过写入预拦，权威核对仍是门禁的 owns 检查；shell 已 `cd` 进在飞树后不带路径的 git 命令拦不到；会话重启后在飞集合为空，直到再次起飞才恢复（重建留给后续 `/flight resume`）。这些边界同步写进 `/opsx-apply` 命令与 `openspec-apply-change` skill 的「执行引擎（先读）」。
- **中性**：本 ADR 承接而不取代 `DRAFT-flight-orchestrator-state-machine`；插件版本升到 0.3.0。
