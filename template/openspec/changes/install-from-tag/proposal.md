## Why

2026-10-09 打了 `stable-v2.0`（= PR #34 合入时，`49533dd`），已有 `stable-v1.0`（= #19）。希望下游项目能装这些历史版本，但 pipe 模式装不了：

| 事实 | 出处 / 核实 |
|---|---|
| pipe 模式只拼 `archive/refs/heads/$BRANCH.tar.gz` | `install.sh:150`；两个老 tag 里的脚本同样如此 |
| `IDT_BRANCH=stable-v1.0` → 下载 404，exit 4 | 2026-10-09 实测：`refs/heads/stable-v1.0` 404，`refs/tags/stable-v1.0` 200 |
| `curl raw/<tag>/install.sh \| bash` 不报错，但装的是 main | tag 里的脚本 `BRANCH` 缺省 main：换掉的只是安装器，模板仍取 main |
| 只把下载地址改成也认 tag 仍不够 | main 的安装逻辑 × 老模板 = 混搭：会给老模板装上它用不到的 flight 插件、按新规则合并 settings；安装器以后每改一次，老版本的安装结果都可能跟着变 |

目前唯一可用的是 clone 后本地运行（`git clone --branch <tag>` + `./install.sh`），README 也没写。

## What Changes

- **pipe 模式认 tag**：`IDT_BRANCH` 接受分支名或 tag 名（缺省 main）。依次尝试 `refs/heads/<ref>`、`refs/tags/<ref>` 的归档；都失败则以 4 退出，错误输出列出尝试过的两个地址，不创建目标目录。
- **pipe 模式只做引导**：解压后交给归档自带的 `install.sh` 执行（`bash <解压目录>/install.sh [--upgrade] <TARGET>`，stdin 接 `/dev/null`），退出码原样透传，退出时删除临时目录；引导器自身不再复制模板。交接后的脚本旁边有 `template/`，按本地模式运行，不会再次下载。
- **帮助文本**：`--help` 里 `IDT_BRANCH` 的说明改为「分支或 tag」；文件头的管道用法注释同步。
- **README**：新增「安装指定版本」一节，写明 pipe 写法（用 main 的 `install.sh` + `IDT_BRANCH=<tag>`）、clone 写法、去哪查可用 tag，以及两条警示：不要从 tag 路径取 `install.sh` 走管道（老脚本缺省装 main）；不支持用 `--upgrade` 把已装新版的项目降级。

**不改**：本地模式（clone 后运行）的全部行为；已有 tag 的内容（tag 不可变，老脚本照旧只认分支，靠 main 的引导器绕开）；flight 插件安装、`merge_settings`、`copy_tree` 等安装逻辑。

## Capabilities

### New Capabilities

- `install-pinned-ref`：pipe 模式按分支或 tag 取归档、交给该版本自带的 install.sh 执行（参数 / 退出码 / 临时目录）、README 与帮助文本对「安装指定版本」的说明。

### Modified Capabilities

无（仓库没有 `openspec/specs/`，安装器此前没有行为规格）。

## Impact

- **代码**：`install.sh` 的 pipe 段（约 20–30 行）+ usage / 文件头各一行。
- **文档**：`README.md` 在「一键安装」下新增一节。
- **契约**：`IDT_BRANCH` 从「分支」放宽为「分支或 tag」，向后兼容；pipe 模式的安装逻辑改由归档自带的脚本提供；`install.sh [-u|--upgrade] [TARGET]` 签名成为跨版本契约（`openspec/adr/DRAFT-installer-versioned-with-template.md`）。
- **测试**：`tests/test_install.py` 新增 7 条（6 条 pipe 行为 + 1 条文档），全部离线：用 `file://` 目录模拟 GitHub 的 archive 路径，脚本从 stdin 喂给 `bash -s`，与 `curl | bash` 同形。
- **依赖**：无新增（仍是 bash / curl / tar）。
