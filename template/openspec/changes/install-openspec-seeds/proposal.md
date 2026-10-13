## Why

安装器把本仓自己的开发工件拷进了用户项目。`template/openspec/` 既是模板，也是本仓自己的 openspec 工作区：本仓每个 change 的工件、每份 DRAFT ADR 都落在这里。`install.sh` 却把整个目录原样拷给目标项目。

| 事实 | 出处 / 核实 |
|---|---|
| 安装与升级都执行 `copy_tree "$TEMPLATE_SRC/openspec" "$TARGET/openspec" 0`，整目录只增不改 | `install.sh:468` |
| main（`7fd26b0`）的 `template/openspec/changes/` 有 32 个 change 目录（552 个文件），`adr/` 有 17 份 `DRAFT-*.md` | `git ls-tree origin/main` |
| `stable-v2.0` 安装时已拷进 11 个 change 目录和 6 份 DRAFT ADR；这 17 个条目在 main 的模板里都还有同名项 | `git ls-tree stable-v2.0` 与 main 逐项比对；`stable-v1.0` 为 0 |
| 2026-10-13 沙箱实测：先装 `stable-v2.0`，再用 main 的 `install.sh --upgrade`，又新增 20 个 change 目录（398 个文件）和 9 份 DRAFT ADR，都是未跟踪的新文件 | scratchpad `upgrade-sim.sh` |
| README「它装了什么」写的 `openspec/` 只有 `config.yaml`、`schemas/intent-driven/`、`adr/.gitkeep`、`superpower/.gitkeep` | `README.md:145-164` |

后果：
- 用户的 `openspec list` 里混进几十个不属于自己的 change。
- `openspec/adr/` 混进本仓的 ADR 草稿。
- 升级后 `git status` 一大片未跟踪文件。用户要逐个分辨，误提交就进了自己的历史。

现在要改，因为 v2.0 用户正准备用 `--upgrade` 升到飞行插件版本，每升一次就再污染一次。

## What Changes

- **openspec/ 只按清单下发种子**。清单如下，已存在就跳过，仍然只增不改：
  - `.gitignore`、`config.yaml`
  - `changes/.gitkeep`、`adr/.gitkeep`、`superpower/.gitkeep`
  - `schemas/` 整个目录

  `template/openspec/changes/<name>/` 与 `template/openspec/adr/DRAFT-*.md` 不再拷贝。升级时刷新 `schemas/`、追加 `.gitignore` 规则、迁移根 `adr/`，这些照旧。
- **列出疑似误拷的条目**。安装或升级结束时，检查目标项目的 `openspec/changes/` 与 `openspec/adr/`：名字与本仓 `template/openspec/changes/*`、`template/openspec/adr/*` 中的条目相同的，用 `[info]` 列出，提示多半是旧版安装器误拷进来的，确认不是自己的工件后可以手动删除。安装器不代删，做法与现有退役文件提示一致。

**不改**：
- `.claude/` 的复制与刷新。
- `merge_settings`、flight 插件安装、pipe 模式引导。
- README：「它装了什么」本来就只写种子，现在的行为正好与它对齐。
- 本仓把开发工件放在 `template/openspec/` 的约定。

## Capabilities

### New Capabilities

- `install-openspec-seeds`：安装器对 `openspec/` 只下发种子；对与本仓开发工件同名的已有条目只列出、不删除。

### Modified Capabilities

无。仓库没有 `openspec/specs/`，安装器此前没有关于 openspec 下发内容的行为规格。

## Impact

- **代码**：`install.sh` 的 openspec 复制段（约 10 行），文件末尾加一段列出提示（约 12 行），写法与退役文件提示相同。
- **测试**：`tests/test_install.py` 新增 4 条，全部离线，沿用 `run_install_stubbed`。3 条是骨架，1 条是护栏：用户改过的 `config.yaml` 在升级后保留，被改坏的 schema 被刷新回模板原文。
- **用户可见**：
  - 全新安装的 `openspec/` 只剩种子。
  - 已被污染的项目升级时，多出一段「疑似误拷」清单。
  - 不删除任何已有文件。
- **契约**：`install.sh [-u|--upgrade] [TARGET]` 不变，退出码不变。
- **依赖**：无新增。
