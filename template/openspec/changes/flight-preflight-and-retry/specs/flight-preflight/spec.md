## ADDED Requirements

### Requirement: 基线必须记录环境事实并给出可机械判定的结论
`slice-gate.py baseline` SHALL 在跑全量测试之外，再运行 `gate.lint`、`gate.typecheck`（若配置）与每个切片的 `verify`，并把结果写入 `<change>/gate-baseline.json`（字段 `commit · at · plan_sha · ok · reasons · test · lint · typecheck · verify`）。`ok` SHALL 为 `test.exit == 0` 且所有切片 `verify` 退出码为 0；lint / typecheck 的退出码 MUST NOT 影响 `ok`，只记录规范化后的输出行作为基线。
Feature: 环境坏与命令不可运行在人类批准之前就被判出
Rule: 判据只认退出码与文件，不认自述

#### Scenario: baseline-writes-gate-baseline-json
- **GIVEN** 一个 `slices.json`：`gate.test` 在当前树上退出 0，两个切片的 `verify` 都退出 0，`gate.lint` 退出 1 并输出两行
- **WHEN** 运行 `python3 .claude/hooks/slice-gate.py baseline --change-dir <dir>`
- **THEN** 退出码为 0，`<dir>/gate-baseline.json` 存在，`ok` 为 `true`，`commit` 等于当前 HEAD，`plan_sha` 为 40 位十六进制
- **AND** `verify` 里每个切片 id 对应 `{"exit": 0}`，`lint.exit` 为 1 且 `lint.lines` 含那两行的规范化文本
- **AND** `slices.json.gate.full_suite_sec` 仍被写回（既有契约不变）

#### Scenario: baseline-red-verify-blocks
- **GIVEN** 同上，但切片 S2 的 `verify` 在当前树上退出 1
- **WHEN** 运行 `baseline`
- **THEN** 退出码为 1，`gate-baseline.json` 的 `ok` 为 `false`，`reasons` 含一项点名 `S2` 并说明「verify 在基线上红」
- **AND** stdout 的 JSON 同样带 `ok` 与 `reasons`

### Requirement: 起飞前必须有新鲜且绿的基线
新子命令 `slice-gate.py preflight --change-dir <dir>` SHALL 先做与 `lint` 相同的规划校验，再要求 `gate-baseline.json` 存在、`ok == true`、`plan_sha` 等于当前计划的 `gate` 三条命令与各切片 `verify` 的摘要、且 `commit` 是 HEAD 的祖先；任一不满足 MUST 以非 0 退出并在 stderr 点名原因；通过时 SHALL 打印与 `lint` 同形的 waves JSON。
Feature: 起飞判据机械化，红就不飞
Rule: 没有「已知红，放行」的字段——要飞就改计划或修环境，改计划触发重批

#### Scenario: preflight-refuses-without-green-baseline
- **GIVEN** 一个合法的 `slices.json`，但 `gate-baseline.json` 不存在
- **WHEN** 运行 `preflight`
- **THEN** 退出码非 0，stderr 含「基线」并提示先跑 `slice-gate.py baseline`
- **AND** 若改为存在但 `ok` 为 `false`，退出码同样非 0，stderr 原样列出 `reasons`

#### Scenario: preflight-refuses-stale-baseline
- **GIVEN** `gate-baseline.json` 的 `ok` 为 `true` 且 `commit` 是 HEAD 祖先，但之后 `slices.json` 里某切片的 `verify` 被改过（`plan_sha` 不再匹配）
- **WHEN** 运行 `preflight`
- **THEN** 退出码非 0，stderr 含「过期」并要求重跑 `baseline`
- **AND** 把 `verify` 改回后再运行 `preflight`，退出码为 0 且 stdout 是 waves JSON

### Requirement: 切片 verify 只跑测试
规划 lint SHALL 拒绝含 typecheck / lint 工具名（`tsc|typecheck|eslint|rustfmt|clippy|ruff|mypy|flake8|golangci`）的 `verify`，错误信息 MUST 指向 `gate.typecheck` / `gate.lint` 并说明门禁按基线差分。
Feature: 既有错误的排除交给门禁，不交给作者手搓 grep
Rule: 规划期就拦，不等飞行中发现

#### Scenario: lint-rejects-verify-with-typecheck-tool
- **GIVEN** 一个 `slices.json`，切片 S1 的 `verify` 为 `sh -c 'pnpm test && ! (pnpm -s typecheck | grep src/)'`
- **WHEN** 运行 `python3 .claude/hooks/slice-gate.py lint --change-dir <dir>`
- **THEN** 退出码非 0，stderr 含一项以 `verify:` 开头、点名 `S1`，并提到 `gate.typecheck`
- **AND** 把该 `verify` 改为 `pnpm test` 后 lint 通过
