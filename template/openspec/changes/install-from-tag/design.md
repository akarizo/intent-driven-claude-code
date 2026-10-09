## Context

`install.sh` 有两种模式，以「脚本旁边有没有 `template/`」区分（`install.sh:134-140`）：

- **本地模式**：clone 后运行，模板取同目录 `template/`，安装器与模板天然同版本。
- **pipe 模式**：`curl … | bash`，脚本从 stdin 读入，旁边没有 `template/`，于是下载 `$REPO_URL/archive/refs/heads/$BRANCH.tar.gz` 解压出模板，再用**自己**的逻辑安装（`install.sh:142-156`）。

安装逻辑与模板同仓演进：#27 起复制 agents / workflows，#35 加了 flight 插件安装，#36 加了 settings 缺键补齐。一个版本的安装逻辑只对同版本的模板成立。

已核实（2026-10-09）：

| 事实 | 结果 |
|---|---|
| GitHub `archive/refs/heads/<tag>.tar.gz` | 404 |
| GitHub `archive/refs/tags/<tag>.tar.gz` | 200（stable-v1.0 / stable-v2.0） |
| GitHub 短格式 `archive/<ref>.tar.gz` | 分支、tag、带斜杠的分支都是 200，但解析规则无公开文档 |
| `stable-v1.0` / `stable-v2.0` 的 install.sh 参数解析 | 都是 `[-u\|--upgrade] [TARGET]`，都不读 stdin |
| macOS 自带 bash | 3.2.57（`set -u` 下展开空数组会报 unbound variable） |

## Goals / Non-Goals

**Goals:**

- `curl …/main/install.sh | IDT_BRANCH=<tag> bash -s -- <目标>` 能装任意已有 tag（含 stable-v1.0），安装结果与当时 clone 该 tag 本地运行一致。
- 分支安装（含缺省 main）行为不变；本地模式一字不改。
- 全部行为离线可测。

**Non-Goals:**

- 修改已有 tag 里的 install.sh（tag 不可变）。
- 把已装新版的项目降级（`copy_tree` 不删文件，settings 里已合入的 hooks 会留着）；README 写明不支持。
- flight 插件按版本钉住：`install_flight_plugin` 的 `marketplace add` 取仓库默认分支；`claude plugin marketplace add` 能否指定 ref 未核实，见 Open Questions。
- 按 commit SHA 安装（GitHub 短格式也许支持，本变更不承诺）。

## Decisions

### D1 · pipe 模式只做引导，交给归档自带的 install.sh

```text
curl …/main/install.sh | IDT_BRANCH=stable-v2.0 bash -s -- ~/proj
        │  （引导器 = main 的脚本，pipe 模式）
        ├─ 解析参数 → UPGRADE / TARGET；检查 openspec / curl / tar
        ├─ 下载 refs/heads/stable-v2.0 ✗ → refs/tags/stable-v2.0 ✓ → 解压到 $TMP
        └─ bash $TMP/install.sh [--upgrade] ~/proj  </dev/null
                 │  （stable-v2.0 自己的脚本，旁边有 template/ → 本地模式）
                 └─ 按 stable-v2.0 的逻辑安装 stable-v2.0 的模板
        ← 退出码透传；trap 删 $TMP
```

- **为什么**：安装器与模板永远来自同一个 commit，装老版本就是「当时 clone 下来本地运行」的结果；以后改安装器不会改变老版本的安装结果。
- **备选：只改下载地址**，仍用当前脚本的逻辑装下载到的模板。代码更少，但新逻辑 × 老模板混搭：stable-v2.0 没有 flight 插件，却会被装上插件；以后每次改安装器，老版本的安装结果都可能跟着变。否决。
- **备选：exec 交接**。进程被替换，EXIT trap 不再执行，`$TMP` 泄漏。否决，改为子进程运行并透传退出码。

### D2 · 下载顺序：先 `refs/heads/<ref>`，失败再 `refs/tags/<ref>`

- **为什么**：分支路径与现在完全相同，分支安装零回归；同名时分支优先，行为可预期；两条路径都可以用 `file://` 目录离线模拟。
- **备选：GitHub 短格式 `archive/<ref>.tar.gz`**。一行就能同时支持两者，实测也可用，但解析规则（同名时谁优先）没有公开文档，离线测试也模拟不出它的解析逻辑。否决。
- 代价：装 tag 时多一次请求（分支路径先返回 404）。
- 都失败时错误信息列出两个地址，便于排查拼写和源地址。

### D3 · 沿用 `IDT_BRANCH`，不新增 `IDT_REF`

- **为什么**：最小改动，已有的调用方式全部照旧；在帮助文本和 README 里写明「分支或 tag」即可。
- **备选：新增 `IDT_REF`，把 `IDT_BRANCH` 留作别名**。名字更准确，但多出一个变量和一套优先级规则。没有人提出这个需求，否决。

### D4 · 交接的调用形态

- 用 `bash "$TMP/install.sh" [--upgrade] "$TARGET" </dev/null`：
  - **stdin 接 `/dev/null`**：`curl | bash` 时，父 bash 正从 stdin 逐字节读脚本，子进程如果继承 stdin，可能吞掉剩余的脚本内容。
  - **不用数组透传原始参数**：bash 3.2 在 `set -u` 下展开空数组会报错。改用已解析出的 `UPGRADE` / `TARGET`，分两种调用写。
  - **TARGET 原样传**（缺省 `$PWD`）：子进程继承工作目录，相对路径同样成立；目标目录的创建和归一化交给被交接的脚本。
- 归档里没有 `install.sh` → `[err]` 并以 4 退出（防御伪造或不完整的源）。

### D5 · `install.sh [-u|--upgrade] [TARGET]` 成为跨版本契约

将来的引导器会用这个签名调用任意老版本脚本。新增参数只能是可选的，不得改变这两个参数的语义，也不得依赖交互输入。这是一条长期承诺，写入 `openspec/adr/DRAFT-installer-versioned-with-template.md`。

## Risks / Trade-offs

- [老 tag 脚本收到它不认识的参数] → 引导器只传 `--upgrade` 与 TARGET，两个老 tag 都已核实接受。
- [交接后的脚本又进入 pipe 模式，递归下载] → 归档顶层就有 `template/`，交接后的脚本按本地模式运行。端到端测试断言「只下载一次」且输出含「模式: local」。
- [tag 与分支同名时装错] → 分支优先（D2）；README 建议 tag 统一用 `stable-v` 前缀。
- [老版本安装器的 bug 无法从 main 修复] → 有意的取舍（D1）：只能修好后打新 tag。
- [pipe 模式多启动一个 bash 进程、装 tag 时多一次 HTTP 请求] → 可忽略。

## Migration Plan

- 合入 main 后，README 推荐的 `curl …/main/install.sh | IDT_BRANCH=<tag> bash -s -- <目标>` 立即可装 stable-v1.0 / stable-v2.0；clone 写法本来就可用，照旧。
- 手工验收（需要网络，不进门禁）：在 worktree 里用 `bash -s` 喂本分支的 install.sh，`IDT_BRANCH=stable-v2.0` 与 `stable-v1.0` 各装一次到临时目录，对比 clone 对应 tag 后本地运行的结果（`diff -r` 两个目标目录）。
- 回滚：revert 本变更即可，tag 与本地模式不受影响。

## Open Questions

- `claude plugin marketplace add` 是否支持指定 ref（让插件版本跟随 tag）？未核实，本变更不处理。等将来有带插件的 tag 需要钉版本时，另起 change。
- 现行 ADR 与本设计无冲突：已核对 `openspec/adr/` 下 8 份 DRAFT，没有涉及安装器的条目。
