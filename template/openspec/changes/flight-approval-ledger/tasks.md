> 本文件由 `slices.json` 生成（改动请改 `slices.json` 后重新生成）。切片规则：1–9 片 · DAG 深度 ≤ 3 · 同 wave 所有权不相交 · 每片 owns ≤ 12 条 · 每片一个 commit · 门禁绿才勾选。
> 本仓库自身纪律：Python 脚本 TDD（先写失败测试）；测试函数首行 `# Given:` 三段中文注释；`python3 -m pytest -q tests` 全绿；`cd template && openspec schema validate intent-driven` 绿。
> wave 1 = S1 + S2 + S3（并行，owns 不相交；S3 只按 CLI 契约调用 S1 / S2，测试里用桩）；wave 2 = S4（import S1 / S2）+ S5（marketplace 指向 S3）；wave 3 = S6（文案与 S4 / S5 逐字一致）。

## S1 计划指纹判定器 plan_fp.py + spec.html 显示指纹 · deps: - · verify: `python3 -m pytest -q tests/test_plan_fp.py tests/test_spec_html.py`

- [x] S1 新建 `template/.claude/hooks/plan_fp.py`（白名单计划文件、CRLF→LF、`slices.json` 去 `gate.full_suite_sec`、排序后 sha256；CLI `--change-dir [--short]`，无计划 exit 2）；`spec_html.py` 元信息区加「计划指纹 <8位>」；scenarios：fp-ignores-execution-records · fp-changes-on-plan-edit · fp-ignores-measured-suite-time · fp-normalizes-line-endings · fp-cli-short-is-prefix · spec-html-shows-fingerprint

## S2 账本只读读取与结构校验 ledger.py · deps: - · verify: `python3 -m pytest -q tests/test_ledger.py`

- [x] S2 新建 `template/.claude/hooks/ledger.py`（只读：`read_events` / `latest_approval`；线性链、单文件 `event.json`、v1 字段校验，任一违规 exit 4；CLI `show` / `approved` / `verify`）；scenarios：ledger-shared-across-worktrees · ledger-approved-returns-latest-fp · ledger-absent-means-unapproved · ledger-show-lists-events · ledger-rejects-tampered-chain

## S3 flight 插件：批准带 · 进程内账本写入 · Bash 守卫 · 版本下限 · deps: - · verify: `python3 -m pytest -q tests/test_flight_plugin.py`

- [x] S3 新建 `template/plugins/flight/`（扫描全部 worktree 的待批准 change → 批准带；按压重算指纹、单写者队列追加 `approve` 事件、CAS 冲突重试 3 次、预填 `/opsx-apply <name>`；拦截写 `refs/flight/*/ledger` 的 Bash；版本 < 2.1.295 停用；不注册工具与命令；TS 测试名 = scenario id）；scenarios：band-shows-pending-plan · band-ignores-finished-and-foreign-copies · approve-press-appends-ledger-event · approve-press-refuses-changed-plan · ledger-append-retries-on-conflict · bash-guard-denies-ledger-writes · no-model-callable-approval-path · plugin-manifest-validates · version-floor-disables-band

## S4 takeoff-gate 判据切换为账本指纹 · deps: S1, S2 · verify: `python3 -m pytest -q tests/test_approval_gate.py`

- [x] S4 `template/.claude/hooks/takeoff-gate.py` 只认「账本最新批准指纹 == 当前计划指纹」，删除转录与 mtime 判据及 `--session`；拒绝文案含 spec.html 路径、批准带操作与插件安装命令；旧用例按切片包表格删除 / 改写；scenarios：takeoff-accepts-matching-approval · takeoff-rejects-missing-approval · takeoff-rejects-stale-approval · takeoff-rejects-invalid-ledger · takeoff-hook-denies-despite-transcript-approval · takeoff-hook-allows-approved-dispatch · takeoff-tasks-tick-keeps-approval

## S5 分发：仓库根 marketplace + install.sh 项目级安装插件 · deps: S3 · verify: `python3 -m pytest -q tests/test_install.py`

- [x] S5 新建 `.claude-plugin/marketplace.json`（marketplace `intent-driven` → `./template/plugins/flight`）；`install.sh` 有 claude 则项目级 marketplace add + install、已启用则跳过、无 claude 打印两条命令、失败只告警；摘要改写；`run_install` 改用 claude 桩；scenarios：marketplace-lists-flight-plugin · install-registers-plugin-at-project-scope · install-without-claude-prints-manual-steps · install-skips-enabled-plugin

## S6 铁律 7 与命令 / skill / README / 工作流文档同步 · deps: S4, S5 · verify: `python3 -m pytest -q tests/test_docs_iron_rules.py tests/test_template_docs.py`

- [x] S6 根 `CLAUDE.md` 铁律 7 与 `template/CLAUDE.md.snippet` 改为批准带 + 账本指纹；`/opsx-propose` + skill 交接、`/opsx-apply` + skill 的 step 0 同改；`README.md` / `docs/WORKFLOW_zh.md` 改写并说明插件；`docs/flight-control-plane.html` 入库、README 链接；scenarios：iron-rule-7-states-ledger-approval · propose-handoff-points-to-band · apply-step0-explains-ledger-gate · docs-drop-transcript-approval · readme-links-control-plane-doc

## R PR #35 review 修复 · 2026-10-09 用户授权追加（不在 slices.json 内；来源：PR #35 评审与 S3 切片评审的 MEDIUM）

- [x] R0 账本不可读时起飞 hook 放行：非 git 目录 / ref 指向非提交改判 deny（51d0ad5）
- [x] R1 守卫扩到 Monitor（命令文本）与 Write / Edit / NotebookEdit（目标路径含 `refs/flight/` 或为 `packed-refs`）；spec「模型侧没有写账本的路径」与 design D2 措辞同步
- [x] R2 按压以被按下按钮所代表的项为准：按钮 key 携带 change 与指纹，按压时不再重取 topItem（实现对齐 spec「与批准带上显示的不一致」）
- [x] R3 版本下限 fail-closed：会话启动先停用，版本读取成功且 ≥ 2.1.295 才启用；spec「版本下限」同步
